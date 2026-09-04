import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

export const cardsRouter = Router();

// GET /cards?bank=&category=&cashbackOnly=true&search=
cardsRouter.get("/", async (req, res) => {
  const { bank, category, cashbackOnly, search } = req.query;

  const cards = await prisma.creditCard.findMany({
    where: {
      isCashbackCard: cashbackOnly === "true" ? true : undefined,
      category: category ? (String(category).toUpperCase() as any) : undefined,
      // No `mode: "insensitive"` — that's a Postgres-only Prisma option. MySQL's default
      // collation (utf8mb4_*_ci) is case-insensitive already, so plain equals/contains works.
      bank: bank ? { name: { equals: String(bank) } } : undefined,
      name: search ? { contains: String(search) } : undefined,
    },
    include: { bank: true },
    orderBy: [{ bank: { name: "asc" } }, { name: "asc" }],
  });

  res.json(cards);
});

cardsRouter.get("/:id", async (req, res) => {
  const card = await prisma.creditCard.findUnique({
    where: { id: req.params.id },
    include: { bank: true, corrections: { orderBy: { createdAt: "desc" } } },
  });
  if (!card) return res.status(404).json({ error: "Not found" });
  res.json(card);
});

// GET /cards/:id/history — field-change audit trail from approved corrections. Not yet surfaced
// in the app UI (planned for a later pass) but the data is captured starting now.
cardsRouter.get("/:id/history", async (req, res) => {
  const history = await prisma.cardChangeLog.findMany({
    where: { cardId: req.params.id },
    orderBy: { changedAt: "desc" },
  });
  res.json(history);
});

cardsRouter.post("/", requireAdmin, async (req, res) => {
  const card = await prisma.creditCard.create({ data: req.body });
  res.status(201).json(card);
});

cardsRouter.put("/:id", requireAdmin, async (req, res) => {
  const card = await prisma.creditCard.update({ where: { id: req.params.id }, data: req.body });
  res.json(card);
});

cardsRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.creditCard.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// POST /cards/bulk-import — { cards: [{ bankName, bankType?, name, network, category, ... }] }
// Resolves/creates the Bank by name, then upserts each card by (bankId, name) so re-running an
// import file to refresh fees/rewards doesn't create duplicates. The practical way to build out a
// "deep database of ALL issuers" instead of one-by-one admin entry.
cardsRouter.post("/bulk-import", requireAdmin, async (req, res) => {
  const { cards } = req.body ?? {};
  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: "Body must be { cards: [...] } with at least one entry" });
  }

  const results = { created: 0, updated: 0, errors: [] as { index: number; error: string }[] };

  for (let i = 0; i < cards.length; i++) {
    const { bankName, bankType, ...cardFields } = cards[i] ?? {};
    if (!bankName || !cardFields.name) {
      results.errors.push({ index: i, error: "bankName and name are required" });
      continue;
    }
    try {
      const bank = await prisma.bank.upsert({
        where: { name: bankName },
        create: { name: bankName, type: bankType || "FINTECH" },
        update: {},
      });
      const existing = await prisma.creditCard.findFirst({ where: { bankId: bank.id, name: cardFields.name } });
      if (existing) {
        await prisma.creditCard.update({ where: { id: existing.id }, data: cardFields });
        results.updated++;
      } else {
        await prisma.creditCard.create({ data: { ...cardFields, bankId: bank.id } });
        results.created++;
      }
    } catch (err: any) {
      results.errors.push({ index: i, error: err.message ?? "Unknown error" });
    }
  }

  res.json(results);
});

export const banksRouter = Router();

banksRouter.get("/", async (_req, res) => {
  const banks = await prisma.bank.findMany({ orderBy: { name: "asc" } });
  res.json(banks);
});

banksRouter.post("/", requireAdmin, async (req, res) => {
  const bank = await prisma.bank.create({ data: req.body });
  res.status(201).json(bank);
});

banksRouter.put("/:id", requireAdmin, async (req, res) => {
  const bank = await prisma.bank.update({ where: { id: req.params.id }, data: req.body });
  res.json(bank);
});

banksRouter.delete("/:id", requireAdmin, async (req, res) => {
  const cardCount = await prisma.creditCard.count({ where: { bankId: req.params.id } });
  if (cardCount > 0) {
    return res.status(409).json({ error: `${cardCount} card(s) still reference this bank — reassign or delete them first` });
  }
  await prisma.bank.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export const portalsRouter = Router();

portalsRouter.get("/", async (_req, res) => {
  const portals = await prisma.redemptionPortal.findMany({ orderBy: { name: "asc" } });
  res.json(portals);
});

portalsRouter.post("/", requireAdmin, async (req, res) => {
  const portal = await prisma.redemptionPortal.create({ data: req.body });
  res.status(201).json(portal);
});

portalsRouter.put("/:id", requireAdmin, async (req, res) => {
  const portal = await prisma.redemptionPortal.update({ where: { id: req.params.id }, data: req.body });
  res.json(portal);
});

portalsRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.redemptionPortal.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
