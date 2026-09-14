// Website PRO-voucher purchase flow: buyer picks a plan on the pricing page, pays via Cashfree,
// gets a one-time voucher code shown once on the success page, then redeems it inside the app
// (identity-matched by email OR phone — see identityMatch.ts) to activate a real ProEntitlement.
//
// Deliberately independent of billingRouter.ts's ProEntitlement/Play-Billing flow until the very
// last step (POST /redeem, which upserts the same ProEntitlement row everything else reads).
//
// Order-status source of truth: the GET /orders/:orderId poll is the PRIMARY path that issues the
// voucher, not the webhook. Cashfree webhooks require a URL registered in the Cashfree dashboard —
// something this session can't configure or verify — so a buyer must not be able to pay and get
// nothing just because that registration is missing/wrong. The webhook below still exists as a
// faster, best-effort path; both call the same idempotent issueVoucherIfPaid().
import * as Sentry from "@sentry/node";
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { proPurchaseOrderLimiter, proPurchaseStatusLimiter } from "../../lib/rateLimiters.js";
import { normalizeEmail, normalizePhone } from "../../lib/identityMatch.js";
import { createOrder, fetchOrder, fetchOrderPayments, isCashfreeConfigured, verifyWebhookSignature } from "./cashfreeClient.js";

export const proPurchaseRouter = Router();

const RETURN_URL = "https://rupeeradarai.com/pro/success?order_id={order_id}";

function isSandbox(): boolean {
  return process.env.CASHFREE_ENV !== "production";
}

const PLANS = {
  WEEKLY: { amountInr: 200, days: 7 },
  MONTHLY: { amountInr: 500, days: 30 },
  YEARLY: { amountInr: 3000, days: 365 },
} as const;
type PlanKey = keyof typeof PLANS;

function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && v in PLANS;
}

function generateVoucherCode(): string {
  return `RRPRO-${randomBytes(5).toString("hex").toUpperCase()}`;
}

// Cashfree order_status values that mean "not paid, and never will be" — used only to keep the
// local `status` column roughly in sync for the admin/support view; redemption only ever checks
// voucherCode + voucherRedeemed, not this field.
const TERMINAL_UNPAID = new Set(["EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"]);

// A declined card or an abandoned checkout does NOT expire/terminate the ORDER (order_status stays
// "ACTIVE", retriable) — only the individual payment ATTEMPT fails. Without checking the attempt
// list separately, the success page had no way to tell "buyer is still filling the form" apart from
// "buyer's card was declined 90 seconds ago" — both looked identical (order_status: ACTIVE) and both
// kept polling/spinning "Confirming your payment…" for the full ~100s before giving up with a vague
// message. This resolves that: a FAILED/USER_DROPPED/VOID/CANCELLED attempt with nothing newer
// pending means the payment genuinely didn't go through, distinct from "still ACTIVE, no attempt
// yet" (an empty payments array — per Cashfree's own docs, NOT the same as a failed attempt).
const FAILED_ATTEMPT_STATUSES = new Set(["FAILED", "USER_DROPPED", "VOID", "CANCELLED"]);

async function latestFailedAttempt(orderId: string): Promise<string | null> {
  const payments = await fetchOrderPayments(orderId);
  if (payments.length === 0) return null;
  const sorted = [...payments].sort((a, b) => (b.payment_time ?? "").localeCompare(a.payment_time ?? ""));
  const latest = sorted[0];
  return FAILED_ATTEMPT_STATUSES.has(latest.payment_status) ? latest.payment_status : null;
}

