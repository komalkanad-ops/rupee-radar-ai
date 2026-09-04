import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireUser } from "../auth/authMiddleware.js";
import { requirePro } from "../auth/proMiddleware.js";

// Admin-curated merchant offers — there's no live bank-offer data feed to pull from, so this is a
// manually maintained table (same admin-CRUD-plus-public-GET shape as SubscriptionProvider /
// MerchantCardRecommendation) rather than a real-time aggregator. Browsing is a PRO feature (only
// consumed by the authenticated Android app, never the public website).
export const offersRouter = Router();

// GET /offers/active?merchants=Zara,H%26M,Croma — currently-valid offers matching any of the given
// merchant names. requireUser only, NOT requirePro: Mall Mode (a free, always-on utility — see its
// ViewModel doc comment) needs to surface "there's a card discount at this store" for everyone, not
// just PRO. Returns a trimmed shape and only offers valid right now. The full browse list below
// stays PRO.
offersRouter.get("/active", requireUser, async (req, res) => {
  const raw = typeof req.query.merchants === "string" ? req.query.merchants : "";
  const names = raw
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
    .slice(0, 200);
  if (names.length === 0) return res.json([]);

  const now = new Date();
  const offers = await prisma.merchantOffer.findMany({
    where: { validFrom: { lte: now }, validUntil: { gte: now } },
    orderBy: { validUntil: "asc" },
  });

  // merchantNamePattern is a substring pattern ("Shoppers Stop", "Croma") — an offer matches a store
  // if the store name contains the pattern (case-insensitive), the same direction the PRO route's
  // `contains` filter uses.
  const lowered = names.map((n) => n.toLowerCase());
  const matched = offers
    .filter((o) => {
      const p = o.merchantNamePattern.toLowerCase();
      return lowered.some((n) => n.includes(p) || p.includes(n));
    })
    .map((o) => ({
      id: o.id,
      merchantNamePattern: o.merchantNamePattern,
      bankName: o.bankName,
      title: o.title,
      description: o.description,
      discountPct: o.discountPct,
      validUntil: o.validUntil,
      sourceUrl: o.sourceUrl,
    }));
  res.json(matched);
});

// GET /offers?merchant=&activeOnly=true
offersRouter.get("/", requireUser, requirePro, async (req, res) => {
  const { merchant, activeOnly } = req.query;
  const now = new Date();

  const offers = await prisma.merchantOffer.findMany({
    where: {
      merchantNamePattern: merchant ? { contains: String(merchant) } : undefined,
      validUntil: activeOnly === "true" ? { gte: now } : undefined,
    },
    orderBy: { validUntil: "asc" },
  });
  res.json(offers);
});

offersRouter.post("/", requireAdmin, async (req, res) => {
  const offer = await prisma.merchantOffer.create({ data: req.body });
  res.status(201).json(offer);
});

offersRouter.put("/:id", requireAdmin, async (req, res) => {
  const offer = await prisma.merchantOffer.update({ where: { id: req.params.id }, data: req.body });
  res.json(offer);
});

offersRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.merchantOffer.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
