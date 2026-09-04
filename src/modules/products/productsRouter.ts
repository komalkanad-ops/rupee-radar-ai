import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { sanitizeBody } from "../../lib/sanitizeBody.js";

export const productsRouter = Router();

productsRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const items = await prisma.productRecord.findMany({
    where: { userId: req.userId, active: true },
    // Soonest-expiring warranty first; a record with no warranty date sorts last (same
    // nulls-last convention as parkingRouter.ts's due-date sort).
    orderBy: { warrantyExpiry: { sort: "asc", nulls: "last" } },
  });
  res.json(items);
});

productsRouter.post("/", requireUser, async (req: UserRequest, res) => {
  // userId always comes from the verified token, never the request body.
  const data = sanitizeBody(req.body);
  const item = await prisma.productRecord.create({ data: { ...data, userId: req.userId } });
  res.status(201).json(item);
});

async function loadOwnedRecord(id: string, userId: string) {
  const existing = await prisma.productRecord.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

productsRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedRecord(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const data = sanitizeBody(req.body);
  const item = await prisma.productRecord.update({ where: { id: req.params.id }, data });
  res.json(item);
});

productsRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedRecord(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  // Soft delete — the row stays so a re-sync from another device doesn't resurrect it.
  await prisma.productRecord.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});
