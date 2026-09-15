import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { referralRedeemLimiter } from "../../lib/rateLimiters.js";
import { extendProEntitlementDays } from "../../lib/proEntitlement.js";

export const referralsRouter = Router();

// Referrer's reward per unique qualifying referral — the "refer friends, keep PRO forever" pitch.
// Referred user keeps the original flat welcome bonus (unchanged from before this reward bump).
const REFERRER_BONUS_COINS = 500;
const REFERRER_PRO_DAYS = 1;
const REFERRED_BONUS_COINS = 100;

// Circuit breaker, not a wall: the device-uniqueness guard (ReferralDeviceClaim) only stops one
// physical install from being credited twice — it does nothing to cap total volume into a single
// referrer account, since deviceIdentifier is a client-supplied string with no hardware attestation
// behind it. Coins redeem for real instant-voucher codes+PINs, so unbounded farming is money-
// adjacent, not cosmetic. 30/day is well above what a genuinely viral referrer hits in practice
// (bounding daily damage + giving GET /referrals/admin/flagged a window to catch it), not a
// realistic ceiling on organic growth — see the Terms of Service / Pricing page copy this number
// must stay in sync with.
const DAILY_REFERRAL_CAP_PER_REFERRER = 30;

// Same shape as household's generateInviteCode() (householdRouter.ts) — 8-char hex, short enough
// to type/share, collision odds negligible at this scale.
function generateReferralCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

async function getOrCreateReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.referralCode) return user.referralCode;

  // Retry on the astronomically unlikely collision rather than pre-checking uniqueness — same
  // race-tolerant approach as household invite codes.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { referralCode: generateReferralCode() },
      });
      return updated.referralCode!;
    } catch (err: any) {
      if (err.code !== "P2002") throw err;
    }
  }
  throw new Error("Could not generate a unique referral code");
}

// GET /referrals/me — own code, running totals, and the full timestamped history so Settings ->
// Referrals can show "when" each one landed. Never includes anything identifying the *referred*
// side (name/email/phone) — this is the referrer's own view of their own earnings, not a lookup
// tool on other accounts.
referralsRouter.get("/me", requireUser, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const [referralCode, conversions] = await Promise.all([
    getOrCreateReferralCode(userId),
    prisma.referralConversion.findMany({
      where: { referrerUserId: userId },
      orderBy: { completedAt: "desc" },
    }),
  ]);
  res.json({
    referralCode,
    referralCount: conversions.length,
    totalCoinsEarned: conversions.reduce((sum, c) => sum + c.coinsAwarded, 0),
    totalProDaysEarned: conversions.reduce((sum, c) => sum + c.proDaysAwarded, 0),
    conversions: conversions.map((c) => ({
      id: c.id,
      coinsAwarded: c.coinsAwarded,
      proDaysAwarded: c.proDaysAwarded,
      completedAt: c.completedAt,
    })),
  });
});