// Idempotent AND race-safe: the poll and the webhook can both call this for the same order at
// nearly the same instant. The claiming write is a conditional `updateMany({ where: { voucherCode:
// null } })`, not a plain `update` — only the caller whose write actually lands (count === 1) is
// the one who "won"; the loser re-reads and returns the code the winner persisted, instead of
// generating and returning a second, different code that would never match what's in the DB.
async function issueVoucherIfPaid(purchaseId: string): Promise<{ status: string; voucherCode: string | null }> {
  const purchase = await prisma.proPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
  if (purchase.voucherCode) return { status: purchase.status, voucherCode: purchase.voucherCode };

  const order = await fetchOrder(purchase.orderId);

  if (order.order_status !== "PAID") {
    // Never overwrite `status` on a purchase that already has a voucher — an out-of-order/stale
    // webhook event (e.g. a retried payment's earlier FAILED arriving after the retry's SUCCESS
    // already issued a voucher) must not make an already-paid, already-voucher'd purchase look
    // unpaid again.
    if (TERMINAL_UNPAID.has(order.order_status) && purchase.status !== order.order_status) {
      await prisma.proPurchase.updateMany({
        where: { id: purchase.id, voucherCode: null },
        data: { status: order.order_status },
      });
    }
    // The order itself stays ACTIVE/retriable after a declined card or an abandoned checkout — only
    // the individual attempt is a dead end. Best-effort: a failure here (e.g. Cashfree transiently
    // unreachable) must not break the whole status poll, just fall back to the plain order status.
    const failedAttempt = await latestFailedAttempt(purchase.orderId).catch(() => null);
    if (failedAttempt) return { status: `PAYMENT_${failedAttempt}`, voucherCode: null };
    return { status: order.order_status, voucherCode: null };
  }

  // Retry once on a voucherCode collision (astronomically unlikely at this volume, but the column
  // is @unique so a P2002 is possible in principle).
  for (let attempt = 0; attempt < 3; attempt++) {
    const voucherCode = generateVoucherCode();
    try {
      const claimed = await prisma.proPurchase.updateMany({
        where: { id: purchase.id, voucherCode: null },
        data: { status: "PAID", cfOrderId: order.cf_order_id, voucherCode },
      });
      if (claimed.count === 1) return { status: "PAID", voucherCode };
      // Someone else (the poll vs. webhook racing this one) won — re-read and return their code
      // rather than reporting a code that was never actually persisted.
      const current = await prisma.proPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      return { status: current.status, voucherCode: current.voucherCode };
    } catch (err: any) {
      if (err?.code === "P2002" && attempt < 2) continue;
      throw err;
    }
  }
  throw new Error("Could not generate a unique voucher code");
}

// GET /pro-purchase/config — public. Lets the pricing page show a "test mode" banner whenever
// CASHFREE_ENV isn't explicitly "production" — a real launched app must never let a buyer pay
// through sandbox without knowing it (sandbox checkout only accepts Cashfree's test
// cards/UPI IDs, so a real card/UPI just fails there, not "charges and gets nothing" — but a
// confused failed-payment experience on launch day is still a real cost worth flagging plainly).
proPurchaseRouter.get("/config", (_req, res) => {
  res.json({ sandbox: isSandbox(), configured: isCashfreeConfigured() });
});

// POST /pro-purchase/orders — { plan, phone, email? } — public, unauthenticated (the buyer isn't
// signed into the app at checkout). phone is required (Cashfree mandates customer_phone on every
// order — confirmed against the live sandbox API). Its own strict limiter: every call creates a
// real order against the Cashfree account.
proPurchaseRouter.post("/orders", proPurchaseOrderLimiter, async (req, res) => {
  if (!isCashfreeConfigured()) {
    return res.status(501).json({ error: "Payments are not configured yet — set CASHFREE_APP_ID and CASHFREE_SECRET_KEY" });
  }
  const { plan, phone, email } = req.body ?? {};
  if (!isPlanKey(plan)) {
    return res.status(400).json({ error: `plan must be one of ${Object.keys(PLANS).join(", ")}` });
  }
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "A valid 10-digit phone number is required" });
  }
  const normalizedEmail = normalizeEmail(email);

  const { amountInr } = PLANS[plan];
  const orderId = `pro_${plan.toLowerCase()}_${Date.now()}_${randomBytes(4).toString("hex")}`;

  let order;
  try {
    order = await createOrder({
      orderId,
      amountInr,
      customerId: orderId,
      customerPhone: normalizedPhone,
      customerEmail: normalizedEmail ?? undefined,
      returnUrl: RETURN_URL,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /pro-purchase/orders" } });
    return res.status(502).json({ error: "Could not start payment with Cashfree", detail: (err as Error).message });
  }

  await prisma.proPurchase.create({
    data: {
      orderId,
      cfOrderId: order.cf_order_id,
      plan,
      amountInr,
      email: normalizedEmail,
      phone: normalizedPhone,
      status: "CREATED",
      sandbox: isSandbox(),
    },
  });

  res.status(201).json({ orderId, paymentSessionId: order.payment_session_id, amountInr });
});

