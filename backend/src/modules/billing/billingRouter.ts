import * as Sentry from "@sentry/node";
import { Router } from "express";
import { google } from "googleapis";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { trialCodeLimiter } from "../../lib/rateLimiters.js";

export const billingRouter = Router();

// Must match the subscription product IDs created in Play Console exactly — there is no Play
// Console app yet (see CLAUDE.md), so these are placeholders until that setup happens.
export const PRO_PRODUCT_IDS = ["pro_monthly", "pro_yearly"] as const;

// Subscription states that still grant access — includes the grace period (payment failed but
// Google is still retrying) so a user doesn't lose PRO mid-retry.
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2
const ACTIVE_SUBSCRIPTION_STATES = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"]);

async function verifyWithGooglePlay(purchaseToken: string, productId: string) {
  const credentials = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON!);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const androidpublisher = google.androidpublisher({ version: "v3", auth });
  // subscriptionsv2.get is keyed by purchase token alone (no subscriptionId param) — it returns
  // every line item in the purchase, so pick the one matching the productId we're verifying.
  const { data } = await androidpublisher.purchases.subscriptionsv2.get({
    packageName: process.env.ANDROID_PACKAGE_NAME!,
    token: purchaseToken,
  });
  const lineItem = data.lineItems?.find((item) => item.productId === productId);
  const isActive = ACTIVE_SUBSCRIPTION_STATES.has(data.subscriptionState ?? "");
  const expiryAt = lineItem?.expiryTime ? new Date(lineItem.expiryTime) : null;
  return { isActive: isActive && !!lineItem, expiryAt };
}

// POST /billing/verify — { purchaseToken, productId } — called right after Android's
// BillingClient completes a purchase. Verifies the token against the real Google Play Developer
// API rather than trusting the client's say-so, then persists the entitlement from Google's own
// expiry/payment-state data.
billingRouter.post("/verify", requireUser, async (req: UserRequest, res) => {
  const { purchaseToken, productId } = req.body ?? {};
  if (!purchaseToken || !productId) {
    return res.status(400).json({ error: "purchaseToken, productId are required" });
  }
  if (!(PRO_PRODUCT_IDS as readonly string[]).includes(productId)) {
    return res.status(400).json({ error: `Unknown productId — expected one of ${PRO_PRODUCT_IDS.join(", ")}` });
  }
  const userId = req.userId!;

  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || !process.env.ANDROID_PACKAGE_NAME) {
    return res.status(501).json({
      error: "Play Billing verification not configured yet — set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON and ANDROID_PACKAGE_NAME",
    });
  }

  let verified: { isActive: boolean; expiryAt: Date | null };
  try {
    verified = await verifyWithGooglePlay(purchaseToken, productId);
  } catch (err) {
    // A real failure here (expired service-account key, Play API outage) fails every purchase
    // silently — report it, don't just 502 the user.
    Sentry.captureException(err, { tags: { route: "POST /billing/verify" } });
    return res.status(502).json({ error: "Could not verify purchase with Google Play", detail: (err as Error).message });
  }

  const { isActive, expiryAt } = verified;
  if (!isActive || !expiryAt) {
    return res.status(402).json({ error: "Purchase is not an active, paid subscription", proRequired: true });
  }

  const entitlement = await prisma.proEntitlement.upsert({
    where: { userId },
    create: { userId, playPurchaseToken: purchaseToken, productId, expiryAt, verifiedAt: new Date(), status: "active" },
    update: { playPurchaseToken: purchaseToken, productId, expiryAt, verifiedAt: new Date(), status: "active" },
  });
  res.json(entitlement);
});