// POST /referrals/redeem — { code, deviceIdentifier } — the *new* user redeems someone else's code
// once, crediting both sides. userId always comes from the verified token, never the request body.
//
// Anti-abuse gates:
//   1. BOTH accounts must be a real signed-in identity (Google/phone), not the anonymous pre-login
//      session every install starts in. Anonymous accounts have no unique email/phone: gating only
//      the referred side left one anonymous "beneficiary" account able to farm unlimited coins/PRO
//      by looping fresh referred identities into it — requiring the referrer to be real too caps
//      that at "one real identity per beneficiary account", not per farming iteration.
//   2. The device (a per-install id, minted client-side and unrelated to any account — resets on
//      uninstall/reinstall, so this is a speed bump against casual in-app abuse, not a hard limit
//      against a scripted/API-level attacker) can complete at most one referral, ever — enforced by
//      ReferralDeviceClaim, a table with no FK to User so it survives the referred account later
//      being deleted (see that model's comment, and the matching warning next to the DELETE
//      /auth/me transaction in authRouter.ts). This is what stops "redeem -> delete account -> sign
//      back in with the same real identity -> redeem again" from being a free unlimited-PRO loop.
//   3. DAILY_REFERRAL_CAP_PER_REFERRER bounds how many conversions one referrer can be credited
//      with per rolling 24h — see that constant's comment for why this is a circuit breaker, not a
//      realistic ceiling on organic referring.
//
// The device claim is created INSIDE the same transaction as the conversion/coins/entitlement, not
// as a separate up-front statement — an earlier version claimed the device first and only released
// it on the "already redeemed" outcome, which left every OTHER failure (a DB blip, extendPro
// EntitlementDays exhausting its retries, an edge 502) permanently burning a legitimate device with
// no compensating release. Doing it all in one transaction means ANY failure rolls the claim back
// too, so a transient error costs a retry, never a lifetime lockout.
referralsRouter.post("/redeem", referralRedeemLimiter, requireUser, async (req: UserRequest, res) => {
  const { code, deviceIdentifier } = req.body ?? {};
  if (!code || typeof code !== "string") return res.status(400).json({ error: "code is required" });
  if (!deviceIdentifier || typeof deviceIdentifier !== "string") {
    return res.status(400).json({ error: "deviceIdentifier is required" });
  }
  const referredUserId = req.userId!;

  const referredUser = await prisma.user.findUniqueOrThrow({ where: { id: referredUserId } });
  if (!referredUser.authProvider || referredUser.authProvider === "anonymous") {
    return res.status(403).json({ error: "Sign in with a real account (Google or phone) before redeeming a referral code" });
  }

  const referrer = await prisma.user.findUnique({ where: { referralCode: String(code).toUpperCase() } });
  // A code minted by an account that's still anonymous (GET /referrals/me mints one lazily for
  // anyone, including a pre-login session) can never be validly redeemed — treated identically to
  // an unknown code so this doesn't leak why to the redeemer.
  if (!referrer || !referrer.authProvider || referrer.authProvider === "anonymous") {
    return res.status(404).json({ error: "Invalid referral code" });
  }
  if (referrer.id === referredUserId) return res.status(400).json({ error: "You can't redeem your own referral code" });

  // Checked BEFORE the transaction, not inside it: this is advisory, not a hard atomic guarantee —
  // a 31st redeem slipping through a race against a 30th is harmless (it's a circuit breaker, not a
  // precise limit). The alternative (checking inside the transaction) would roll back the referred
  // user's own 100-coin welcome bonus alongside the referrer's rejected credit, handing a genuinely
  // new signup a confusing "someone else's account hit a limit" error and nothing for their own
  // sign-up. Checking here means a capped referrer costs the friend nothing but the referral bonus.
  const recentCount = await prisma.referralConversion.count({
    where: { referrerUserId: referrer.id, completedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  if (recentCount >= DAILY_REFERRAL_CAP_PER_REFERRER) {
    return res.status(429).json({ error: "This referral code has reached its daily limit — ask your friend to try again tomorrow" });
  }

  try {
    await prisma.$transaction(async (tx) => {
      try {
        await tx.referralDeviceClaim.create({
          data: { deviceIdentifier, referrerUserId: referrer.id, referredUserId },
        });
      } catch (err: any) {
        if (err.code === "P2002") throw Object.assign(new Error("DEVICE_ALREADY_USED"), { code: "DEVICE_ALREADY_USED" });
        throw err;
      }
      try {
        await tx.referralConversion.create({
          data: { referrerUserId: referrer.id, referredUserId, coinsAwarded: REFERRER_BONUS_COINS, proDaysAwarded: REFERRER_PRO_DAYS },
        });
      } catch (err: any) {
        if (err.code === "P2002") throw Object.assign(new Error("ALREADY_REDEEMED"), { code: "ALREADY_REDEEMED" });
        throw err;
      }
      await tx.coinLedgerEntry.create({
        data: { userId: referrer.id, delta: REFERRER_BONUS_COINS, reason: "REFERRAL_BONUS" },
      });
      await tx.coinLedgerEntry.create({
        data: { userId: referredUserId, delta: REFERRED_BONUS_COINS, reason: "REFERRAL_BONUS" },
      });
      await extendProEntitlementDays(tx, referrer.id, REFERRER_PRO_DAYS, "referral_bonus");
    });
    res.status(201).json({ coinsAwarded: REFERRED_BONUS_COINS });
  } catch (err: any) {
    if (err.code === "DEVICE_ALREADY_USED") {
      const existing = await prisma.referralDeviceClaim.findUnique({ where: { deviceIdentifier } });
      // The claim's OWN account retrying (a network blip, or this route firing twice in quick
      // succession on app resume) already redeemed successfully — that's "already redeemed", not
      // "device already used", and must not bump the fraud flag below.
      if (existing && existing.referredUserId === referredUserId) {
        return res.status(409).json({ error: "You've already redeemed a referral code" });
      }
      // A DIFFERENT account behind this device's existing claim — bump the flag for admin review.
      // Runs as its own statement AFTER the transaction above rolled back, so it always sticks.
      if (existing) {
        await prisma.referralDeviceClaim
          .update({ where: { deviceIdentifier }, data: { rejectedAttempts: { increment: 1 }, lastRejectedAt: new Date() } })
          .catch(() => {});
      }
      return res.status(409).json({ error: "This device has already been used to redeem a referral code" });
    }
    if (err.code === "ALREADY_REDEEMED") {
      return res.status(409).json({ error: "You've already redeemed a referral code" });
    }
    throw err;
  }
});

// GET /referrals/admin/flagged — requireAdmin — devices with at least one rejected reuse attempt,
// for fraud review/support. Newest-flagged first, capped at 200 (no pagination UI for this yet).
referralsRouter.get("/admin/flagged", requireAdmin, async (_req, res) => {
  const flagged = await prisma.referralDeviceClaim.findMany({
    where: { rejectedAttempts: { gt: 0 } },
    orderBy: { lastRejectedAt: "desc" },
    take: 200,
  });
  res.json(flagged);
});
