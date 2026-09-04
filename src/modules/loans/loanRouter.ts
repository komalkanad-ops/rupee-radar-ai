import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const loanRouter = Router();

// Plain CRUD only — no EMI/amortization/prepayment math here, see the Loan model's schema comment
// for why (all computed client-side in Android's LoanCalculator.kt, since only the app needs it).

loanRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const loans = await prisma.loan.findMany({
    where: { userId: req.userId, active: true },
    orderBy: { startDate: "desc" },
  });
  res.json(loans);
});

loanRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const { id, type, bankName, accountRef, principal, roiAnnualPct, startDate, tenureMonths, emiAmount, notes } =
    req.body ?? {};
  if (!type || !bankName || !principal || roiAnnualPct == null || !startDate || !tenureMonths || !emiAmount) {
    return res
      .status(400)
      .json({ error: "type, bankName, principal, roiAnnualPct, startDate, tenureMonths, emiAmount are required" });
  }
  const loan = await prisma.loan.create({
    data: {
      // Optional client-supplied id (Android generates a UUID before the local Room insert and
      // reuses it here) — same "same id both places" convention as TodoItem/LentMoney, so a later
      // refresh-from-backend naturally upserts the right local row instead of duplicating it.
      id: id || undefined,
      userId: req.userId!,
      type,
      bankName,
      accountRef: accountRef || null,
      principal,
      roiAnnualPct,
      startDate: new Date(startDate),
      tenureMonths,
      emiAmount,
      notes: notes || null,
    },
  });
  res.status(201).json(loan);
});

async function loadOwnedLoan(id: string, userId: string) {
  const existing = await prisma.loan.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

loanRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLoan(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { userId: _ignored, id: _ignoredId, createdAt: _ignoredCreated, updatedAt: _ignoredUpdated, ...rest } =
    req.body ?? {};
  const data: Record<string, unknown> = { ...rest };
  if (data.startDate) data.startDate = new Date(data.startDate as string);

  const loan = await prisma.loan.update({ where: { id: req.params.id }, data });
  res.json(loan);
});

// PATCH /loans/:id/confirm-payment — the self-reported "I paid this month's EMI" check-in that
// drives the overdue flag (see the Loan model's schema comment). A dedicated route, same
// convention as PATCH /todo/:id/status and PATCH /lending/:id/status, rather than folding it into
// the generic PUT.
loanRouter.patch("/:id/confirm-payment", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLoan(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const loan = await prisma.loan.update({ where: { id: req.params.id }, data: { lastPaymentConfirmedAt: new Date() } });
  res.json(loan);
});

// PATCH /loans/:id/foreclose — marks a loan paid off ahead of schedule. Distinct from DELETE (which
// only ever means "hidden/removed") — a foreclosed loan stays active: true and keeps showing in the
// list, in a closed state, rather than disappearing.
loanRouter.patch("/:id/foreclose", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLoan(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const loan = await prisma.loan.update({ where: { id: req.params.id }, data: { foreclosedAt: new Date() } });
  res.json(loan);
});

loanRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedLoan(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.loan.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});
