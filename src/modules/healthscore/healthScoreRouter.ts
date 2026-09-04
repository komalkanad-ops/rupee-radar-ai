import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { isEssential, isSpendCategory } from "../insights/periodMath.js";

export const healthScoreRouter = Router();

// Emergency-fund coverage + debt-to-income, rolled into one 0-100 "safety net" sub-score.
// EF: 0 months -> 0, 6+ months -> 100 (linear). DTI: <=20% -> 100, >=50% -> 0 (linear). Neutral 50
// when the denominator is missing (no snapshot / no income), same "don't penalize a blank account"
// convention as the other factors.
async function computeSafetyNetScore(userId: string, asOf: Date): Promise<{ score: number; efMonths: number | null; dtiPct: number | null }> {
  const trailingStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 2, 1));
  const [txns, snapshot, loans, recurring] = await Promise.all([
    prisma.smsTransaction.findMany({ where: { userId, txnDate: { gte: trailingStart } }, select: { amount: true, category: true } }),
    prisma.netWorthSnapshot.findFirst({ where: { userId }, orderBy: { month: "desc" } }),
    prisma.loan.findMany({ where: { userId, active: true }, select: { emiAmount: true } }),
    prisma.recurringPayment.findMany({ where: { userId, active: true, type: { in: ["EMI", "LOAN", "CREDIT_CARD_BILL"] } }, select: { amount: true } }),
  ]);

  const income = txns.filter((t) => t.category === "income").reduce((s, t) => s + Math.abs(t.amount), 0);
  const essential = txns.filter((t) => isEssential(t.category)).reduce((s, t) => s + Math.abs(t.amount), 0);
  const spend = txns.filter((t) => isSpendCategory(t.category)).reduce((s, t) => s + Math.abs(t.amount), 0);
  void spend;
  const avgMonthlyIncome = income / 3;
  const avgMonthlyEssential = essential / 3;

  const assets = (snapshot?.assets ?? {}) as Record<string, number>;
  const liquid = (assets.cash ?? 0) + (assets.bank ?? 0) + (assets.liquidInvestments ?? 0);
  const efMonths = avgMonthlyEssential > 0 ? liquid / avgMonthlyEssential : null;

  const monthlyDebt = loans.reduce((s, l) => s + l.emiAmount, 0) + recurring.reduce((s, r) => s + r.amount, 0);
  const dtiPct = avgMonthlyIncome > 0 ? Math.round((monthlyDebt / avgMonthlyIncome) * 100) : null;

  const efScore = efMonths == null ? 50 : Math.max(0, Math.min(100, (efMonths / 6) * 100));
  const dtiScore = dtiPct == null ? 50 : Math.max(0, Math.min(100, 100 - ((dtiPct - 20) / 30) * 100));
  return {
    score: Math.round((efScore + dtiScore) / 2),
    efMonths: efMonths == null ? null : +efMonths.toFixed(1),
    dtiPct,
  };
}

const STREAK_THRESHOLD = 70;

// % of the last 6 months where total non-income spend was <= the trailing-3-month average for that
// month — same "baseline as budget" convention as insightsRouter's /budget-status, just rolled up
// across all categories instead of per-category. Months with no baseline (not enough history yet)
// are excluded from the denominator rather than counted as a miss.
async function computeBudgetAdherence(userId: string, asOf: Date): Promise<{ pct: number; monthsEvaluated: number }> {
  const monthsToCheck = 6;
  let underBudgetCount = 0;
  let evaluated = 0;

  // A user's own total monthly budget (sum of per-category limits) takes precedence over the
  // trailing-3-month-average baseline when they've set any budgets at all.
  const userBudgets = await prisma.budget.findMany({ where: { userId }, select: { monthlyLimitInr: true } });
  const totalUserBudget = userBudgets.reduce((s, b) => s + b.monthlyLimitInr, 0);

  for (let i = 0; i < monthsToCheck; i++) {
    const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i, 1));
    const monthEnd = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i + 1, 1));
    const baselineStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i - 3, 1));

    const [current, baseline] = await Promise.all([
      prisma.smsTransaction.aggregate({
        where: { userId, txnDate: { gte: monthStart, lt: monthEnd }, category: { notIn: ["income", "transfer", "savings"] } },
        _sum: { amount: true },
      }),
      prisma.smsTransaction.aggregate({
        where: { userId, txnDate: { gte: baselineStart, lt: monthStart }, category: { notIn: ["income", "transfer", "savings"] } },
        _sum: { amount: true },
      }),
    ]);

    const spend = Math.abs(current._sum.amount ?? 0);
    const budget = totalUserBudget > 0 ? totalUserBudget : Math.abs(baseline._sum.amount ?? 0) / 3;
    if (budget > 0) {
      evaluated += 1;
      if (spend <= budget) underBudgetCount += 1;
    }
  }

  // Not enough transaction history to judge either way — neutral default instead of penalizing a
  // brand-new account.
  if (evaluated === 0) return { pct: 50, monthsEvaluated: 0 };
  return { pct: Math.round((underBudgetCount / evaluated) * 100), monthsEvaluated: evaluated };
}

