import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const benchmarksRouter = Router();

const CATEGORIES = ["dining", "groceries", "shopping", "entertainment", "travel", "fuel"];

// GET /benchmarks/compare — compares the user's last-3-months category spend mix against SYNTHETIC
// seed data (see seed/seedBenchmarks.ts) for their city/income bracket. Every response carries
// isSynthetic: true — this is illustrative/modeled data, not a real aggregate across other users,
// until there's a large enough opted-in user base to compute one for real.
benchmarksRouter.get("/compare", requireUser, async (req: UserRequest, res) => {
  const uid = req.userId!;

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user?.city || !user?.incomeBracket) {
    return res.status(400).json({
      error: "Set your city and income bracket in Profile to see this comparison",
      needsProfile: true,
    });
  }

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const [userSpend, totalSpendAgg, benchmarks] = await Promise.all([
    prisma.smsTransaction.groupBy({
      by: ["category"],
      where: { userId: uid, txnDate: { gte: threeMonthsAgo }, category: { in: CATEGORIES } },
      _sum: { amount: true },
    }),
    prisma.smsTransaction.aggregate({
      where: { userId: uid, txnDate: { gte: threeMonthsAgo }, category: { notIn: ["income", "transfer", "savings"] } },
      _sum: { amount: true },
    }),
    prisma.cityIncomeBracketBenchmark.findMany({ where: { city: user.city, incomeBracket: user.incomeBracket } }),
  ]);

  const totalSpend = Math.abs(totalSpendAgg._sum.amount ?? 0);
  const benchmarkMap = new Map(benchmarks.map((b) => [b.category, b.avgSpendPct]));

  const comparison = userSpend.map((c) => {
    const spend = Math.abs(c._sum.amount ?? 0);
    const userPct = totalSpend > 0 ? (spend / totalSpend) * 100 : 0;
    const benchmarkPct = benchmarkMap.get(c.category ?? "") ?? null;
    return {
      category: c.category,
      userPct: Math.round(userPct * 10) / 10,
      benchmarkPct,
      deltaPct: benchmarkPct !== null ? Math.round((userPct - benchmarkPct) * 10) / 10 : null,
    };
  });

  res.json({ city: user.city, incomeBracket: user.incomeBracket, comparison, isSynthetic: true });
});
