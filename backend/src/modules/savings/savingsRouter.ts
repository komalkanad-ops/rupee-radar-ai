import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const savingsRouter = Router();

// Savings/investment tracker — FDs, gold savings schemes, stocks/mutual funds, physical gold/
// silver. Plain CRUD + a contributions ledger, same shape as the lending/loan routers: the app
// computes everything derived (weight-in-kg formatting, growth %, etc.) client-side.

savingsRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const items = await prisma.savingsInstrument.findMany({
    where: { userId: req.userId, active: true },
    orderBy: { createdAt: "desc" },
    include: { contributions: { orderBy: { contributedAt: "desc" } } },
  });
  res.json(items);
});

savingsRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const { id, type, name, institution, currentValueInr, maturityDate, interestRatePct, contributionSchedule, customIntervalDays, notes } =
    req.body ?? {};
  if (!type || !name) {
    return res.status(400).json({ error: "type and name are required" });
  }
  const item = await prisma.savingsInstrument.create({
    data: {
      id: id || undefined,
      userId: req.userId!,
      type,
      name,
      institution: institution || null,
      currentValueInr: currentValueInr ?? null,
      maturityDate: maturityDate ? new Date(maturityDate) : null,
      interestRatePct: interestRatePct ?? null,
      contributionSchedule: contributionSchedule || null,
      customIntervalDays: customIntervalDays ?? null,
      notes: notes || null,
    },
  });
  res.status(201).json(item);
});

async function loadOwnedInstrument(id: string, userId: string) {
  const existing = await prisma.savingsInstrument.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

savingsRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedInstrument(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { userId: _ignored, id: _ignoredId, principalInr: _ignoredPrincipal, quantityGrams: _ignoredGrams, quantityUnits: _ignoredUnits, createdAt: _ignoredCreated, updatedAt: _ignoredUpdated, ...rest } =
    req.body ?? {};
  const data: Record<string, unknown> = { ...rest };
  if (data.maturityDate) data.maturityDate = new Date(data.maturityDate as string);

  const item = await prisma.savingsInstrument.update({ where: { id: req.params.id }, data });
  res.json(item);
});

savingsRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedInstrument(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.savingsInstrument.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});

// POST /:id/contributions — { amountInr, quantity?, sourceTransactionId? }. Logs a dated
// contribution and bumps the instrument's running principalInr/quantityGrams/quantityUnits totals.
// When sourceTransactionId is given (the Expenses "Convert to savings" action), also re-tags that
// SmsTransaction's category to "savings" — verifying it belongs to the same user first, since this
// id comes straight from the request body rather than a path param the ownership middleware
// already checked.
savingsRouter.post("/:id/contributions", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedInstrument(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { amountInr, quantity, sourceTransactionId } = req.body ?? {};
  if (typeof amountInr !== "number" || amountInr <= 0) {
    return res.status(400).json({ error: "amountInr must be a positive number" });
  }

  if (sourceTransactionId) {
    const txn = await prisma.smsTransaction.findUnique({ where: { id: sourceTransactionId } });
    if (!txn || txn.userId !== req.userId) {
      return res.status(400).json({ error: "sourceTransactionId does not belong to this user" });
    }
    await prisma.smsTransaction.update({ where: { id: sourceTransactionId }, data: { category: "savings" } });
  }

  await prisma.savingsContribution.create({
    data: { instrumentId: owned.id, amountInr, quantity: quantity ?? null, sourceTransactionId: sourceTransactionId || null },
  });

  const item = await prisma.savingsInstrument.update({
    where: { id: owned.id },
    data: {
      principalInr: owned.principalInr + amountInr,
      ...(typeof quantity === "number"
        ? owned.type === "STOCKS" || owned.type === "MUTUAL_FUND"
          ? { quantityUnits: (owned.quantityUnits ?? 0) + quantity }
          : { quantityGrams: (owned.quantityGrams ?? 0) + quantity }
        : {}),
    },
    include: { contributions: { orderBy: { contributedAt: "desc" } } },
  });
  res.status(201).json(item);
});
