import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

export const appVersionRouter = Router();

// GET /app-version/latest?platform=android — public (the app needs this before/without any login,
// same reasoning as /config/links). Returns the newest BETA and newest STABLE row independently —
// a device on the beta channel cares about the latest beta, one on stable cares about the latest
// stable, and neither should be told about the other's channel as if it were "the" latest.
appVersionRouter.get("/latest", async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform : "android";

  const [latestBeta, latestStable] = await Promise.all([
    prisma.appVersion.findFirst({ where: { platform, channel: "BETA" }, orderBy: { versionCode: "desc" } }),
    prisma.appVersion.findFirst({ where: { platform, channel: "STABLE" }, orderBy: { versionCode: "desc" } }),
  ]);

  const minSupportedVersionCode = Math.max(
    latestBeta?.minSupportedVersionCode ?? 0,
    latestStable?.minSupportedVersionCode ?? 0,
  ) || null;

  res.json({ latestBeta, latestStable, minSupportedVersionCode });
});

// GET /app-version — admin console's release list.
appVersionRouter.get("/", requireAdmin, async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  const versions = await prisma.appVersion.findMany({
    where: platform ? { platform } : undefined,
    orderBy: [{ platform: "asc" }, { versionCode: "desc" }],
  });
  res.json(versions);
});

// POST /app-version — { platform?, versionName, versionCode, channel, releaseNotes?,
// minSupportedVersionCode? } — logged when cutting a release. Unique on (platform, versionCode),
// so re-posting the same build is a real 409, not a silent duplicate.
appVersionRouter.post("/", requireAdmin, async (req, res) => {
  const { platform, versionName, versionCode, channel, releaseNotes, minSupportedVersionCode } = req.body ?? {};
  if (!versionName || typeof versionCode !== "number" || !["BETA", "STABLE"].includes(channel)) {
    return res.status(400).json({ error: "versionName, versionCode (number), and channel (BETA|STABLE) are required" });
  }

  try {
    const version = await prisma.appVersion.create({
      data: {
        platform: platform || "android",
        versionName,
        versionCode,
        channel,
        releaseNotes: releaseNotes || null,
        minSupportedVersionCode: minSupportedVersionCode ?? null,
      },
    });
    res.status(201).json(version);
  } catch (err: any) {
    if (err.code === "P2002") return res.status(409).json({ error: "This platform/versionCode has already been logged" });
    throw err;
  }
});

// PATCH /app-version/:id — promote a BETA build to STABLE (or edit release notes) once it's been
// soaked — a real, common release-management action, not just a create-only log.
appVersionRouter.patch("/:id", requireAdmin, async (req, res) => {
  const { channel, releaseNotes, minSupportedVersionCode } = req.body ?? {};
  if (channel !== undefined && !["BETA", "STABLE"].includes(channel)) {
    return res.status(400).json({ error: "channel must be BETA or STABLE" });
  }
  const version = await prisma.appVersion.update({
    where: { id: req.params.id },
    data: {
      channel: channel ?? undefined,
      releaseNotes: releaseNotes !== undefined ? releaseNotes : undefined,
      minSupportedVersionCode: minSupportedVersionCode !== undefined ? minSupportedVersionCode : undefined,
    },
  });
  res.json(version);
});

appVersionRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.appVersion.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
