import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const challengesRouter = Router();

// Same essential/non-essential split used by networthRouter's runway calculator, reused here so
// NO_SPEND_WEEKEND checks "discretionary" spend rather than penalizing rent/EMI/utilities.
const ESSENTIAL_CATEGORIES = ["groceries", "utilities", "rent", "emi", "insurance", "fuel"];

// GET /challenges/catalog — active challenges available to join.
challengesRouter.get("/catalog", async (_req, res) => {
  const items = await prisma.challenge.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } });
  res.json(items);
});

challengesRouter.post("/catalog", requireAdmin, async (req, res) => {
  const item = await prisma.challenge.create({ data: req.body });
  res.status(201).json(item);
});

challengesRouter.put("/catalog/:id", requireAdmin, async (req, res) => {
  const item = await prisma.challenge.update({ where: { id: req.params.id }, data: req.body });
  res.json(item);
});

// Soft-delete (active: false) rather than a hard delete — existing UserChallenge rows for this
// challenge stay intact/queryable, same convention as RecurringPayment's DELETE.
challengesRouter.delete("/catalog/:id", requireAdmin, async (req, res) => {
  await prisma.challenge.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});

challengesRouter.get("/badges", async (_req, res) => {
  const items = await prisma.badge.findMany({ orderBy: { title: "asc" } });
  res.json(items);
});

challengesRouter.post("/badges", requireAdmin, async (req, res) => {
  const item = await prisma.badge.create({ data: req.body });
  res.status(201).json(item);
});

challengesRouter.put("/badges/:id", requireAdmin, async (req, res) => {
  const item = await prisma.badge.update({ where: { id: req.params.id }, data: req.body });
  res.json(item);
});

challengesRouter.delete("/badges/:id", requireAdmin, async (req, res) => {
  await prisma.badge.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// POST /challenges/join — { challengeKey }
challengesRouter.post("/join", requireUser, async (req: UserRequest, res) => {
  const { challengeKey } = req.body ?? {};
  if (!challengeKey) return res.status(400).json({ error: "challengeKey is required" });

  const challenge = await prisma.challenge.findUnique({ where: { key: challengeKey } });
  if (!challenge || !challenge.active) return res.status(404).json({ error: "Challenge not found" });

  const endsAt = new Date(Date.now() + challenge.durationDays * 86400000);
  const userChallenge = await prisma.userChallenge.create({
    data: { userId: req.userId!, challengeId: challenge.id, endsAt },
  });
  res.status(201).json(userChallenge);
});

async function computeNoSpendWeekendProgress(userId: string, startedAt: Date, endsAt: Date) {
  const spend = await prisma.smsTransaction.aggregate({
    where: {
      userId,
      txnDate: { gte: startedAt, lt: endsAt },
      category: { notIn: [...ESSENTIAL_CATEGORIES, "income", "transfer", "savings"] },
    },
    _sum: { amount: true },
  });
  const spent = Math.abs(spend._sum.amount ?? 0);
  return { spent, met: spent <= 0 };
}

async function computeSaveAmountProgress(userId: string, startedAt: Date, endsAt: Date, targetAmount: number) {
  const windowDays = Math.max(1, Math.round((endsAt.getTime() - startedAt.getTime()) / 86400000));
  const threeMonthsAgo = new Date(startedAt.getTime() - 90 * 86400000);

  const [baseline, actual] = await Promise.all([
    prisma.smsTransaction.aggregate({
      where: { userId, txnDate: { gte: threeMonthsAgo, lt: startedAt }, category: { notIn: ["income", "transfer", "savings"] } },
      _sum: { amount: true },
    }),
    prisma.smsTransaction.aggregate({
      where: { userId, txnDate: { gte: startedAt, lt: new Date() }, category: { notIn: ["income", "transfer", "savings"] } },
      _sum: { amount: true },
    }),
  ]);

  const dailyBaseline = Math.abs(baseline._sum.amount ?? 0) / 90;
  const expectedByNow = dailyBaseline * Math.min(windowDays, Math.round((Date.now() - startedAt.getTime()) / 86400000));
  const actualSpend = Math.abs(actual._sum.amount ?? 0);
  const saved = Math.max(0, Math.round(expectedByNow - actualSpend));
  return { saved, met: saved >= targetAmount };
}

// Awards the badge whose key matches the challenge's key, if one exists and isn't already earned.
async function awardBadgeIfAny(userId: string, challengeKey: string) {
  const badge = await prisma.badge.findUnique({ where: { key: challengeKey } });
  if (!badge) return;
  await prisma.userBadge.upsert({
    where: { userId_badgeId: { userId, badgeId: badge.id } },
    create: { userId, badgeId: badge.id },
    update: {},
  });
}

// GET /challenges/active — the user's in-progress and recently-resolved challenges, with live
// progress computed against SmsTransaction. ACTIVE ones past their window auto-resolve to
// COMPLETED/FAILED on this read (and award a matching badge on completion) rather than needing a
// separate cron/claim step.
challengesRouter.get("/active", requireUser, async (req: UserRequest, res) => {
  const uid = req.userId!;

  const userChallenges = await prisma.userChallenge.findMany({
    where: { userId: uid, status: { in: ["ACTIVE", "COMPLETED"] } },
    include: { challenge: true },
    orderBy: { startedAt: "desc" },
  });

  const results = [];
  for (const uc of userChallenges) {
    if (uc.status !== "ACTIVE") {
      results.push({ ...uc, progress: uc.progressJson });
      continue;
    }

    const windowOver = new Date() >= uc.endsAt;
    let progress: Record<string, unknown> = {};
    let met = false;

    if (uc.challenge.type === "NO_SPEND_WEEKEND") {
      const r = await computeNoSpendWeekendProgress(uid, uc.startedAt, uc.endsAt);
      progress = r;
      met = r.met;
    } else if (uc.challenge.type === "SAVE_AMOUNT") {
      const r = await computeSaveAmountProgress(uid, uc.startedAt, uc.endsAt, uc.challenge.targetAmount ?? 0);
      progress = r;
      met = r.met;
    } else {
      results.push({ ...uc, progress: {} });
      continue;
    }

    if (windowOver) {
      const status = met ? "COMPLETED" : "FAILED";
      const updated = await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { status, progressJson: progress as object },
      });
      if (status === "COMPLETED") await awardBadgeIfAny(uid, uc.challenge.key);
      results.push({ ...updated, challenge: uc.challenge, progress });
    } else if (met && uc.challenge.type === "SAVE_AMOUNT") {
      // SAVE_AMOUNT can complete early, once the target is hit, rather than waiting out the window.
      const updated = await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { status: "COMPLETED", progressJson: progress as object },
      });
      await awardBadgeIfAny(uid, uc.challenge.key);
      results.push({ ...updated, challenge: uc.challenge, progress });
    } else {
      results.push({ ...uc, progress });
    }
  }

  res.json(results);
});
