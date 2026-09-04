import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

export const merchantRecommendationsRouter = Router();

merchantRecommendationsRouter.get("/", async (_req, res) => {
  const items = await prisma.merchantCardRecommendation.findMany({ orderBy: { merchantNamePattern: "asc" } });
  res.json(items);
});

merchantRecommendationsRouter.post("/", requireAdmin, async (req, res) => {
  const item = await prisma.merchantCardRecommendation.create({ data: req.body });
  res.status(201).json(item);
});

merchantRecommendationsRouter.put("/:id", requireAdmin, async (req, res) => {
  const item = await prisma.merchantCardRecommendation.update({ where: { id: req.params.id }, data: req.body });
  res.json(item);
});

merchantRecommendationsRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.merchantCardRecommendation.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
