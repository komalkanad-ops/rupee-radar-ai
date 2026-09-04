import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { sanitizeBody } from "../../lib/sanitizeBody.js";

export const wishlistRouter = Router();

wishlistRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const items = await prisma.wishlistItem.findMany({
    where: { userId: req.userId, active: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(items);
});

wishlistRouter.post("/", requireUser, async (req: UserRequest, res) => {
  // userId always comes from the verified token, never the request body.
  const data = sanitizeBody(req.body);
  const item = await prisma.wishlistItem.create({ data: { ...data, userId: req.userId } });
  res.status(201).json(item);
});

async function loadOwnedItem(id: string, userId: string) {
  const existing = await prisma.wishlistItem.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

wishlistRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedItem(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const data = sanitizeBody(req.body);
  const item = await prisma.wishlistItem.update({ where: { id: req.params.id }, data });
  res.json(item);
});

wishlistRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedItem(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  // Soft delete — the row stays so a re-sync from another device doesn't resurrect it.
  await prisma.wishlistItem.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});
