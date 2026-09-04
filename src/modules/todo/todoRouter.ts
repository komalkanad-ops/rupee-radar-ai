import { Router } from "express";
import { sanitizeBody } from "../../lib/sanitizeBody.js";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const todoRouter = Router();

todoRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const items = await prisma.todoItem.findMany({
    where: { userId: req.userId, active: true },
    // nulls: "last" — same fix recurringRouter.ts/lendingRouter.ts needed for their own due-date
    // sorts, without it undated todos would jump ahead of ones actually due soon.
    orderBy: { dueDate: { sort: "asc", nulls: "last" } },
  });
  res.json(items);
});

todoRouter.post("/", requireUser, async (req: UserRequest, res) => {
  // userId always comes from the verified token, never the request body.
  const item = await prisma.todoItem.create({ data: { ...sanitizeBody(req.body), userId: req.userId! } });
  res.status(201).json(item);
});

async function loadOwnedTodoItem(id: string, userId: string) {
  const existing = await prisma.todoItem.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

todoRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedTodoItem(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const item = await prisma.todoItem.update({ where: { id: req.params.id }, data: sanitizeBody(req.body) });
  res.json(item);
});

todoRouter.patch("/:id/status", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedTodoItem(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { status } = req.body ?? {};
  if (!["OPEN", "DONE"].includes(status)) {
    return res.status(400).json({ error: "status must be OPEN or DONE" });
  }
  const item = await prisma.todoItem.update({
    where: { id: req.params.id },
    data: { status, completedAt: status === "DONE" ? new Date() : null },
  });
  res.json(item);
});

todoRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedTodoItem(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.todoItem.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});