// POST /billing/redeem-test-code — RETIRED FROM PRODUCTION 2026-09-14. Used to grant a year of PRO
// for one shared static string with no per-code accounting or rate limiting — exactly the "unsafe
// as a public feature (a leaked code = free PRO forever)" risk flagged in review when it shipped.
// Superseded by real, single-use, identity-matched vouchers: POST /pro-purchase/admin/grant (admin
// console → PRO Vouchers) for comp grants, and the real Cashfree purchase flow for paying
// customers. Kept alive ONLY under `NODE_ENV === "test"` — Vitest sets this automatically, Hostinger
// never does — so the ~9 existing test files that use this as their "grant this test user PRO"
// helper keep working unchanged, while the route is categorically unreachable in production
// regardless of what PRO_TEST_REDEEM_CODE is set to.
billingRouter.post("/redeem-test-code", requireUser, async (req: UserRequest, res) => {
  if (process.env.NODE_ENV !== "test") {
    return res.status(501).json({ error: "This has been retired — use a real PRO voucher from rupeeradarai.com/pricing or the admin console." });
  }
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: "code is required" });
  const userId = req.userId!;

  const expected = process.env.PRO_TEST_REDEEM_CODE;
  if (!expected) {
    return res.status(501).json({ error: "PRO_TEST_REDEEM_CODE is not set in the backend .env" });
  }
  if (code !== expected) {
    return res.status(403).json({ error: "Invalid code" });
  }

  const expiryAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const entitlement = await prisma.proEntitlement.upsert({
    where: { userId },
    create: { userId, productId: "test_redeem", expiryAt, verifiedAt: new Date(), status: "active" },
    update: { productId: "test_redeem", expiryAt, verifiedAt: new Date(), status: "active" },
  });
  res.json(entitlement);
});

billingRouter.get("/status", requireUser, async (req: UserRequest, res) => {
  const entitlement = await prisma.proEntitlement.findUnique({ where: { userId: req.userId } });
  res.json({ isPro: entitlement?.status === "active" && (entitlement.expiryAt?.getTime() ?? 0) > Date.now() });
});

// POST /billing/beta-unlock and GET /billing/beta-status — RETIRED 2026-09-14, the free beta has
// ended. Hardcoded off (not env-var-gated) so this can't come back on by an env var being present/
// re-added later — the only way to grant PRO without a real purchase now is
// POST /billing/admin/grant (by userId) or POST /pro-purchase/admin/grant (a real voucher for an
// email/phone, admin console → PRO Vouchers). Existing entitlements anyone already got from the
// beta are untouched — this only stops NEW free unlocks.
billingRouter.get("/beta-status", async (_req, res) => {
  res.json({ betaFreeProAvailable: false });
});

billingRouter.post("/beta-unlock", requireUser, async (_req: UserRequest, res) => {
  res.status(501).json({ error: "Free beta PRO has ended — subscribe at rupeeradarai.com/pricing." });
});

// POST /billing/admin/grant — { userId, months } — admin-only manual PRO grant (support/comp cases),
// separate from Play Billing verification and the QA test-code redeem above.
billingRouter.post("/admin/grant", requireAdmin, async (req, res) => {
  const { userId, months } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: "userId is required" });
  const durationMonths = Number(months) > 0 ? Number(months) : 1;
  const expiryAt = new Date(Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000);

  const entitlement = await prisma.proEntitlement.upsert({
    where: { userId },
    create: { userId, productId: "admin_grant", expiryAt, verifiedAt: new Date(), status: "active" },
    update: { productId: "admin_grant", expiryAt, verifiedAt: new Date(), status: "active" },
  });
  res.json(entitlement);
});

billingRouter.post("/admin/revoke", requireAdmin, async (req, res) => {
  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: "userId is required" });
  const entitlement = await prisma.proEntitlement.upsert({
    where: { userId },
    create: { userId, status: "inactive" },
    update: { status: "inactive" },
  });
  res.json(entitlement);
});

function normalizeTrialCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// GET /billing/trial-code/status — public, never leaks the code itself — just whether one is
// currently configured and turned on, so the app knows whether to show the "have a trial code?"
// box at all.
billingRouter.get("/trial-code/status", async (_req, res) => {
  const row = await prisma.trialPromoCode.findUnique({ where: { id: "singleton" } });
  res.json({ available: !!row?.active });
});

