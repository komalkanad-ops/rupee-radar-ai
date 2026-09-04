import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { requirePro } from "../auth/proMiddleware.js";

export const networthRouter = Router();

function sumValues(obj: Record<string, number> | undefined | null): number {
  if (!obj) return 0;
  return Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0);
}

// POST /networth/snapshot — { month: "2026-08", assets: {cash, bank, investments, ...},
// liabilities: {creditCardDue, loans, ...} }
networthRouter.post("/snapshot", requireUser, async (req: UserRequest, res) => {
  const { month, assets, liabilities, monthlyIncomeInr } = req.body ?? {};
  if (!month || !assets || !liabilities) {
    return res.status(400).json({ error: "month, assets, liabilities are required" });
  }
  const userId = req.userId!;

  const totalNetWorth = sumValues(assets) - sumValues(liabilities);
  const monthDate = new Date(`${month}-01T00:00:00.000Z`);

  const snapshot = await prisma.netWorthSnapshot.upsert({
    where: { userId_month: { userId, month: monthDate } },
    create: { userId, month: monthDate, assets, liabilities, totalNetWorth, monthlyIncomeInr },
    update: { assets, liabilities, totalNetWorth, monthlyIncomeInr },
  });
  res.json(snapshot);
});

networthRouter.get("/history", requireUser, async (req: UserRequest, res) => {
  const history = await prisma.netWorthSnapshot.findMany({
    where: { userId: req.userId },
    orderBy: { month: "asc" },
  });
  res.json(history);
});

// GET /networth/runway — PRO feature: "if I lost my job today, how long could I last?"
// runwayMonths = liquid assets / avg monthly essential burn (last 3 months of SMS spend on
// non-discretionary categories, plus committed recurring payments: EMIs/loans/subscriptions).
networthRouter.get("/runway", requireUser, requirePro, async (req: UserRequest, res) => {
  const uid = req.userId!;

  const latestSnapshot = await prisma.netWorthSnapshot.findFirst({
    where: { userId: uid },
    orderBy: { month: "desc" },
  });
  if (!latestSnapshot) {
    return res.status(400).json({ error: "No net worth snapshot yet — add assets/liabilities first" });
  }

  const assets = latestSnapshot.assets as Record<string, number>;
  // Liquid = cash + bank + easily-sellable investments; excludes illiquid ones like property/PF.
  const liquidNetWorth =
    (assets.cash ?? 0) + (assets.bank ?? 0) + (assets.liquidInvestments ?? 0) -
    sumValues(latestSnapshot.liabilities as Record<string, number>);

  const essentialCategories = ["groceries", "utilities", "rent", "emi", "insurance", "fuel"];
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const essentialSpend = await prisma.smsTransaction.aggregate({
    where: { userId: uid, txnDate: { gte: threeMonthsAgo }, category: { in: essentialCategories } },
    _sum: { amount: true },
  });

  const recurringCommitted = await prisma.recurringPayment.aggregate({
    where: { userId: uid, active: true, type: { in: ["LOAN", "EMI", "SIP"] } },
    _sum: { amount: true },
  });

  // Dynamic Shock Simulator needs a real trailing-income figure to model a partial (not just
  // total) income-loss scenario — same trailing-3-month window as the essential-spend baseline
  // above, so both numbers are apples-to-apples.
  const incomeSum = await prisma.smsTransaction.aggregate({
    where: { userId: uid, txnDate: { gte: threeMonthsAgo }, category: "income" },
    _sum: { amount: true },
  });
  const avgMonthlyIncomeInr = (incomeSum._sum.amount ?? 0) / 3;

  const avgMonthlyEssentialFromSms = (essentialSpend._sum.amount ?? 0) / 3;
  const monthlyCommitted = recurringCommitted._sum.amount ?? 0;
  const avgMonthlyBurn = avgMonthlyEssentialFromSms + monthlyCommitted;

  const runwayMonths = avgMonthlyBurn > 0 ? liquidNetWorth / avgMonthlyBurn : null;

  res.json({
    liquidNetWorth,
    avgMonthlyEssentialSpend: Math.round(avgMonthlyEssentialFromSms),
    monthlyCommittedPayments: Math.round(monthlyCommitted),
    avgMonthlyBurn: Math.round(avgMonthlyBurn),
    avgMonthlyIncomeInr: Math.round(avgMonthlyIncomeInr),
    runwayMonths: runwayMonths !== null ? Math.round(runwayMonths * 10) / 10 : null,
  });
});
