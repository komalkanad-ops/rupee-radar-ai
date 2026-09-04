import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const walletRouter = Router();

// GET /wallet — cards the user has self-added as "actually owned" (distinct from the Android app's
// local-only bookmark/favorite list).
walletRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const entries = await prisma.userCreditCard.findMany({
    where: { userId: req.userId, status: "ACTIVE" },
    include: { card: { include: { bank: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(entries);
});

// POST /wallet — { cardId, acquiredAt? }
walletRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const { cardId, acquiredAt } = req.body ?? {};
  if (!cardId) return res.status(400).json({ error: "cardId is required" });

  const entry = await prisma.userCreditCard.create({
    data: { userId: req.userId!, cardId, acquiredAt: acquiredAt ? new Date(acquiredAt) : undefined },
  });
  res.status(201).json(entry);
});

async function loadOwnedWalletEntry(id: string, userId: string) {
  const existing = await prisma.userCreditCard.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

// The calendar quarter boundary lounge-visit counts and milestone-fee-waiver trackers reset on —
// matches how card issuers themselves reset "N free visits per quarter" benefits.
function currentQuarterStart(now: Date): Date {
  const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
  return new Date(now.getFullYear(), quarterMonth, 1);
}

// PATCH /wallet/:id/credit-info — { creditLimitInr?, currentOutstandingInr?, rewardPointsBalance?,
// rewardPointsExpiryDate? }, self-reported since there's no card-issuer API anywhere in this stack
// to pull any of these automatically.
walletRouter.patch("/:id/credit-info", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedWalletEntry(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const { creditLimitInr, currentOutstandingInr, rewardPointsBalance, rewardPointsExpiryDate } = req.body ?? {};
  const entry = await prisma.userCreditCard.update({
    where: { id: req.params.id },
    data: {
      creditLimitInr: creditLimitInr === undefined ? undefined : creditLimitInr,
      currentOutstandingInr: currentOutstandingInr === undefined ? undefined : currentOutstandingInr,
      rewardPointsBalance: rewardPointsBalance === undefined ? undefined : rewardPointsBalance,
      rewardPointsExpiryDate:
        rewardPointsExpiryDate === undefined ? undefined : rewardPointsExpiryDate ? new Date(rewardPointsExpiryDate) : null,
    },
  });
  res.json(entry);
});

// POST /wallet/:id/lounge-visit — self-reported check-in, appended to an append-only log (mirrors
// CoinLedgerEntry's pattern) so quarterly/milestone counts are computed on read, never denormalized.
walletRouter.post("/:id/lounge-visit", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedWalletEntry(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.loungeVisit.create({ data: { userCreditCardId: req.params.id } });
  const visits = await prisma.loungeVisit.findMany({ where: { userCreditCardId: req.params.id } });
  const quarterStart = currentQuarterStart(new Date());
  const loungeVisitsThisQuarter = visits.filter((v) => v.visitedAt >= quarterStart).length;
  res.status(201).json({ loungeVisitsThisQuarter, totalLoungeVisits: visits.length });
});

walletRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedWalletEntry(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.userCreditCard.update({ where: { id: req.params.id }, data: { status: "CLOSED" } });
  res.status(204).send();
});

// POST /wallet/:id/checkin — self-reported "still using this card" confirmation, since there's no
// per-transaction card attribution in this schema to detect real usage automatically.
walletRouter.post("/:id/checkin", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedWalletEntry(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const entry = await prisma.userCreditCard.update({
    where: { id: req.params.id },
    data: { lastConfirmedUsedAt: new Date() },
  });
  res.json(entry);
});

// GET /wallet/health — flags "dead weight" cards: fee-bearing, and either never confirmed used or
// not confirmed in 90+ days, and held for over a year (so a genuinely brand-new card isn't flagged
// before the user has had a chance to use it).
walletRouter.get("/health", requireUser, async (req: UserRequest, res) => {
  const entries = await prisma.userCreditCard.findMany({
    where: { userId: req.userId, status: "ACTIVE" },
    include: { card: true, loungeVisits: true },
  });

  const now = Date.now();
  const ninetyDaysMs = 90 * 86400000;
  const oneYearMs = 365 * 86400000;
  const quarterStart = currentQuarterStart(new Date());

  const results = entries.map((e) => {
    const fee = e.card.annualFeeInr;
    const heldOverAYear = e.acquiredAt ? now - e.acquiredAt.getTime() > oneYearMs : false;
    const staleUsage =
      !e.lastConfirmedUsedAt || now - e.lastConfirmedUsedAt.getTime() > ninetyDaysMs;
    const deadWeight = fee > 0 && heldOverAYear && staleUsage;

    let suggestion: string | null = null;
    if (deadWeight) {
      suggestion = e.card.feeWaiverCondition
        ? `Paying ₹${fee}/yr on a card you haven't confirmed using recently. Check if you meet the fee-waiver condition (${e.card.feeWaiverCondition}), or ask for a downgrade.`
        : `Paying ₹${fee}/yr on a card you haven't confirmed using recently — consider asking for a downgrade to a no-fee variant.`;
    }

    return {
      id: e.id,
      card: { id: e.card.id, name: e.card.name, annualFeeInr: fee, loungeAccess: e.card.loungeAccess },
      acquiredAt: e.acquiredAt,
      lastConfirmedUsedAt: e.lastConfirmedUsedAt,
      deadWeight,
      suggestion,
      // Closing your oldest card can hurt average account age / utilization ratio more than a
      // downgrade would — static guidance, not a real credit-bureau integration.
      protectCreditScoreNote: deadWeight
        ? "Closing your oldest card can hurt your credit score more than keeping it open — ask the bank for a downgrade instead of a closure where possible."
        : null,
      creditLimitInr: e.creditLimitInr,
      currentOutstandingInr: e.currentOutstandingInr,
      loungeVisitsThisQuarter: e.loungeVisits.filter((v) => v.visitedAt >= quarterStart).length,
      rewardPointsBalance: e.rewardPointsBalance,
      rewardPointsExpiryDate: e.rewardPointsExpiryDate,
    };
  });

  res.json(results);
});
