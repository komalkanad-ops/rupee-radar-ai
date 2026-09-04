import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../auth/authMiddleware.js";

// Mutating a feature flag can hide/disable a feature for every user app-wide — a meaningfully more
// sensitive action than approving a card correction, so this is one of the first routes to actually
// use requireRole instead of the old blanket requireAdmin. Real example, not a retrofit of the
// whole API surface (see docs/TODO.md's RBAC scope note).
const requireConfigRole = requireRole("SUPER_ADMIN");

export const featureFlagsRouter = Router();

const VALID_STATUSES = ["LIVE", "BETA", "EARLY_ACCESS", "COMING_SOON", "MAINTENANCE", "DISABLED"];

// Public — the app fetches the whole flag list at startup/refresh (same "no login needed"
// reasoning as /config/links and /app-version/latest) and checks its own screen keys against it.
// A key with no row here is implicitly LIVE — admins only ever create a row once a feature's state
// needs to differ from the default, so most features never need one at all.
featureFlagsRouter.get("/", async (_req, res) => {
  // order first (the admin-set default arrangement), key as the tiebreaker for the common case of
  // several flags sharing the default order = 0.
  const flags = await prisma.featureFlag.findMany({ orderBy: [{ order: "asc" }, { key: "asc" }] });
  res.json(flags);
});

// POST / — { key, displayName, status?, message?, order? } — upserts by key, so re-registering the
// same feature (e.g. re-running a seed script) updates rather than duplicates.
featureFlagsRouter.post("/", requireConfigRole, async (req, res) => {
  const { key, displayName, status, message, order } = req.body ?? {};
  if (!key || !displayName) return res.status(400).json({ error: "key and displayName are required" });
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  const flag = await prisma.featureFlag.upsert({
    where: { key },
    create: { key, displayName, status: status || "LIVE", message: message || null, order: order ?? 0 },
    update: {
      displayName,
      status: status || undefined,
      message: message !== undefined ? message : undefined,
      order: order !== undefined ? order : undefined,
    },
  });
  res.status(201).json(flag);
});

// PATCH /:id — { status?, message?, displayName?, order? } — the admin console's day-to-day
// control: flip a feature to BETA/MAINTENANCE/DISABLED/etc., edit its user-facing message, or set
// its default display order (see the schema's own doc comment on FeatureFlag.order).
featureFlagsRouter.patch("/:id", requireConfigRole, async (req, res) => {
  const { status, message, displayName, order } = req.body ?? {};
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  if (order !== undefined && typeof order !== "number") {
    return res.status(400).json({ error: "order must be a number" });
  }
  const flag = await prisma.featureFlag.update({
    where: { id: req.params.id },
    data: {
      status: status ?? undefined,
      message: message !== undefined ? message : undefined,
      displayName: displayName ?? undefined,
      order: order ?? undefined,
    },
  });
  res.json(flag);
});

featureFlagsRouter.delete("/:id", requireConfigRole, async (req, res) => {
  await prisma.featureFlag.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
