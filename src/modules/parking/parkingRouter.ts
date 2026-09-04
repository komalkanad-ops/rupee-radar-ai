import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { sanitizeBody } from "../../lib/sanitizeBody.js";

export const parkingRouter = Router();

parkingRouter.get("/", requireUser, async (req: UserRequest, res) => {
  // A spend log — newest payment first (was dueDate asc, from the pre-reframe "fine to pay" model).
  const items = await prisma.parkingTicket.findMany({
    where: { userId: req.userId, active: true },
    orderBy: { issuedDate: "desc" },
  });
  res.json(items);
});

const PARKING_KINDS = new Set(["PARKING", "TOLL"]);

parkingRouter.post("/", requireUser, async (req: UserRequest, res) => {
  // userId always comes from the verified token, never the request body.
  const data = sanitizeBody(req.body);
  if (data.kind !== undefined && !PARKING_KINDS.has(data.kind)) {
    return res.status(400).json({ error: "kind must be PARKING or TOLL" });
  }
  const item = await prisma.parkingTicket.create({ data: { ...data, userId: req.userId } });
  res.status(201).json(item);
});

async function loadOwnedTicket(id: string, userId: string) {
  const existing = await prisma.parkingTicket.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

parkingRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedTicket(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const data = sanitizeBody(req.body);
  if (data.kind !== undefined && !PARKING_KINDS.has(data.kind)) {
    return res.status(400).json({ error: "kind must be PARKING or TOLL" });
  }
  const item = await prisma.parkingTicket.update({ where: { id: req.params.id }, data });
  res.json(item);
});

parkingRouter.patch("/:id/status", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedTicket(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { status } = req.body ?? {};
  if (!["UNPAID", "PAID"].includes(status)) {
    return res.status(400).json({ error: "status must be UNPAID or PAID" });
  }
  const item = await prisma.parkingTicket.update({
    where: { id: req.params.id },
    data: { status, paidAt: status === "PAID" ? new Date() : null },
  });
  res.json(item);
});

parkingRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedTicket(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.parkingTicket.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});
