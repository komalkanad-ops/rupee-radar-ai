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
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { proPurchaseOrderLimiter, proPurchaseStatusLimiter } from "../../lib/rateLimiters.js";
import { normalizeEmail, normalizePhone } from "../../lib/identityMatch.js";
import { createOrder, fetchOrder, isCashfreeConfigured, verifyWebhookSignature } from "./cashfreeClient.js";

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
proPurchaseRouter.post("/webhook", async (req, res) => {
  const signature = req.headers["x-webhook-signature"];
  const timestamp = req.headers["x-webhook-timestamp"];
  const rawBody = (req as any).rawBody as string | undefined;
  if (typeof signature !== "string" || typeof timestamp !== "string" || !rawBody) {
    return res.status(400).json({ error: "Missing signature, timestamp, or raw body" });
  }

  let valid: boolean;
  try {
    valid = verifyWebhookSignature(timestamp, rawBody, signature);
  } catch (err) {
    return res.status(501).json({ error: (err as Error).message });
  }
  if (!valid) return res.status(400).json({ error: "Invalid webhook signature" });

  const body = JSON.parse(rawBody);
  const orderId = body?.data?.order?.order_id;
  const paymentStatus = body?.data?.payment?.payment_status;
  if (!orderId) return res.status(400).json({ error: "Missing order_id in webhook payload" });

  const purchase = await prisma.proPurchase.findUnique({ where: { orderId } });
  if (!purchase) return res.status(404).json({ error: "Unknown order" });

  if (paymentStatus === "SUCCESS") {
    try {
      await issueVoucherIfPaid(purchase.id);
    } catch (err) {
      Sentry.captureException(err, { tags: { route: "POST /pro-purchase/webhook" } });
    }
  } else if (paymentStatus && purchase.status !== paymentStatus) {
    // Never overwrite status on a purchase that already has a voucher — see the matching guard in
    // issueVoucherIfPaid for why (a stale/out-of-order webhook event must not make an already-paid,
    // already-voucher'd purchase look unpaid).
    await prisma.proPurchase
      .updateMany({ where: { id: purchase.id, voucherCode: null }, data: { status: paymentStatus } })
      .catch(() => {});
  }

  res.status(200).json({ ok: true });
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

  const emailMatches = normalizedEmail && purchase.email && normalizedEmail === purchase.email;
  const phoneMatches = normalizedPhone && normalizedPhone === purchase.phone;
  if (!emailMatches && !phoneMatches) {
    return res.status(403).json({ error: "That email/phone doesn't match the one used to buy this voucher" });
  }

  const { days } = PLANS[purchase.plan as PlanKey];
  const existing = await prisma.proEntitlement.findUnique({ where: { userId } });
  const existingExpiryMs = existing?.status === "active" ? (existing.expiryAt?.getTime() ?? 0) : 0;
  const baseMs = Math.max(existingExpiryMs, Date.now());
  const expiryAt = new Date(baseMs + days * 24 * 60 * 60 * 1000);

  // Claim-then-grant, not grant-then-mark: the earlier plain findUnique + later update left a
  // window where two concurrent redeem requests for the same still-unredeemed voucher (e.g. from
  // two different accounts sharing a leaked code + matching phone) could both pass the
  // `voucherRedeemed` check above before either write landed, and both walk away with a real
  // ProEntitlement off one paid voucher. The interactive transaction below claims the voucher via
  // a conditional `updateMany` FIRST; only the request whose claim actually lands (count === 1)
  // proceeds to grant the entitlement — a second concurrent request's claim always sees count 0
  // and 409s, same as if it had arrived a full second later.
  try {
    const entitlement = await prisma.$transaction(async (tx) => {
      const claimed = await tx.proPurchase.updateMany({
        where: { id: purchase.id, voucherRedeemed: false },
        data: { voucherRedeemed: true, redeemedByUserId: userId, redeemedAt: new Date(), proExpiryAt: expiryAt },
      });
      if (claimed.count !== 1) {
        throw Object.assign(new Error("This voucher has already been redeemed"), { alreadyRedeemed: true });
      }
      return tx.proEntitlement.upsert({
        where: { userId },
        create: { userId, productId: `voucher_${purchase.plan.toLowerCase()}`, expiryAt, verifiedAt: new Date(), status: "active" },
        update: { productId: `voucher_${purchase.plan.toLowerCase()}`, expiryAt, verifiedAt: new Date(), status: "active" },
      });
    });
    res.json(entitlement);
  } catch (err: any) {
    if (err?.alreadyRedeemed) return res.status(409).json({ error: "This voucher has already been redeemed" });
    throw err;
  }
});
