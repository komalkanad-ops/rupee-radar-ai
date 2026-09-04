import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

export const changelogRouter = Router();

const VALID_TYPES = ["FEATURE", "FIX", "IMPROVEMENT"];
const VALID_PLATFORMS = ["android", "web", "admin", "backend"];

function validateHighlights(highlights: unknown): string | null {
  if (!Array.isArray(highlights) || highlights.length === 0) return "highlights must be a non-empty array";
  for (const h of highlights) {
    if (!h || typeof h !== "object") return "each highlight must be an object";
    if (!VALID_TYPES.includes(h.type)) return `highlight.type must be one of ${VALID_TYPES.join(", ")}`;
    if (typeof h.text !== "string" || !h.text.trim()) return "highlight.text is required";
  }
  return null;
}

// GET /changelog — public "What's New" feed, read by both the website's /changelog page and the
// Android app's What's New screen. ?platform= narrows to entries that touched that surface.
changelogRouter.get("/", async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  // Every backfilled historical entry shares the exact same releaseDate (the archive only recorded
  // a day, not a time), so releaseDate alone can't break ties — createdAt (real insertion order)
  // is the tiebreaker, confirmed as a real bug by looking at the live page: entries were rendering
  // oldest-first within a shared date instead of newest-first.
  const entries = await prisma.changelogEntry.findMany({
    orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
  });
  const filtered = platform
    ? entries.filter((e) => Array.isArray(e.platforms) && (e.platforms as string[]).includes(platform))
    : entries;
  res.json(filtered);
});

// POST /changelog — { version, releaseDate, platforms, summary?, highlights }
changelogRouter.post("/", requireAdmin, async (req, res) => {
  const { version, releaseDate, platforms, summary, highlights } = req.body ?? {};
  if (!version || typeof version !== "string") return res.status(400).json({ error: "version is required" });
  if (!releaseDate || isNaN(Date.parse(releaseDate))) return res.status(400).json({ error: "releaseDate must be a valid date" });
  if (!Array.isArray(platforms) || platforms.length === 0 || !platforms.every((p) => VALID_PLATFORMS.includes(p))) {
    return res.status(400).json({ error: `platforms must be a non-empty array of ${VALID_PLATFORMS.join(", ")}` });
  }
  const highlightsError = validateHighlights(highlights);
  if (highlightsError) return res.status(400).json({ error: highlightsError });

  try {
    const entry = await prisma.changelogEntry.create({
      data: {
        version,
        releaseDate: new Date(releaseDate),
        platforms,
        summary: summary || null,
        highlights,
      },
    });
    res.status(201).json(entry);
  } catch (err: any) {
    if (err.code === "P2002") return res.status(409).json({ error: "This version has already been logged" });
    throw err;
  }
});

changelogRouter.patch("/:id", requireAdmin, async (req, res) => {
  const { version, releaseDate, platforms, summary, highlights } = req.body ?? {};
  if (platforms !== undefined && (!Array.isArray(platforms) || !platforms.every((p) => VALID_PLATFORMS.includes(p)))) {
    return res.status(400).json({ error: `platforms must be an array of ${VALID_PLATFORMS.join(", ")}` });
  }
  if (highlights !== undefined) {
    const highlightsError = validateHighlights(highlights);
    if (highlightsError) return res.status(400).json({ error: highlightsError });
  }

  const entry = await prisma.changelogEntry.update({
    where: { id: req.params.id },
    data: {
      version: version ?? undefined,
      releaseDate: releaseDate ? new Date(releaseDate) : undefined,
      platforms: platforms ?? undefined,
      summary: summary !== undefined ? summary : undefined,
      highlights: highlights ?? undefined,
    },
  });
  res.json(entry);
});

changelogRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.changelogEntry.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
