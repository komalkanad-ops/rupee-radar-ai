import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const budgetRouter = Router();

// Budgets are free (not PRO-gated) — a per-category monthly spend limit. Absence of a row for a
// category means "use the trailing-3-month average" (see insights/budget-status).

budgetRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const budgets = await prisma.budget.findMany({
    where: { userId: req.userId },
    orderBy: { category: "asc" },
  });
  res.json(budgets);
});

// PUT /budgets/:category — { monthlyLimitInr }. Upsert (one budget per category). A limit of 0 or
// less deletes the budget (back to the average fallback).
budgetRouter.put("/:category", requireUser, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const category = String(req.params.category).toLowerCase().slice(0, 40);
  const limit = Number(req.body?.monthlyLimitInr);
  if (!Number.isFinite(limit)) {
    return res.status(400).json({ error: "monthlyLimitInr (number) is required" });
  }

  if (limit <= 0) {
    await prisma.budget.deleteMany({ where: { userId, category } });
    return res.json({ category, monthlyLimitInr: 0, deleted: true });
  }

  const budget = await prisma.budget.upsert({
    where: { userId_category: { userId, category } },
    create: { userId, category, monthlyLimitInr: limit },
    update: { monthlyLimitInr: limit },
  });
  res.json(budget);
});

budgetRouter.delete("/:category", requireUser, async (req: UserRequest, res) => {
  await prisma.budget.deleteMany({
    where: { userId: req.userId, category: String(req.params.category).toLowerCase() },
  });
  res.status(204).send();
});