// GET /pro-purchase/orders/:orderId — the success page polls this after Cashfree's checkout
// redirect, every ~2.5s for up to ~100s. Public (keyed by the unguessable orderId, same trust
// model as a Razorpay order id round-tripped to a client) — this is the PRIMARY voucher-issuance
// path; see the module comment. A generous, separate limiter from order creation — one slow
// checkout's poll loop alone can exceed a tight shared budget.
proPurchaseRouter.get("/orders/:orderId", proPurchaseStatusLimiter, async (req, res) => {
  const purchase = await prisma.proPurchase.findUnique({ where: { orderId: req.params.orderId } });
  if (!purchase) return res.status(404).json({ error: "Unknown order" });

  // Once redeemed, stop handing the code back out on every poll of this order id — it's meant to
  // be a one-time secret, not a standing lookup (e.g. via browser history or a shared support link).
  if (purchase.voucherRedeemed) {
    return res.json({ status: "REDEEMED", plan: purchase.plan, amountInr: purchase.amountInr, voucherCode: null });
  }
  if (purchase.voucherCode) {
    return res.json({ status: purchase.status, plan: purchase.plan, amountInr: purchase.amountInr, voucherCode: purchase.voucherCode });
  }

  try {
    const result = await issueVoucherIfPaid(purchase.id);
    res.json({ status: result.status, plan: purchase.plan, amountInr: purchase.amountInr, voucherCode: result.voucherCode });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "GET /pro-purchase/orders/:orderId" } });
    res.status(502).json({ error: "Could not check payment status", detail: (err as Error).message });
  }
});

// POST /pro-purchase/webhook — Cashfree's PAYMENT_SUCCESS_WEBHOOK. No requireUser (called by
// Cashfree, not the app) — trust comes from the HMAC signature, so no rate limiter either (a shared
// IP-keyed budget across every webhook delivery for every purchase would be the wrong shape of
// protection here). Best-effort fast path; the GET poll above is what actually guarantees a
// voucher gets issued (see module comment).
//
// ALWAYS acknowledge 200, even for a request that fails every check below. Two independent reasons:
// (1) Cashfree's dashboard "Add Webhook Endpoint" sends an unsigned connectivity-test POST and
// permanently flags the endpoint as broken in the UI if it gets anything but a 200 (confirmed
// against Cashfree's own docs — this is exactly what a non-2xx here was doing). (2) it's correct
// webhook hygiene regardless: signature verification decides whether to ACT on a payload, not what
// HTTP status to return — returning 4xx for "wasn't a real signed event" just invites Cashfree's own
// retry policy to keep hammering an endpoint that was never going to accept it. Nothing below this
// point ever throws past the outer catch, so every code path reaches the 200 at the end.
proPurchaseRouter.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];
    const rawBody = (req as any).rawBody as string | undefined;
    if (typeof signature !== "string" || typeof timestamp !== "string" || !rawBody) {
      return res.status(200).json({ ok: true, acted: false, reason: "missing signature/timestamp/body" });
    }

    let valid: boolean;
    try {
      valid = verifyWebhookSignature(timestamp, rawBody, signature);
    } catch {
      return res.status(200).json({ ok: true, acted: false, reason: "cashfree not configured" });
    }
    if (!valid) {
      return res.status(200).json({ ok: true, acted: false, reason: "invalid signature" });
    }

    const body = JSON.parse(rawBody);
    const orderId = body?.data?.order?.order_id;
    const paymentStatus = body?.data?.payment?.payment_status;
    if (!orderId) return res.status(200).json({ ok: true, acted: false, reason: "missing order_id" });

    const purchase = await prisma.proPurchase.findUnique({ where: { orderId } });
    if (!purchase) return res.status(200).json({ ok: true, acted: false, reason: "unknown order" });

    if (paymentStatus === "SUCCESS") {
      await issueVoucherIfPaid(purchase.id);
    } else if (paymentStatus && purchase.status !== paymentStatus) {
      // Never overwrite status on a purchase that already has a voucher — see the matching guard in
      // issueVoucherIfPaid for why (a stale/out-of-order webhook event must not make an already-paid,
      // already-voucher'd purchase look unpaid).
      await prisma.proPurchase
        .updateMany({ where: { id: purchase.id, voucherCode: null }, data: { status: paymentStatus } })
        .catch(() => {});
    }

    res.status(200).json({ ok: true, acted: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /pro-purchase/webhook" } });
    res.status(200).json({ ok: true, acted: false, reason: "internal error, logged" });
  }
});