// POST /billing/redeem-trial-code — { code } — the one, shared, admin-set code that grants any
// signed-in account exactly 1 day of PRO, once per account ever. Lower-stakes replacement for the
// retired redeem-test-code (1 year, no per-account guard at all): the one-time claim below is
// atomic (conditional updateMany, same shape as ProPurchase voucher redemption in
// proPurchaseRouter.ts) so two concurrent taps can't both succeed, and an existing active
// subscriber is turned away rather than having their real entitlement overwritten down to 1 day.
billingRouter.post("/redeem-trial-code", trialCodeLimiter, requireUser, async (req: UserRequest, res) => {
  const { code } = req.body ?? {};
  if (!code || typeof code !== "string") return res.status(400).json({ error: "code is required" });
  const userId = req.userId!;

  const row = await prisma.trialPromoCode.findUnique({ where: { id: "singleton" } });
  if (!row?.active) {
    return res.status(501).json({ error: "No trial code is currently available." });
  }
  if (normalizeTrialCode(code) !== row.code) {
    return res.status(403).json({ error: "Invalid code" });
  }

  const entitlement = await prisma.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({
      where: { id: userId, trialCodeRedeemedAt: null },
      data: { trialCodeRedeemedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw Object.assign(new Error("ALREADY_REDEEMED"), { code: "ALREADY_REDEEMED" });
    }
    // Re-checked INSIDE the same transaction as the claim above — an earlier version read this
    // before the transaction, which let a real purchase (POST /pro-purchase/redeem or
    // /billing/verify) land in the gap between that read and this route's write, and this route's
    // flat upsert would then have overwritten a real subscription down to a 1-day expiry. Throwing
    // here rolls back the trialCodeRedeemedAt claim above too, so a blocked user doesn't burn their
    // one-time trial on a no-op.
    const existing = await tx.proEntitlement.findUnique({ where: { userId } });
    if (existing?.status === "active" && existing.expiryAt && existing.expiryAt.getTime() > Date.now()) {
      throw Object.assign(new Error("ALREADY_PRO"), { code: "ALREADY_PRO" });
    }
    const expiryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return tx.proEntitlement.upsert({
      where: { userId },
      create: { userId, productId: "trial_code", expiryAt, verifiedAt: new Date(), status: "active" },
      update: { productId: "trial_code", expiryAt, verifiedAt: new Date(), status: "active" },
    });
  }).catch((err) => {
    if (err?.code === "ALREADY_REDEEMED" || err?.code === "ALREADY_PRO") return err.code as string;
    throw err;
  });

  if (entitlement === "ALREADY_REDEEMED") {
    return res.status(409).json({ error: "This account has already used a trial code." });
  }
  if (entitlement === "ALREADY_PRO") {
    return res.status(409).json({ error: "You already have PRO — the trial code is for new PRO access only." });
  }
  res.json(entitlement);
});

// GET/PUT /billing/admin/trial-code — admin console manages the one shared code + whether it's
// currently switched on, no Hostinger env-var edit ever needed for this.
billingRouter.get("/admin/trial-code", requireAdmin, async (_req, res) => {
  const row = await prisma.trialPromoCode.findUnique({ where: { id: "singleton" } });
  res.json({ code: row?.code ?? null, active: row?.active ?? false });
});

billingRouter.put("/admin/trial-code", requireAdmin, async (req, res) => {
  const { code, active } = req.body ?? {};
  if (code !== undefined && (typeof code !== "string" || !code.trim())) {
    return res.status(400).json({ error: "code must be a non-empty string" });
  }
  const row = await prisma.trialPromoCode.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", code: code ? normalizeTrialCode(code) : "TRIAL", active: active ?? true },
    update: {
      ...(code !== undefined ? { code: normalizeTrialCode(code) } : {}),
      ...(active !== undefined ? { active: !!active } : {}),
    },
  });
  res.json({ code: row.code, active: row.active });
});