// No payment-confirmation log exists in this schema, so "on-time" is approximated as "nothing
// currently overdue" rather than a true payment history — see the `note` field in the response.
async function computeBillDiligence(userId: string): Promise<number> {
  const bills = await prisma.recurringPayment.findMany({
    where: { userId, active: true, type: { in: ["EMI", "LOAN", "CREDIT_CARD_BILL"] } },
    select: { nextDueDate: true },
  });
  if (bills.length === 0) return 100;

  const now = new Date();
  const overdue = bills.filter((b) => b.nextDueDate && b.nextDueDate < now).length;
  return Math.round(((bills.length - overdue) / bills.length) * 100);
}

// Distinct positive-value asset categories on the latest net worth snapshot, capped at 5 categories
// for a full score (cash, bank, investments, retirement/PPF, property/gold — a reasonable spread).
async function computeDiversification(userId: string): Promise<number> {
  const snapshot = await prisma.netWorthSnapshot.findFirst({ where: { userId }, orderBy: { month: "desc" } });
  if (!snapshot) return 0;

  const assets = snapshot.assets as Record<string, number>;
  const distinctCategories = Object.values(assets).filter((v) => Number(v) > 0).length;
  return Math.min(100, Math.round((distinctCategories / 5) * 100));
}

// The primary driver of the score, per explicit product direction: earning comfortably more than
// you spend should score high, spending close to or beyond what you earn should score low. Uses
// SmsTransaction directly (not NetWorthSnapshot.monthlyIncomeInr, which is a single user-entered
// figure) so it reflects real trailing behavior — averaged over 3 months so one unusually large
// purchase or a one-off bonus credit doesn't swing the score on its own. Excludes "transfer"
// (credit-card bill payments, refunds — see smsRules.ts's categoryForTxnType) from both sides, same
// as DashboardViewModel's own income/expense split.
const SAVINGS_RATE_MONTHS = 3;
async function computeSavingsRate(
  userId: string,
  asOf: Date,
): Promise<{ pct: number; avgMonthlyIncome: number; avgMonthlyExpense: number; hasData: boolean }> {
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (SAVINGS_RATE_MONTHS - 1), 1));
  const end = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1));

  const [incomeAgg, expenseAgg] = await Promise.all([
    prisma.smsTransaction.aggregate({
      where: { userId, txnDate: { gte: start, lt: end }, category: "income" },
      _sum: { amount: true },
    }),
    prisma.smsTransaction.aggregate({
      where: { userId, txnDate: { gte: start, lt: end }, category: { notIn: ["income", "transfer", "savings"] } },
      _sum: { amount: true },
    }),
  ]);

  const totalIncome = incomeAgg._sum.amount ?? 0;
  const totalExpense = Math.abs(expenseAgg._sum.amount ?? 0);
  const avgMonthlyIncome = Math.round(totalIncome / SAVINGS_RATE_MONTHS);
  const avgMonthlyExpense = Math.round(totalExpense / SAVINGS_RATE_MONTHS);

  if (totalIncome <= 0 && totalExpense <= 0) {
    return { pct: 0, avgMonthlyIncome: 0, avgMonthlyExpense: 0, hasData: false };
  }
  // Real spend with no tracked income at all is the worst case this formula can express — treat as
  // a full deficit rather than dividing by zero.
  const pct = totalIncome > 0 ? Math.round(((totalIncome - totalExpense) / totalIncome) * 100) : -100;
  return { pct, avgMonthlyIncome, avgMonthlyExpense, hasData: true };
}