// POST /pro-purchase/redeem — { voucherCode, email?, phone? } — requireUser: the signed-in app
// user redeeming the code. Matches EITHER email OR phone (whichever the buyer supplied at
// checkout) against what's stored on the purchase — the buyer isn't required to have typed both.
// Extends from the LATER of (existing ProEntitlement expiry, now) rather than overwriting it, so
// redeeming a weekly voucher while an existing longer entitlement is active can't shorten it.
proPurchaseRouter.post("/redeem", requireUser, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const { voucherCode, email, phone } = req.body ?? {};
  if (typeof voucherCode !== "string" || !voucherCode.trim()) {
    return res.status(400).json({ error: "voucherCode is required" });
  }
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedEmail && !normalizedPhone) {
    return res.status(400).json({ error: "email or phone is required to verify this voucher" });
  }

  // voucherCode only ever gets set by issueVoucherIfPaid once Cashfree itself confirmed PAID (see
  // that function) — checking voucherCode presence + voucherRedeemed is sufficient; a separate
  // `status === "PAID"` check would be redundant AND can go stale from an out-of-order webhook
  // event (guarded above, but this route no longer depends on that guard either way).
  const purchase = await prisma.proPurchase.findUnique({ where: { voucherCode: voucherCode.trim().toUpperCase() } });
  if (!purchase || !purchase.voucherCode) return res.status(404).json({ error: "Invalid voucher code" });
  if (purchase.voucherRedeemed) return res.status(409).json({ error: "This voucher has already been redeemed" });
  // A sandbox-origin voucher (no real money moved) must never redeem once this backend is running
  // with CASHFREE_ENV=production — the launch step of swapping in real Cashfree keys and flipping
  // that env var must be done atomically; this is the guard for the half-flipped window where real
  // production traffic could still find and redeem a leftover free/test voucher.
  if (purchase.sandbox && !isSandbox()) {
    return res.status(403).json({ error: "This voucher was issued in test mode and can't be redeemed here" });
  }

  const emailMatches = normalizedEmail && purchase.email && normalizedEmail === purchase.email;
  const phoneMatches = normalizedPhone && normalizedPhone === purchase.phone;
  if (!emailMatches && !phoneMatches) {
    return res.status(403).json({ error: "That email/phone doesn't match the one used to buy this voucher" });
  }

  const { days } = PLANS[purchase.plan as PlanKey];

  // Claim-then-grant, not grant-then-mark: the earlier plain findUnique + later update left a
  // window where two concurrent redeem requests for the same still-unredeemed voucher (e.g. from
  // two different accounts sharing a leaked code + matching phone) could both pass the
  // `voucherRedeemed` check above before either write landed, and both walk away with a real
  // ProEntitlement off one paid voucher. The interactive transaction below claims the voucher via
  // a conditional `updateMany` FIRST; only the request whose claim actually lands (count === 1)
  // proceeds to grant the entitlement — a second concurrent request's claim always sees count 0
  // and 409s, same as if it had arrived a full second later.
  //
  // The existing-entitlement lookup + expiry math ALSO happen inside this transaction (via `tx`,
  // not the outer `prisma`) — reading them outside it left a second, narrower race: the SAME user
  // redeeming two DIFFERENT valid vouchers concurrently could both read the same pre-redemption
  // expiry, both compute expiryAt from it, and the second upsert would silently overwrite the
  // first's extension instead of stacking on top of it.
  try {
    const entitlement = await prisma.$transaction(async (tx) => {
      const claimed = await tx.proPurchase.updateMany({
        where: { id: purchase.id, voucherRedeemed: false },
        data: { voucherRedeemed: true, redeemedByUserId: userId, redeemedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw Object.assign(new Error("This voucher has already been redeemed"), { alreadyRedeemed: true });
      }
      const productId = `voucher_${purchase.plan.toLowerCase()}`;
      let expiryAt: Date | null = null;
      // Optimistic compare-and-swap, not a blind read-then-write: two DIFFERENT vouchers for the
      // SAME user redeemed at nearly the same instant must not both compute their expiry off the
      // same stale snapshot and have the second silently clobber the first's extension. Each
      // attempt re-reads, then writes conditioned on the row being unchanged since that read — the
      // underlying UPDATE's own row lock is what actually serializes two concurrent writers to the
      // same userId; a lost race here just means "someone else updated it first," so retry with a
      // fresh read rather than erroring the buyer out.
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await tx.proEntitlement.findUnique({ where: { userId } });
        const existingExpiryMs = existing?.status === "active" ? (existing.expiryAt?.getTime() ?? 0) : 0;
        expiryAt = new Date(Math.max(existingExpiryMs, Date.now()) + days * 24 * 60 * 60 * 1000);
        if (!existing) {
          try {
            await tx.proEntitlement.create({ data: { userId, productId, expiryAt, verifiedAt: new Date(), status: "active" } });
            break;
          } catch (err: any) {
            if (err?.code === "P2002" && attempt < 4) continue; // someone else created it first — retry as an update
            throw err;
          }
        }
        const updated = await tx.proEntitlement.updateMany({
          where: { userId, expiryAt: existing.expiryAt, status: existing.status },
          data: { productId, expiryAt, verifiedAt: new Date(), status: "active" },
        });
        if (updated.count === 1) break;
        if (attempt === 4) throw new Error("Could not extend PRO entitlement due to a concurrent update — please retry");
      }
      await tx.proPurchase.update({ where: { id: purchase.id }, data: { proExpiryAt: expiryAt! } });
      return tx.proEntitlement.findUniqueOrThrow({ where: { userId } });
    });
    res.json(entitlement);
  } catch (err: any) {
    if (err?.alreadyRedeemed) return res.status(409).json({ error: "This voucher has already been redeemed" });
    throw err;
  }
});

