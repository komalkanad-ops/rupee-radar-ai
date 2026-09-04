import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

// Admin-curated merchant -> cancel/downgrade deep-link lookup, used by GET /recurring/subscriptions
// to enrich detected subscriptions. Same shape/convention as merchantRecommendationsRouter.ts.
export const subscriptionProvidersRouter = Router();

subscriptionProvidersRouter.get("/", async (_req, res) => {
  const items = await prisma.subscriptionProvider.findMany({ orderBy: { providerName: "asc" } });
  res.json(items);
});

subscriptionProvidersRouter.post("/", requireAdmin, async (req, res) => {
  const item = await prisma.subscriptionProvider.create({ data: req.body });
  res.status(201).json(item);
});

subscriptionProvidersRouter.put("/:id", requireAdmin, async (req, res) => {
  const item = await prisma.subscriptionProvider.update({ where: { id: req.params.id }, data: req.body });
  res.json(item);
});

subscriptionProvidersRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.subscriptionProvider.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
