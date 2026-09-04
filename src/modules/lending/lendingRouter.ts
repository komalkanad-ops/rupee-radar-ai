import { Router } from "express";
import { sanitizeBody } from "../../lib/sanitizeBody.js";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const lendingRouter = Router();

lendingRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const items = await prisma.lentMoney.findMany({
    where: { userId: req.userId, active: true },
    // nulls: "last" — without it, rows with no expectedReturnDate sort ahead of anything actually
    // due soon, same fix recurringRouter.ts needed for nextDueDate.
    orderBy: { expectedReturnDate: { sort: "asc", nulls: "last" } },
    // Full repayment history comes back with every list sync (same "sync the whole object, no
    // separate detail fetch" convention this app already uses elsewhere) so the Android detail
    // view has real dated repayment events available locally without an extra round trip.
    include: {
      repayments: { orderBy: { paidAt: "desc" } },
      installments: { orderBy: { dueDate: "asc" } },
    },
  });
  res.json(items);
});

lendingRouter.post("/", requireUser, async (req: UserRequest, res) => {
  // userId always comes from the verified token, never the request body.
  const item = await prisma.lentMoney.create({ data: { ...sanitizeBody(req.body), userId: req.userId! } });
  res.status(201).json(item);
});

async function loadOwnedLentMoney(id: string, userId: string) {
  const existing = await prisma.lentMoney.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

lendingRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLentMoney(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const item = await prisma.lentMoney.update({ where: { id: req.params.id }, data: sanitizeBody(req.body) });
  res.json(item);
});

// PATCH /:id/repayment — { amount } — the P2P IOU Tracker's installment logging. Increments the
// running amountRepaid total (distinct from status, which stays a manual OUTSTANDING/RETURNED
// toggle) and auto-flips status to RETURNED once the total reaches the original amount, so a
// fully-repaid-via-installments entry doesn't need a separate manual "mark returned" step.
lendingRouter.patch("/:id/repayment", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLentMoney(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { amount } = req.body ?? {};
  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }

  const newTotal = owned.amountRepaid + amount;
  const fullyRepaid = newTotal >= owned.amount;

  await prisma.lentMoneyRepayment.create({ data: { lentMoneyId: owned.id, amount } });
  const item = await prisma.lentMoney.update({
    where: { id: req.params.id },
    data: {
      amountRepaid: newTotal,
      status: fullyRepaid ? "RETURNED" : owned.status,
      returnedDate: fullyRepaid ? new Date() : owned.returnedDate,
    },
    include: { repayments: { orderBy: { paidAt: "desc" } }, installments: { orderBy: { dueDate: "asc" } } },
  });
  res.json(item);
});

// DELETE /:id/repayment/:repaymentId — removes one logged repayment (e.g. logged by mistake) and
// recomputes amountRepaid/status from the remaining repayments, symmetric with how logging one
// computes them — a removal that drops the running total back below the original amount reverts
// status to OUTSTANDING (and clears returnedDate) exactly like reaching the full amount flips it
// to RETURNED, rather than leaving a stale RETURNED status with a now-partial repayment total.
lendingRouter.delete("/:id/repayment/:repaymentId", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLentMoney(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const repayment = await prisma.lentMoneyRepayment.findUnique({ where: { id: req.params.repaymentId } });
  if (!repayment || repayment.lentMoneyId !== owned.id) return res.status(404).json({ error: "Repayment not found" });

  await prisma.lentMoneyRepayment.delete({ where: { id: repayment.id } });
  const remaining = await prisma.lentMoneyRepayment.aggregate({ where: { lentMoneyId: owned.id }, _sum: { amount: true } });
  const newTotal = remaining._sum.amount ?? 0;
  const fullyRepaid = newTotal >= owned.amount;

  const item = await prisma.lentMoney.update({
    where: { id: req.params.id },
    data: {
      amountRepaid: newTotal,
      status: fullyRepaid ? "RETURNED" : "OUTSTANDING",
      returnedDate: fullyRepaid ? (owned.returnedDate ?? new Date()) : null,
    },
    include: { repayments: { orderBy: { paidAt: "desc" } }, installments: { orderBy: { dueDate: "asc" } } },
  });
  res.json(item);
});

function withSchedule(lentMoneyId: string) {
  return prisma.lentMoney.findUnique({
    where: { id: lentMoneyId },
    include: { repayments: { orderBy: { paidAt: "desc" } }, installments: { orderBy: { dueDate: "asc" } } },
  });
}

// POST /:id/installment — { dueDate, amount } — adds one planned installment to the real
// multi-date schedule (distinct from the actual repayment ledger — see the schema comment on
// LentMoney.installments for why the two aren't auto-reconciled).
lendingRouter.post("/:id/installment", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLentMoney(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { dueDate, amount } = req.body ?? {};
  if (typeof amount !== "number" || amount <= 0 || !dueDate) {
    return res.status(400).json({ error: "dueDate and a positive amount are required" });
  }

  await prisma.lentMoneyInstallment.create({ data: { lentMoneyId: owned.id, dueDate: new Date(dueDate), amount } });
  res.status(201).json(await withSchedule(owned.id));
});

// PATCH /:id/installment/:installmentId — { paidAt } — marks one planned installment paid
// (paidAt: an ISO date string) or unpaid (paidAt: null). A manual check-in, same self-reported-
// confirmation pattern as Loan.lastPaymentConfirmedAt, not derived from the repayment ledger.
lendingRouter.patch("/:id/installment/:installmentId", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLentMoney(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const installment = await prisma.lentMoneyInstallment.findUnique({ where: { id: req.params.installmentId } });
  if (!installment || installment.lentMoneyId !== owned.id) return res.status(404).json({ error: "Installment not found" });

  const { paidAt } = req.body ?? {};
  await prisma.lentMoneyInstallment.update({
    where: { id: installment.id },
    data: { paidAt: paidAt ? new Date(paidAt) : null },
  });
  res.json(await withSchedule(owned.id));
});

// DELETE /:id/installment/:installmentId — removes one planned installment.
lendingRouter.delete("/:id/installment/:installmentId", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLentMoney(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const installment = await prisma.lentMoneyInstallment.findUnique({ where: { id: req.params.installmentId } });
  if (!installment || installment.lentMoneyId !== owned.id) return res.status(404).json({ error: "Installment not found" });

  await prisma.lentMoneyInstallment.delete({ where: { id: installment.id } });
  res.json(await withSchedule(owned.id));
});

lendingRouter.patch("/:id/status", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLentMoney(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { status } = req.body ?? {};
  if (!["OUTSTANDING", "RETURNED"].includes(status)) {
    return res.status(400).json({ error: "status must be OUTSTANDING or RETURNED" });
  }
  const item = await prisma.lentMoney.update({
    where: { id: req.params.id },
    data: { status, returnedDate: status === "RETURNED" ? new Date() : null },
  });
  res.json(item);
});

lendingRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLentMoney(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.lentMoney.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});
