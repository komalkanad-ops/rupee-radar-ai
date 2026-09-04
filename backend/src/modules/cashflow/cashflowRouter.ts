import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { requirePro } from "../auth/proMiddleware.js";

export const cashflowRouter = Router();

// GET /cashflow/calendar?month=2026-09 — projects a day-by-day balance across the target month:
// starting balance from the latest NetWorthSnapshot's liquid assets (cash + bank), plus income on
// User.salaryDayOfMonth, minus each active RecurringPayment whose nextDueDate falls on that
// day-of-month, minus each active, not-yet-closed Loan's EMI on its start date's day-of-month.
// Approximate recurrence (day-of-month match, not a full recurrence-rule engine) — same simplicity
// level as /insights/budget-status elsewhere in this codebase.
cashflowRouter.get("/calendar", requireUser, requirePro, async (req: UserRequest, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: "month is required" });
  const uid = req.userId!;

  const [year, mon] = String(month).split("-").map(Number);
  if (!year || !mon) return res.status(400).json({ error: "month must look like '2026-09'" });
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();

  const [user, latestSnapshot, recurring, loans] = await Promise.all([
    prisma.user.findUnique({ where: { id: uid } }),
    prisma.netWorthSnapshot.findFirst({ where: { userId: uid }, orderBy: { month: "desc" } }),
    prisma.recurringPayment.findMany({ where: { userId: uid, active: true, nextDueDate: { not: null } } }),
    prisma.loan.findMany({ where: { userId: uid, active: true } }),
  ]);

  const assets = (latestSnapshot?.assets as Record<string, number> | undefined) ?? {};
  const cashBalance = assets.cash ?? 0;
  const bankBalance = assets.bank ?? 0;
  const startingBalance = cashBalance + bankBalance;
  const monthlyIncome = latestSnapshot?.monthlyIncomeInr ?? 0;
  const salaryDay = user?.salaryDayOfMonth ?? null;

  // A loan's EMI only actually falls due for months still inside its tenure — a loan that closed
  // before this projected month, or hasn't started yet, contributes nothing.
  const activeLoansThisMonth = loans.filter((loan) => {
    const start = loan.startDate;
    const closeMonthIndex = start.getUTCFullYear() * 12 + start.getUTCMonth() + loan.tenureMonths;
    const targetMonthIndex = year * 12 + (mon - 1);
    const startMonthIndex = start.getUTCFullYear() * 12 + start.getUTCMonth();
    return targetMonthIndex >= startMonthIndex && targetMonthIndex < closeMonthIndex;
  });

  let balance = startingBalance;
  const days = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const events: { name: string; amount: number; type: "income" | "expense" }[] = [];

    if (salaryDay === day && monthlyIncome > 0) {
      balance += monthlyIncome;
      events.push({ name: "Salary", amount: monthlyIncome, type: "income" });
    }

    for (const payment of recurring) {
      const dueDay = payment.nextDueDate!.getUTCDate();
      if (dueDay === day) {
        balance -= payment.amount;
        events.push({ name: payment.name, amount: payment.amount, type: "expense" });
      }
    }

    for (const loan of activeLoansThisMonth) {
      const dueDay = Math.min(loan.startDate.getUTCDate(), daysInMonth);
      if (dueDay === day) {
        balance -= loan.emiAmount;
        events.push({ name: `${loan.bankName} ${loan.type} EMI`, amount: loan.emiAmount, type: "expense" });
      }
    }

    days.push({ day, projectedBalance: Math.round(balance), events });
  }

  res.json({
    month: String(month),
    startingBalance: Math.round(startingBalance),
    cashBalance: Math.round(cashBalance),
    bankBalance: Math.round(bankBalance),
    monthlyIncome: Math.round(monthlyIncome),
    salaryDayOfMonth: salaryDay,
    recurringBillCount: recurring.length,
    loanEmiCount: activeLoansThisMonth.length,
    days,
  });
});
