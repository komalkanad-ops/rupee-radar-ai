import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireRole } from "../auth/authMiddleware.js";

// Publishing/editing/removing an app-wide banner is config-tier — same real requireRole
// example as featureFlagsRouter.ts. Listing (GET /) stays on requireAdmin: a VIEWER-role admin
// can still see the announcement history, just not mutate it.
const requireConfigRole = requireRole("SUPER_ADMIN");

export const announcementsRouter = Router();

const VALID_SEVERITIES = ["INFO", "WARNING", "MAINTENANCE"];

// GET /announcements/active — public, the app's Dashboard checks this at startup/refresh for a
// whole-app banner (scheduled maintenance, a release note) that doesn't belong to any one feature
// — distinct from FeatureFlag, which is per-feature. Returns the single newest active row, or null.
announcementsRouter.get("/active", async (_req, res) => {
  const announcement = await prisma.appAnnouncement.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(announcement);
});

// GET / — admin console's full history list (append-only — past announcements are never deleted
// just because a newer one supersedes them, only ever deactivated).
announcementsRouter.get("/", requireAdmin, async (_req, res) => {
  const announcements = await prisma.appAnnouncement.findMany({ orderBy: { createdAt: "desc" } });
  res.json(announcements);
});

announcementsRouter.post("/", requireConfigRole, async (req, res) => {
  const { message, severity } = req.body ?? {};
  if (!message) return res.status(400).json({ error: "message is required" });
  if (severity !== undefined && !VALID_SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: `severity must be one of: ${VALID_SEVERITIES.join(", ")}` });
  }
  const announcement = await prisma.appAnnouncement.create({
    data: { message, severity: severity || "INFO" },
  });
  res.status(201).json(announcement);
});

// PATCH /:id — { active?, message?, severity? } — the primary action here is toggling `active`
// off once a maintenance window/announcement is over.
announcementsRouter.patch("/:id", requireConfigRole, async (req, res) => {
  const { active, message, severity } = req.body ?? {};
  if (severity !== undefined && !VALID_SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: `severity must be one of: ${VALID_SEVERITIES.join(", ")}` });
  }
  const announcement = await prisma.appAnnouncement.update({
    where: { id: req.params.id },
    data: { active: active ?? undefined, message: message ?? undefined, severity: severity ?? undefined },
  });
  res.json(announcement);
});

announcementsRouter.delete("/:id", requireConfigRole, async (req, res) => {
  await prisma.appAnnouncement.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
