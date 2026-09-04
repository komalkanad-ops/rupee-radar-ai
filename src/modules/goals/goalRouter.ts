import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const goalRouter = Router();

// Savings goals are free (not PRO-gated) — the planner counterpart to the single-item WishlistItem.
// Client-generated ids (same convention as wishlist/products): a later update/delete targets the
// same row server-side, and a soft delete keeps the row so a re-sync from another device can't
// resurrect it.

const KINDS = new Set(["GENERAL", "HOUSE", "CAR", "EDUCATION", "RETIREMENT", "TRAVEL", "EMERGENCY"]);

function sanitize(body: Record<string, unknown>) {
  const kindRaw = String(body.kind ?? "GENERAL").toUpperCase();
  const target = Number(body.targetAmountInr);
  const current = Number(body.currentAmountInr ?? 0);
  const monthly =
    body.monthlyContributionInr == null || body.monthlyContributionInr === ""
      ? null
      : Number(body.monthlyContributionInr);
  const targetDate = new Date(String(body.targetDate));
  return {
    name: String(body.name ?? "").trim().slice(0, 120),
    kind: KINDS.has(kindRaw) ? kindRaw : "GENERAL",
    targetAmountInr: Number.isFinite(target) ? Math.max(0, target) : NaN,
    currentAmountInr: Number.isFinite(current) ? Math.max(0, current) : 0,
    monthlyContributionInr: monthly != null && Number.isFinite(monthly) ? Math.max(0, monthly) : null,
    targetDate,
  };
}

goalRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const goals = await prisma.goal.findMany({
    where: { userId: req.userId, active: true },
    orderBy: { targetDate: "asc" },
  });
  res.json(goals);
});

goalRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const id = typeof req.body?.id === "string" && req.body.id ? String(req.body.id) : undefined;
  const data = sanitize(req.body ?? {});
  if (!data.name || !Number.isFinite(data.targetAmountInr) || isNaN(data.targetDate.getTime())) {
    return res.status(400).json({ error: "name, targetAmountInr and a valid targetDate are required" });
  }
  const goal = await prisma.goal.create({ data: { ...data, id, userId: req.userId! } });
  res.status(201).json(goal);
});

async function loadOwned(id: string, userId: string) {
  const existing = await prisma.goal.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

goalRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwned(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const data = sanitize(req.body ?? {});
  if (!data.name || !Number.isFinite(data.targetAmountInr) || isNaN(data.targetDate.getTime())) {
    return res.status(400).json({ error: "name, targetAmountInr and a valid targetDate are required" });
  }
  const goal = await prisma.goal.update({ where: { id: req.params.id }, data });
  res.json(goal);
});

goalRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwned(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.goal.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});
