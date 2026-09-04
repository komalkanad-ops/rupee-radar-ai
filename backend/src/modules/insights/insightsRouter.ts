import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { generateInsightNarrative } from "../llm/meshClient.js";
import { requirePro } from "../auth/proMiddleware.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import {
  periodRange,
  monthsInPeriod,
  isSpendCategory,
  isEssential,
  looksLikeFee,
  normalizeMerchant,
  type PeriodKind,
} from "./periodMath.js";

export const insightsRouter = Router();

// GET /insights/budget-status?month=2026-08 — spend per category vs a flat budget (user-configurable
// in the app; falls back to the trailing 3-month category average).
insightsRouter.get("/budget-status", requireUser, async (req: UserRequest, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: "month is required" });
  const userId = req.userId!;

  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const baselineStart = new Date(monthStart);
  baselineStart.setMonth(baselineStart.getMonth() - 3);

  const [currentByCategory, baselineByCategory, userBudgets] = await Promise.all([
    prisma.smsTransaction.groupBy({
      by: ["category"],
      where: { userId, txnDate: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.smsTransaction.groupBy({
      by: ["category"],
      where: { userId, txnDate: { gte: baselineStart, lt: monthStart } },
      _sum: { amount: true },
    }),
    prisma.budget.findMany({ where: { userId } }),
  ]);

  const baselineMap = new Map(baselineByCategory.map((b) => [b.category, (b._sum.amount ?? 0) / 3]));
  const budgetMap = new Map(userBudgets.map((b) => [b.category, b.monthlyLimitInr]));

  // income / transfer (card-bill payments, self-transfers) / savings aren't spend you budget —
  // and leaving `transfer` in put it in the Insights wheel as an oversized slice whose label
  // rendered off the edge of the chart (user bug report). Keep in sync with the Android mirror
  // (SpendInsightsComputer.EXCLUDED_FROM_SPEND).
  const NON_SPEND = new Set(["income", "transfer", "savings"]);

  // Every category the user has either spent in this month or set a budget for.
  const categories = new Set<string>([
    ...currentByCategory.map((c) => c.category ?? "uncategorized"),
    ...userBudgets.map((b) => b.category),
  ].filter((c) => !NON_SPEND.has(c)));
  const spentMap = new Map(currentByCategory.map((c) => [c.category ?? "uncategorized", c._sum.amount ?? 0]));

  const status = [...categories].map((category) => {
    // A user-set budget wins; otherwise the trailing-3-month average.
    const userSet = budgetMap.has(category);
    const budget = userSet ? (budgetMap.get(category) ?? 0) : (baselineMap.get(category) ?? 0);
    const spent = spentMap.get(category) ?? 0;
    return {
      category,
      spent: Math.round(spent),
      budget: Math.round(budget),
      source: userSet ? "user" : "average",
      overBudget: budget > 0 && spent > budget,
      overBudgetPct: budget > 0 ? Math.round(((spent - budget) / budget) * 100) : null,
    };
  });

  res.json(status);
});

// GET /insights/quarterly?year=2026&quarter=3
insightsRouter.get("/quarterly", requireUser, async (req: UserRequest, res) => {
  const { year, quarter } = req.query;
  if (!year || !quarter) return res.status(400).json({ error: "year, quarter are required" });
  const userId = req.userId!;

  const q = Number(quarter);
  const start = new Date(Date.UTC(Number(year), (q - 1) * 3, 1));
  const end = new Date(Date.UTC(Number(year), q * 3, 1));

  const transactions = await prisma.smsTransaction.findMany({
    where: { userId, txnDate: { gte: start, lt: end } },
  });

  const spend = transactions.filter((t) => t.category !== "income" && t.category !== "transfer" && t.category !== "savings")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const earnings = transactions.filter((t) => t.category === "income")
    .reduce((sum, t) => sum + t.amount, 0);

  const byCategory: Record<string, number> = {};
  for (const t of transactions) {
    const key = t.category ?? "uncategorized";
    byCategory[key] = (byCategory[key] ?? 0) + Math.abs(t.amount);
  }

  res.json({ quarter: `${year}-Q${quarter}`, totalSpend: spend, totalEarnings: earnings, byCategory });
});

// GET /insights/review?period=month|quarter|year&anchor=YYYY-MM-DD — the "financial report card"
// for one period: income / spend / saved / savings-rate, net-worth change, top categories, biggest
// single expenses, per-category delta vs the equally-sized prior window, and a letter grade. Raw
// numbers only — the narrative is a separate PRO route below.
function letterGrade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

insightsRouter.get("/review", requireUser, requirePro, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const kind = (["month", "quarter", "year"].includes(String(req.query.period)) ? req.query.period : "month") as PeriodKind;
  const anchor = req.query.anchor ? new Date(String(req.query.anchor)) : new Date();
  if (Number.isNaN(anchor.getTime())) return res.status(400).json({ error: "anchor must be a valid date" });

  const { start, end, prevStart, prevEnd, label } = periodRange(kind, anchor);
  const months = monthsInPeriod(kind);

  const [txns, prevTxns, snapshots] = await Promise.all([
    prisma.smsTransaction.findMany({
      where: { userId, txnDate: { gte: start, lt: end } },
      select: { amount: true, category: true, merchant: true, txnDate: true },
    }),
    prisma.smsTransaction.findMany({
      where: { userId, txnDate: { gte: prevStart, lt: prevEnd } },
      select: { amount: true, category: true },
    }),
    prisma.netWorthSnapshot.findMany({ where: { userId }, orderBy: { month: "asc" }, select: { month: true, totalNetWorth: true } }),
  ]);

  const sumSpend = (rows: { amount: number; category: string | null }[]) =>
    rows.filter((t) => isSpendCategory(t.category)).reduce((s, t) => s + Math.abs(t.amount), 0);
  const income = txns.filter((t) => t.category === "income").reduce((s, t) => s + Math.abs(t.amount), 0);
  const spend = sumSpend(txns);
  const prevSpend = sumSpend(prevTxns);
  const saved = income - spend;
  const savingsRatePct = income > 0 ? Math.round((saved / income) * 100) : null;

  const byCat = new Map<string, number>();
  for (const t of txns) if (isSpendCategory(t.category)) byCat.set(t.category!, (byCat.get(t.category!) ?? 0) + Math.abs(t.amount));
  const prevByCat = new Map<string, number>();
  for (const t of prevTxns) if (isSpendCategory(t.category)) prevByCat.set(t.category!, (prevByCat.get(t.category!) ?? 0) + Math.abs(t.amount));

  const topCategories = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount: Math.round(amount) }));

  const categoryDeltas = [...new Set([...byCat.keys(), ...prevByCat.keys()])]
    .map((category) => {
      const now = byCat.get(category) ?? 0;
      const before = prevByCat.get(category) ?? 0;
      return { category, now: Math.round(now), before: Math.round(before), delta: Math.round(now - before) };
    })
    .filter((d) => Math.abs(d.delta) >= 100)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);

  const biggestExpenses = txns
    .filter((t) => isSpendCategory(t.category))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5)
    .map((t) => ({ merchant: t.merchant ?? "Unknown", amount: Math.round(Math.abs(t.amount)), category: t.category, date: t.txnDate }));

  // Net-worth change: last snapshot at/before `end` minus last at/before `start`.
  const nwAt = (d: Date) => [...snapshots].reverse().find((s) => s.month < d)?.totalNetWorth ?? null;
  const nwStart = nwAt(start);
  const nwEnd = nwAt(end);
  const netWorthDelta = nwStart != null && nwEnd != null ? Math.round(nwEnd - nwStart) : null;

  // Grade: savings rate (0..50) + spend-vs-prior trend (0..30) + had-income bonus (0..20).
  let score = 20; // base "you tracked something"
  if (savingsRatePct != null) score = Math.max(0, Math.min(50, 25 + savingsRatePct));
  if (prevSpend > 0) {
    const trend = (prevSpend - spend) / prevSpend; // positive = spent less than before
    score += Math.max(-15, Math.min(30, Math.round(trend * 100)));
  } else {
    score += 10;
  }
  if (income > 0) score += 20;
  score = Math.max(0, Math.min(100, Math.round(score)));

  res.json({
    period: kind,
    label,
    range: { start, end },
    hasData: txns.length > 0,
    income: Math.round(income),
    spend: Math.round(spend),
    saved: Math.round(saved),
    savingsRatePct,
    monthlyAvgSpend: Math.round(spend / months),
    prevSpend: Math.round(prevSpend),
    spendVsPrevPct: prevSpend > 0 ? Math.round(((spend - prevSpend) / prevSpend) * 100) : null,
    netWorthDelta,
    topCategories,
    categoryDeltas,
    biggestExpenses,
    score,
    grade: letterGrade(score),
  });
});

