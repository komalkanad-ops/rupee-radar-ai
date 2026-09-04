import * as Sentry from "@sentry/node";
import { Router } from "express";
import { google } from "googleapis";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireUser, type UserRequest } from "../auth/authMiddleware.js";

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

// POST /billing/redeem-test-code — { userId, code } -> grants a PRO entitlement for a year without
// going through Play Billing. Exists purely so PRO features (job-loss runway, LLM SMS fallback,
// insight narratives) can be QA'd before the Play Console app + real subscription products exist.
// Gated behind PRO_TEST_REDEEM_CODE in .env — unset it (or delete this route) before a public launch.
billingRouter.post("/redeem-test-code", requireUser, async (req: UserRequest, res) => {
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

// POST /billing/beta-unlock — while the app is in free beta (no real Play Billing customers yet),
// any signed-in user can flip PRO on with one tap, no code to type or get wrong. Gated on the same
// PRO_TEST_REDEEM_CODE env var being present as the "we're in free-beta mode" signal — unset that
// var (the documented launch step) and this 501s, existing entitlements untouched. Every unlock is
// still a real ProEntitlement row so it can be seen / revoked from the admin console.
billingRouter.get("/beta-status", async (_req, res) => {
  res.json({ betaFreeProAvailable: !!process.env.PRO_TEST_REDEEM_CODE });
});

billingRouter.post("/beta-unlock", requireUser, async (req: UserRequest, res) => {
  if (!process.env.PRO_TEST_REDEEM_CODE) {
    return res.status(501).json({ error: "Free beta PRO has ended — subscribe through Google Play." });
  }
  const expiryAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const entitlement = await prisma.proEntitlement.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, productId: "beta_free", expiryAt, verifiedAt: new Date(), status: "active" },
    update: { productId: "beta_free", expiryAt, verifiedAt: new Date(), status: "active" },
  });
  res.json(entitlement);
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