// GET /pro-purchase/admin/purchases — requireAdmin. Support/refund lookup over every ProPurchase
// row (real buyer purchases AND admin-granted comp vouchers below both live in the same table) —
// newest first, capped at 200 since there's no pagination UI for this yet.
proPurchaseRouter.get("/admin/purchases", requireAdmin, async (_req, res) => {
  const purchases = await prisma.proPurchase.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  res.json(purchases);
});

// POST /pro-purchase/admin/grant — requireAdmin — { email?, phone?, plan } — generates a real
// voucher code for a specific identity WITHOUT going through Cashfree (amountInr: 0, status "PAID"
// immediately). Redeemed through the exact same POST /redeem path a real buyer uses — this is a
// comp/test grant, not a parallel mechanism, so it also doubles as a way to exercise the real
// redemption flow. `sandbox: false` unconditionally: an admin-granted voucher must always redeem
// regardless of whether CASHFREE_ENV happens to be "production" or not (see the `sandbox` guard on
// /redeem above, which only exists to catch REAL sandbox-origin Cashfree purchases).
proPurchaseRouter.post("/admin/grant", requireAdmin, async (req, res) => {
  const { email, phone, plan } = req.body ?? {};
  if (!isPlanKey(plan)) {
    return res.status(400).json({ error: `plan must be one of ${Object.keys(PLANS).join(", ")}` });
  }
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedEmail && !normalizedPhone) {
    return res.status(400).json({ error: "email or phone is required" });
  }

  const orderId = `comp_${plan.toLowerCase()}_${Date.now()}_${randomBytes(4).toString("hex")}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const voucherCode = generateVoucherCode();
    try {
      const purchase = await prisma.proPurchase.create({
        data: {
          orderId,
          plan,
          amountInr: 0,
          email: normalizedEmail,
          // ProPurchase.phone is NOT NULL (Cashfree mandates a phone on every real order) — a
          // comp grant with only an email still needs a placeholder here; it can never match a
          // real phone at redemption since it isn't a valid 10-digit number.
          phone: normalizedPhone ?? "0000000000",
          status: "PAID",
          voucherCode,
          sandbox: false,
        },
      });
      return res.status(201).json(purchase);
    } catch (err: any) {
      if (err?.code === "P2002" && attempt < 2) continue;
      throw err;
    }
  }
  res.status(500).json({ error: "Could not generate a unique voucher code" });
});