// POST /insights/review/narrative — { review } (the JSON from GET /insights/review). PRO. Turns the
// numbers into 2-3 plain sentences via the shared insight-narrative mesh call.
insightsRouter.post("/review/narrative", requireUser, requirePro, async (req, res) => {
  const r = req.body?.review;
  if (!r) return res.status(400).json({ error: "review is required" });
  const deltas = (r.categoryDeltas ?? [])
    .map((d: any) => `${d.category} ${d.delta >= 0 ? "+" : ""}₹${d.delta}`)
    .join(", ");
  const prompt =
    `Write a 2-3 sentence plain-language summary of this person's ${r.label} finances. ` +
    `Income ₹${r.income}, spent ₹${r.spend}, saved ₹${r.saved} (savings rate ${r.savingsRatePct ?? "n/a"}%). ` +
    `Spend vs the previous period: ${r.spendVsPrevPct ?? "n/a"}%. ` +
    `Biggest category moves: ${deltas || "none"}. ` +
    `Top categories: ${(r.topCategories ?? []).map((c: any) => `${c.category} ₹${c.amount}`).join(", ")}. ` +
    `Grade ${r.grade}. Be specific and actionable, no markdown.`;
  try {
    const narrative = await generateInsightNarrative(prompt);
    res.json({ narrative });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /insights/safety-net — PRO. The three financial-health benchmarks: savings rate (target 20%),
// emergency-fund coverage (target 6 months of essential spend), and debt-to-income (ceiling 36%).
insightsRouter.get("/safety-net", requireUser, requirePro, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const now = new Date();
  const trailingStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)); // last 3 whole months incl. current
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  const [txns3mo, txns12mo, latestSnapshot, activeLoans, activeRecurring] = await Promise.all([
    prisma.smsTransaction.findMany({
      where: { userId, txnDate: { gte: trailingStart } },
      select: { amount: true, category: true },
    }),
    prisma.smsTransaction.findMany({
      where: { userId, txnDate: { gte: yearStart }, category: "income" },
      select: { amount: true },
    }),
    prisma.netWorthSnapshot.findFirst({ where: { userId }, orderBy: { month: "desc" } }),
    prisma.loan.findMany({ where: { userId, active: true }, select: { emiAmount: true } }),
    prisma.recurringPayment.findMany({
      where: { userId, active: true, type: { in: ["EMI", "LOAN", "CREDIT_CARD_BILL"] } },
      select: { amount: true, frequency: true },
    }),
  ]);

  const income3mo = txns3mo.filter((t) => t.category === "income").reduce((s, t) => s + Math.abs(t.amount), 0);
  const spend3mo = txns3mo.filter((t) => isSpendCategory(t.category)).reduce((s, t) => s + Math.abs(t.amount), 0);
  const essential3mo = txns3mo.filter((t) => isEssential(t.category)).reduce((s, t) => s + Math.abs(t.amount), 0);

  const avgMonthlyIncome = income3mo > 0 ? Math.round(income3mo / 3) : 0;
  const avgMonthlyEssential = Math.round(essential3mo / 3);
  const avgMonthlySpend = Math.round(spend3mo / 3);
  const avgMonthlySavings = avgMonthlyIncome - avgMonthlySpend;

  const savingsRatePct = avgMonthlyIncome > 0 ? Math.round(((avgMonthlyIncome - avgMonthlySpend) / avgMonthlyIncome) * 100) : null;

  // Liquid assets from the latest snapshot (cash + bank + liquid investments).
  const assets = (latestSnapshot?.assets ?? {}) as Record<string, number>;
  const liquidNetWorth = Math.round((assets.cash ?? 0) + (assets.bank ?? 0) + (assets.liquidInvestments ?? 0));
  const emergencyFundMonths = avgMonthlyEssential > 0 ? +(liquidNetWorth / avgMonthlyEssential).toFixed(1) : null;
  const emergencyFundTargetInr = avgMonthlyEssential * 6;
  const monthsToFullFund =
    emergencyFundMonths != null && emergencyFundMonths < 6 && avgMonthlySavings > 0
      ? Math.ceil((emergencyFundTargetInr - liquidNetWorth) / avgMonthlySavings)
      : emergencyFundMonths != null && emergencyFundMonths >= 6
        ? 0
        : null;

  // DTI: monthly loan EMIs + monthly-equivalent recurring EMI/loan/card-bill charges ÷ income.
  const monthlyFactor = (freq: string) => {
    const f = (freq || "").toLowerCase();
    if (f.startsWith("year") || f === "annual" || f === "yearly") return 1 / 12;
    if (f.startsWith("quarter")) return 1 / 3;
    if (f.startsWith("week")) return 4.33;
    return 1; // monthly / unknown
  };
  const monthlyDebt =
    activeLoans.reduce((s, l) => s + l.emiAmount, 0) +
    activeRecurring.reduce((s, r) => s + r.amount * monthlyFactor(r.frequency), 0);
  const debtToIncomePct = avgMonthlyIncome > 0 ? Math.round((monthlyDebt / avgMonthlyIncome) * 100) : null;

  const hasData = txns3mo.length > 0 || latestSnapshot != null;

  res.json({
    hasData,
    savings: {
      ratePct: savingsRatePct,
      benchmarkPct: 20,
      avgMonthlyIncome,
      avgMonthlySpend,
      avgMonthlySavings: Math.round(avgMonthlySavings),
    },
    emergencyFund: {
      months: emergencyFundMonths,
      targetMonths: 6,
      liquidNetWorth,
      targetInr: Math.round(emergencyFundTargetInr),
      avgMonthlyEssential,
      monthsToFullFund,
      hasSnapshot: latestSnapshot != null,
    },
    debtToIncome: {
      pct: debtToIncomePct,
      ceilingPct: 36,
      monthlyDebtInr: Math.round(monthlyDebt),
      avgMonthlyIncome,
    },
  });
});

