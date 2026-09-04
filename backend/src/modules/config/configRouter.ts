import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

export const configRouter = Router();

// Public — the app fetches these at startup/refresh instead of hardcoding URLs, so support,
// legal, Play Store, and social links can change without an app release.
configRouter.get("/links", async (_req, res) => {
  const links = await prisma.appLink.findMany({ orderBy: { category: "asc" } });
  res.json(links);
});

configRouter.post("/links", requireAdmin, async (req, res) => {
  const { key, label, url, category } = req.body ?? {};
  if (!key || !label || !url) return res.status(400).json({ error: "key, label, url are required" });
  const link = await prisma.appLink.upsert({
    where: { key },
    create: { key, label, url, category: category || "general" },
    update: { label, url, category: category || "general" },
  });
  res.status(201).json(link);
});

configRouter.delete("/links/:id", requireAdmin, async (req, res) => {
  await prisma.appLink.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
