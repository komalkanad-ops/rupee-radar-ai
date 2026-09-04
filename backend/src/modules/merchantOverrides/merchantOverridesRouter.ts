import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const merchantOverridesRouter = Router();

// GET /merchant-overrides — the calling user's full learned merchant→category memory, pulled down
// on Dashboard load (same sync point as ExpenseRepository.downloadTransactions) so a fresh install
// or a second device gets prior corrections back instead of starting blank.
merchantOverridesRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const overrides = await prisma.merchantCategoryOverride.findMany({ where: { userId: req.userId } });
  res.json(overrides);
});

// POST /merchant-overrides — { normalizedMerchant, category } — upserts by (userId,
// normalizedMerchant), so re-categorizing the same merchant again just updates the remembered
// category, mirroring the local Room table's own REPLACE-on-conflict behavior.
merchantOverridesRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const { normalizedMerchant, category } = req.body ?? {};
  if (!normalizedMerchant || typeof normalizedMerchant !== "string" || !normalizedMerchant.trim()) {
    return res.status(400).json({ error: "normalizedMerchant is required" });
  }
  if (!category || typeof category !== "string" || !category.trim()) {
    return res.status(400).json({ error: "category is required" });
  }

  const override = await prisma.merchantCategoryOverride.upsert({
    where: { userId_normalizedMerchant: { userId: req.userId!, normalizedMerchant } },
    create: { userId: req.userId!, normalizedMerchant, category },
    update: { category },
  });
  res.status(201).json(override);
});
