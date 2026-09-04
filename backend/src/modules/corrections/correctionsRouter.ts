import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { summarizeCorrection } from "../llm/meshClient.js";

export const correctionsRouter = Router();

const MAX_CORRECTIONS_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Submitted from the Android app: "Suggest a correction" on a card detail screen. No mesh-api
// call here — AI capabilities are a PRO/admin-only cost, not spent automatically on every
// free-tier submission. The admin console requests a summary explicitly (see /:id/summarize below).
// submittedByUserId always comes from the verified token — previously a client could pass a
// different id on every request to dodge the per-user rate limit entirely.
correctionsRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const { cardId, field, proposedValue, note } = req.body ?? {};
  if (!cardId || !field || !proposedValue) {
    return res.status(400).json({ error: "cardId, field, proposedValue are required" });
  }
  const submittedByUserId = req.userId!;

  const recentCount = await prisma.cardCorrection.count({
    where: { submittedByUserId, createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) } },
  });
  if (recentCount >= MAX_CORRECTIONS_PER_WINDOW) {
    return res.status(429).json({ error: "Too many corrections submitted — try again tomorrow" });
  }

  const card = await prisma.creditCard.findUnique({ where: { id: cardId } });
  if (!card) return res.status(404).json({ error: "Card not found" });

  const correction = await prisma.cardCorrection.create({
    data: { cardId, submittedByUserId, field, proposedValue, note },
  });
  res.status(201).json(correction);
});

// Admin-triggered: generate the AI diff summary on demand for a specific pending correction,
// instead of spending a mesh-api call on every submission automatically.
correctionsRouter.post("/:id/summarize", requireAdmin, async (req, res) => {
  const correction = await prisma.cardCorrection.findUnique({ where: { id: req.params.id }, include: { card: true } });
  if (!correction) return res.status(404).json({ error: "Not found" });
  if (!correction.note) return res.status(400).json({ error: "No user note to summarize" });

  try {
    const currentValue = (correction.card as any)[correction.field] ?? null;
    const llmDiffSummary = await summarizeCorrection(correction.card.name, currentValue, correction.note);
    const updated = await prisma.cardCorrection.update({
      where: { id: req.params.id },
      data: { llmDiffSummary },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

correctionsRouter.get("/", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const corrections = await prisma.cardCorrection.findMany({
    where: { status: status ? (String(status).toUpperCase() as any) : undefined },
    include: { card: { include: { bank: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(corrections);
});

correctionsRouter.post("/:id/approve", requireAdmin, async (req, res) => {
  const correction = await prisma.cardCorrection.findUnique({ where: { id: req.params.id } });
  if (!correction) return res.status(404).json({ error: "Not found" });

  const card = await prisma.creditCard.findUnique({ where: { id: correction.cardId } });
  if (!card) return res.status(404).json({ error: "Card not found" });

  const previousValue = (card as any)[correction.field];

  await prisma.creditCard.update({
    where: { id: correction.cardId },
    data: { [correction.field]: correction.proposedValue, lastVerifiedAt: new Date() },
  });

  await prisma.cardChangeLog.create({
    data: {
      cardId: correction.cardId,
      field: correction.field,
      previousValue: previousValue == null ? null : String(previousValue),
      newValue: correction.proposedValue,
    },
  });

  const updated = await prisma.cardCorrection.update({
    where: { id: req.params.id },
    data: { status: "APPROVED", reviewedAt: new Date() },
  });
  res.json(updated);
});

correctionsRouter.post("/:id/reject", requireAdmin, async (req, res) => {
  const updated = await prisma.cardCorrection.update({
    where: { id: req.params.id },
    data: { status: "REJECTED", reviewedAt: new Date() },
  });
  res.json(updated);
});