// Linear around a 0%-savings-rate midpoint (score 50): every 1 percentage point of savings rate
// moves the score 2 points, so a 25% savings rate (a commonly cited "good" benchmark) tops out the
// component at 100, and spending 25% beyond income bottoms it out at 0. Neutral 50 default when
// there's no income/expense data yet, matching computeBudgetAdherence's "don't penalize a brand-new
// account" convention below.
function savingsScoreFrom(pct: number): number {
  return Math.max(0, Math.min(100, 50 + pct * 2));
}

// Score weights: savings rate is the dominant factor, per explicit product direction ("the score
// should depend on your spends vs how much you earn"); the other three pre-existing signals now
// share the remaining half evenly.
const WEIGHTS = { savings: 0.35, budgetAdherence: 0.15, billDiligence: 0.15, diversification: 0.15, safetyNet: 0.2 } as const;

// GET /health-score — computes this month's score, upserts the snapshot (same upsert-by-month
// pattern as POST /networth/snapshot), and returns it.
healthScoreRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const uid = req.userId!;

  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [budget, bill, diversification, savings, safetyNet] = await Promise.all([
    computeBudgetAdherence(uid, now),
    computeBillDiligence(uid),
    computeDiversification(uid),
    computeSavingsRate(uid, now),
    computeSafetyNetScore(uid, now),
  ]);

  const savingsScore = savings.hasData ? savingsScoreFrom(savings.pct) : 50;

  const score = Math.round(
    savingsScore * WEIGHTS.savings +
      budget.pct * WEIGHTS.budgetAdherence +
      bill * WEIGHTS.billDiligence +
      diversification * WEIGHTS.diversification +
      safetyNet.score * WEIGHTS.safetyNet,
  );
  const breakdown = {
    savingsScore,
    savingsRatePct: savings.pct,
    avgMonthlyIncome: savings.avgMonthlyIncome,
    avgMonthlyExpense: savings.avgMonthlyExpense,
    savingsHasData: savings.hasData,
    budgetAdherence: budget.pct,
    budgetMonthsEvaluated: budget.monthsEvaluated,
    billDiligence: bill,
    diversification,
    safetyNetScore: safetyNet.score,
    emergencyFundMonths: safetyNet.efMonths,
    debtToIncomePct: safetyNet.dtiPct,
    weights: WEIGHTS,
    note:
      "Savings rate (income vs spend, 3-month average) is the biggest single factor. Bill diligence " +
      "reflects whether EMI/loan/credit-card-bill entries are currently overdue, not a verified " +
      "on-time payment history. Budget adherence compares each month's spend to a trailing 3-month " +
      "average, not a user-set budget.",
  };

  const snapshot = await prisma.healthScoreSnapshot.upsert({
    where: { userId_month: { userId: uid, month } },
    create: { userId: uid, month, score, breakdown },
    update: { score, breakdown },
  });

  res.json(snapshot);
});

// GET /health-score/history?months=12 — trend line + streak (consecutive recent months scoring >=
// STREAK_THRESHOLD). Does not compute missing months on the fly — only returns snapshots that
// already exist, since GET /health-score is what creates them.
healthScoreRouter.get("/history", requireUser, async (req: UserRequest, res) => {
  const { months } = req.query;

  const monthCount = Math.min(Math.max(Number(months) || 12, 1), 36);
  const start = new Date();
  start.setMonth(start.getMonth() - (monthCount - 1));
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const history = await prisma.healthScoreSnapshot.findMany({
    where: { userId: req.userId, month: { gte: start } },
    orderBy: { month: "asc" },
  });

  let streakMonths = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].score >= STREAK_THRESHOLD) streakMonths += 1;
    else break;
  }

  res.json({ history, streakMonths });
});
