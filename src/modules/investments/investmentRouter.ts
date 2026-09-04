import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const investmentRouter = Router();

const KINDS = new Set(["MUTUAL_FUND", "STOCKS", "FD", "OTHER"]);

// Whitelist the client-writable fields so `userId` / `active` can never come from the body.
function sanitize(body: any) {
  const kind = KINDS.has(body?.kind) ? body.kind : "MUTUAL_FUND";
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    id: typeof body?.id === "string" ? body.id : undefined,
    kind,
    label: String(body?.label ?? "").slice(0, 191),
    investedInr: num(body?.investedInr) ?? 0,
    currentValueInr: num(body?.currentValueInr) ?? null,
    returnPct: num(body?.returnPct) ?? null,
  };
}

investmentRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const items = await prisma.investment.findMany({
    where: { userId: req.userId, active: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(items);
});

investmentRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const data = sanitize(req.body);
  if (!data.label.trim()) return res.status(400).json({ error: "label is required" });
  const item = await prisma.investment.create({ data: { ...data, userId: req.userId! } });
  res.status(201).json(item);
});

async function loadOwned(id: string, userId: string) {
  const existing = await prisma.investment.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

investmentRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwned(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const { id: _id, ...data } = sanitize(req.body);
  if (!data.label.trim()) return res.status(400).json({ error: "label is required" });
  const item = await prisma.investment.update({ where: { id: req.params.id }, data });
  res.json(item);
});

investmentRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwned(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  // Soft delete — keeps a re-sync from another device from resurrecting it.
  await prisma.investment.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});