// GET /insights/leaks — PRO. "Where you're bleeding money": subscriptions, fees, category creep,
// duplicate charges, impulse patterns. Returns a per-type breakdown and a headline recoverable total.
insightsRouter.get("/leaks", requireUser, requirePro, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const now = new Date();
  const start90 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)); // 3 whole months
  const start6mo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [txns, subscriptions, providers] = await Promise.all([
    prisma.smsTransaction.findMany({
      where: { userId, txnDate: { gte: start6mo } },
      select: { amount: true, category: true, merchant: true, txnDate: true },
    }),
    prisma.recurringPayment.findMany({
      where: { userId, active: true, type: { in: ["SUBSCRIPTION", "OTHER"] } },
      include: { provider: true },
    }),
    prisma.subscriptionProvider.findMany(),
  ]);

  const recent = txns.filter((t) => t.txnDate >= start90);

  // 1. Subscriptions — flagged (rarely/never/unconfirmed) + amount up vs the earlier matching charge.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400_000);
  const subItems = subscriptions.map((s) => {
    const matched = s.provider ?? providers.find((p) => s.name.toLowerCase().includes(p.merchantPattern.toLowerCase())) ?? null;
    const flagged = s.usageTag === "RARELY" || s.usageTag === "NEVER" || (s.autoDetected && !s.usageTag && s.createdAt < sixtyDaysAgo);
    const matches = txns
      .filter((t) => normalizeMerchant(t.merchant).includes(normalizeMerchant(s.name).split(" ")[0]))
      .sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime());
    const priceIncreased = matches.length >= 2 && Math.abs(matches.at(-1)!.amount) > Math.abs(matches[0].amount) * 1.05;
    return {
      name: s.name,
      amountInr: Math.round(s.amount),
      flagged,
      priceIncreased,
      usageTag: s.usageTag,
      cancelUrl: matched?.cancelUrl ?? null,
    };
  });
  const subscriptionTotalMonthly = subItems.reduce((sum, s) => sum + s.amountInr, 0);
  const subscriptionRecoverable = subItems.filter((s) => s.flagged).reduce((sum, s) => sum + s.amountInr, 0);

  // 2. Fees — 90-day window.
  const feeRows = recent
    .filter((t) => looksLikeFee(t.merchant) || (t.category === "utilities" && looksLikeFee(t.merchant)))
    .map((t) => ({ merchant: t.merchant ?? "Fee", amountInr: Math.round(Math.abs(t.amount)), date: t.txnDate }))
    .sort((a, b) => b.amountInr - a.amountInr);
  const feesTotal90 = feeRows.reduce((s, f) => s + f.amountInr, 0);

  // 3. Category creep — a category up ≥15% each of the last 3 months.
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const byMonthCat = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (!isSpendCategory(t.category)) continue;
    const mk = monthKey(t.txnDate);
    const m = byMonthCat.get(mk) ?? new Map();
    m.set(t.category!, (m.get(t.category!) ?? 0) + Math.abs(t.amount));
    byMonthCat.set(mk, m);
  }
  const last4Months = [3, 2, 1, 0].map((i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  const creeping: { category: string; monthlySpend: number[]; growthPct: number }[] = [];
  const allCats = new Set<string>();
  for (const m of byMonthCat.values()) for (const c of m.keys()) allCats.add(c);
  for (const cat of allCats) {
    const series = last4Months.map((mk) => Math.round(byMonthCat.get(mk)?.get(cat) ?? 0));
    if (series.every((v, i) => i === 0 || (series[i - 1] > 0 && v >= series[i - 1] * 1.15))) {
      creeping.push({ category: cat, monthlySpend: series, growthPct: series[0] > 0 ? Math.round(((series[3] - series[0]) / series[0]) * 100) : 0 });
    }
  }

  // 4. Duplicate charges — same amount + normalised merchant + same calendar day.
  const dupMap = new Map<string, { merchant: string; amountInr: number; date: Date; count: number }>();
  for (const t of recent) {
    if (!isSpendCategory(t.category)) continue;
    const key = `${Math.round(Math.abs(t.amount))}__${normalizeMerchant(t.merchant)}__${t.txnDate.toISOString().slice(0, 10)}`;
    const e = dupMap.get(key);
    if (e) e.count += 1;
    else dupMap.set(key, { merchant: t.merchant ?? "Unknown", amountInr: Math.round(Math.abs(t.amount)), date: t.txnDate, count: 1 });
  }
  const duplicates = [...dupMap.values()].filter((d) => d.count > 1).map((d) => ({ ...d, wastedInr: d.amountInr * (d.count - 1) }));
  const duplicatesTotal = duplicates.reduce((s, d) => s + d.wastedInr, 0);

  // 5. Impulse — weekend share of discretionary spend, and small repeat runs at one merchant.
  const discretionary = recent.filter((t) => isSpendCategory(t.category) && !isEssential(t.category));
  const discTotal = discretionary.reduce((s, t) => s + Math.abs(t.amount), 0);
  const weekendSpend = discretionary.filter((t) => [0, 6].includes(t.txnDate.getUTCDay())).reduce((s, t) => s + Math.abs(t.amount), 0);
  const smallRepeat = new Map<string, number>();
  for (const t of recent) {
    if (Math.abs(t.amount) <= 200 && isSpendCategory(t.category)) {
      const k = normalizeMerchant(t.merchant);
      if (k) smallRepeat.set(k, (smallRepeat.get(k) ?? 0) + 1);
    }
  }
  const smallRepeatMerchants = [...smallRepeat.entries()]
    .filter(([, n]) => n >= 6)
    .map(([merchant, count]) => ({ merchant, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Headline recoverable ≈ flagged subs + fees/3 (monthly) + duplicates/3 (monthly).
  const recoverableMonthly = Math.round(subscriptionRecoverable + feesTotal90 / 3 + duplicatesTotal / 3);

  res.json({
    hasData: txns.length > 0,
    recoverableMonthlyInr: recoverableMonthly,
    subscriptions: {
      items: subItems,
      totalMonthlyInr: subscriptionTotalMonthly,
      recoverableMonthlyInr: subscriptionRecoverable,
    },
    fees: { rows: feeRows.slice(0, 12), total90DaysInr: feesTotal90 },
    categoryCreep: creeping,
    duplicates,
    impulse: {
      weekendSharePct: discTotal > 0 ? Math.round((weekendSpend / discTotal) * 100) : null,
      weekendSpendInr: Math.round(weekendSpend),
      smallRepeatMerchants,
    },
  });
});

insightsRouter.post("/leaks/narrative", requireUser, requirePro, async (req, res) => {
  const l = req.body?.leaks;
  if (!l) return res.status(400).json({ error: "leaks is required" });
  const prompt =
    `In 2-3 plain sentences, tell this person where they're wasting money and what to do first. ` +
    `Recoverable ≈ ₹${l.recoverableMonthlyInr}/month. ` +
    `Flagged subscriptions: ${(l.subscriptions?.items ?? []).filter((s: any) => s.flagged).map((s: any) => `${s.name} ₹${s.amountInr}`).join(", ") || "none"}. ` +
    `Fees in 90 days: ₹${l.fees?.total90DaysInr ?? 0}. ` +
    `Categories creeping up: ${(l.categoryCreep ?? []).map((c: any) => c.category).join(", ") || "none"}. ` +
    `Duplicate charges: ${(l.duplicates ?? []).length}. No markdown.`;
  try {
    res.json({ narrative: await generateInsightNarrative(prompt) });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /insights/category-trend?months=6 — per-category, per-month spend totals over the trailing N
// months, for a grouped trend chart ("how spend on entertainment/groceries/etc moved month to month").
insightsRouter.get("/category-trend", requireUser, async (req: UserRequest, res) => {
  const { months } = req.query;
  const userId = req.userId!;

  const monthCount = Math.min(Math.max(Number(months) || 6, 1), 36);
  const start = new Date();
  start.setMonth(start.getMonth() - (monthCount - 1));
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const transactions = await prisma.smsTransaction.findMany({
    where: { userId, txnDate: { gte: start }, category: { notIn: ["income", "transfer", "savings"] } },
    select: { category: true, amount: true, txnDate: true },
  });

  const totals = new Map<string, number>();
  for (const t of transactions) {
    const monthKey = `${t.txnDate.getFullYear()}-${String(t.txnDate.getMonth() + 1).padStart(2, "0")}`;
    const category = t.category ?? "other";
    const key = `${monthKey}__${category}`;
    totals.set(key, (totals.get(key) ?? 0) + Math.abs(t.amount));
  }

  const result = [...totals.entries()].map(([key, total]) => {
    const [month, category] = key.split("__");
    return { month, category, total: Math.round(total) };
  });

  res.json(result);
});

// GET /insights/top-merchants?month=2026-08&limit=10 — top spend merchants for a given month
// (defaults to the current month).
insightsRouter.get("/top-merchants", requireUser, async (req: UserRequest, res) => {
  const { month, limit } = req.query;
  const userId = req.userId!;

  const monthStr = month ? String(month) : new Date().toISOString().slice(0, 7);
  const monthStart = new Date(`${monthStr}-01T00:00:00.000Z`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const byMerchant = await prisma.smsTransaction.groupBy({
    by: ["merchant"],
    where: {
      userId,
      txnDate: { gte: monthStart, lt: monthEnd },
      merchant: { not: null },
      category: { notIn: ["income", "transfer", "savings"] },
    },
    _sum: { amount: true },
    _count: true,
  });

  const ranked = byMerchant
    .map((m) => ({ merchant: m.merchant, total: Math.round(Math.abs(m._sum.amount ?? 0)), count: m._count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, Number(limit) > 0 ? Number(limit) : 10);

  res.json(ranked);
});

// GET /insights/money-monday — in-app weekly digest: last 7 days' spend, a wallet-aware "best card"
// note, bills due in the next 7 days, and one tip (biggest week-over-week category jump).
// Independent of the push-notification version in digestScheduler.ts, which is blocked on Firebase
// — this endpoint has no such dependency.
insightsRouter.get("/money-monday", requireUser, async (req: UserRequest, res) => {
  const uid = req.userId!;

  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 86400000);
  const prevWeekStart = new Date(now.getTime() - 14 * 86400000);
  const in7Days = new Date(now.getTime() + 7 * 86400000);

  const [thisWeekByCategory, lastWeekByCategory, upcomingBills, wallet] = await Promise.all([
    prisma.smsTransaction.groupBy({
      by: ["category"],
      where: { userId: uid, txnDate: { gte: weekStart, lt: now }, category: { notIn: ["income", "transfer", "savings"] } },
      _sum: { amount: true },
    }),
    prisma.smsTransaction.groupBy({
      by: ["category"],
      where: { userId: uid, txnDate: { gte: prevWeekStart, lt: weekStart }, category: { notIn: ["income", "transfer", "savings"] } },
      _sum: { amount: true },
    }),
    prisma.recurringPayment.findMany({
      where: { userId: uid, active: true, nextDueDate: { gte: now, lte: in7Days } },
      orderBy: { nextDueDate: "asc" },
    }),
    prisma.userCreditCard.findMany({ where: { userId: uid, status: "ACTIVE" }, include: { card: true } }),
  ]);

  const totalSpend = thisWeekByCategory.reduce((s, c) => s + Math.abs(c._sum.amount ?? 0), 0);
  const topCategory =
    thisWeekByCategory.length > 0
      ? thisWeekByCategory.reduce((a, b) => (Math.abs(b._sum.amount ?? 0) > Math.abs(a._sum.amount ?? 0) ? b : a))
      : null;

  let bestCardNote: string;
  if (wallet.length === 0) {
    bestCardNote = "Add a card to your wallet to see which one earns the most on your top spend category.";
  } else if (topCategory) {
    const match = wallet.find((w) => {
      const cats = w.card.merchantBonusCategories;
      return Array.isArray(cats) && cats.some((c) => String(c).toLowerCase() === String(topCategory.category).toLowerCase());
    });
    bestCardNote = match
      ? `Use your ${match.card.name} for ${topCategory.category} — it has a bonus category match.`
      : `No card in your wallet has a bonus match for ${topCategory.category} this week.`;
  } else {
    bestCardNote = "No spend recorded this week yet.";
  }

  const lastWeekMap = new Map(lastWeekByCategory.map((c) => [c.category, Math.abs(c._sum.amount ?? 0)]));
  let biggestIncrease: { category: string | null; deltaPct: number } | null = null;
  for (const c of thisWeekByCategory) {
    const thisAmt = Math.abs(c._sum.amount ?? 0);
    const lastAmt = lastWeekMap.get(c.category) ?? 0;
    if (lastAmt > 0) {
      const deltaPct = ((thisAmt - lastAmt) / lastAmt) * 100;
      if (!biggestIncrease || deltaPct > biggestIncrease.deltaPct) biggestIncrease = { category: c.category, deltaPct };
    }
  }
  const tip =
    biggestIncrease && biggestIncrease.deltaPct > 20
      ? `${biggestIncrease.category ?? "uncategorized"} spend is up ${Math.round(biggestIncrease.deltaPct)}% vs last week — worth a look.`
      : "Nothing stands out this week — steady as she goes.";

  res.json({
    weekOf: weekStart,
    totalSpend: Math.round(totalSpend),
    topCategory: topCategory
      ? { category: topCategory.category, amount: Math.round(Math.abs(topCategory._sum.amount ?? 0)) }
      : null,
    bestCardNote,
    upcomingBills: upcomingBills.map((b) => ({ id: b.id, name: b.name, amount: b.amount, nextDueDate: b.nextDueDate })),
    tip,
  });
});

// POST /insights/narrative — { prompt } -> LLM-generated plain-language summary (used by the app to
// turn the numeric payloads above into a one-liner shown on the dashboard). PRO-only — mesh-api
// spend is gated to paying users. requireUser must run first so requirePro can trust req.userId.
insightsRouter.post("/narrative", requireUser, requirePro, async (req, res) => {
  const { prompt } = req.body ?? {};
  if (!prompt) return res.status(400).json({ error: "prompt is required" });
  try {
    const narrative = await generateInsightNarrative(prompt);
    res.json({ narrative });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});
