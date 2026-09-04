import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const referralsRouter = Router();

// Flat bonus for both sides of a completed referral — easy to tune later without a schema change
// (Voucher pricing is already admin-configurable; this one constant isn't yet, same simplicity
// level as the original "shared QA redeem code" approach used for PRO before Play Billing existed).
const REFERRAL_BONUS_COINS = 100;

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

// GET /referrals/me — own code + how many successful referrals it's earned.
referralsRouter.get("/me", requireUser, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const [referralCode, conversions] = await Promise.all([
    getOrCreateReferralCode(userId),
    prisma.referralConversion.findMany({ where: { referrerUserId: userId } }),
  ]);
  res.json({
    referralCode,
    referralCount: conversions.length,
    totalCoinsEarned: conversions.reduce((sum, c) => sum + c.coinsAwarded, 0),
  });
});

// POST /referrals/redeem — { code } — the *new* user redeems someone else's code once, crediting
// both sides. userId always comes from the verified token, never the request body.
referralsRouter.post("/redeem", requireUser, async (req: UserRequest, res) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: "code is required" });
  const referredUserId = req.userId!;

  const referrer = await prisma.user.findUnique({ where: { referralCode: String(code).toUpperCase() } });
  if (!referrer) return res.status(404).json({ error: "Invalid referral code" });
  if (referrer.id === referredUserId) return res.status(400).json({ error: "You can't redeem your own referral code" });

  try {
    await prisma.$transaction([
      prisma.referralConversion.create({
        data: { referrerUserId: referrer.id, referredUserId, coinsAwarded: REFERRAL_BONUS_COINS },
      }),
      prisma.coinLedgerEntry.create({
        data: { userId: referrer.id, delta: REFERRAL_BONUS_COINS, reason: "REFERRAL_BONUS" },
      }),
      prisma.coinLedgerEntry.create({
        data: { userId: referredUserId, delta: REFERRAL_BONUS_COINS, reason: "REFERRAL_BONUS" },
      }),
    ]);
    res.status(201).json({ coinsAwarded: REFERRAL_BONUS_COINS });
  } catch (err: any) {
    if (err.code === "P2002") return res.status(409).json({ error: "You've already redeemed a referral code" });
    throw err;
  }
});
