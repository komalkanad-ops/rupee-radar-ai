import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { sendPushToTokens } from "./firebaseAdmin.js";

export const pushRouter = Router();

// POST /push/register — { deviceIdentifier, pushToken, platform? } — called on app start and
// whenever FCM rotates the token. Upserts by deviceIdentifier so re-registering just updates the
// token instead of creating duplicate device rows. userId always comes from the verified token —
// a client-supplied one would let a device register itself against another user's account and
// receive their weekly/monthly digest pushes.
pushRouter.post("/register", requireUser, async (req: UserRequest, res) => {
  const { deviceIdentifier, pushToken, platform, appVersionCode, appVersionName, deviceModel, deviceManufacturer, osVersion } = req.body ?? {};
  if (!deviceIdentifier || !pushToken) {
    return res.status(400).json({ error: "deviceIdentifier, pushToken are required" });
  }
  const userId = req.userId!;
  const versionCode = Number.isFinite(Number(appVersionCode)) ? Math.trunc(Number(appVersionCode)) : undefined;
  const versionName = typeof appVersionName === "string" ? appVersionName.slice(0, 40) : undefined;
  const str120 = (v: unknown) => (typeof v === "string" && v.trim() ? v.slice(0, 120) : undefined);

  // Called on every app launch — so `lastSeenAt` (@updatedAt) + the version/hardware fields give
  // the admin App Adoption + User Activity pages a live view of how many devices are installed,
  // which build each is on, and what phone/OS each person is using.
  const device = await prisma.device.upsert({
    where: { deviceIdentifier: String(deviceIdentifier) },
    create: {
      userId,
      deviceIdentifier,
      pushToken,
      platform: platform ?? "android",
      appVersionCode: versionCode,
      appVersionName: versionName,
      deviceModel: str120(deviceModel),
      deviceManufacturer: str120(deviceManufacturer),
      osVersion: str120(osVersion),
    },
    update: {
      pushToken,
      userId,
      appVersionCode: versionCode,
      appVersionName: versionName,
      deviceModel: str120(deviceModel),
      deviceManufacturer: str120(deviceManufacturer),
      osVersion: str120(osVersion),
    },
  });
  res.json(device);
});

async function loadOwnedDevice(deviceIdentifier: string, userId: string) {
  const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
  if (!device || device.userId !== userId) return null;
  return device;
}

// POST /push/opt-out — { deviceIdentifier } — turns off weekly/monthly digest sends for this
// device without discarding the push token (still used for other notification types later).
pushRouter.post("/opt-out", requireUser, async (req: UserRequest, res) => {
  const { deviceIdentifier } = req.body ?? {};
  if (!deviceIdentifier) return res.status(400).json({ error: "deviceIdentifier is required" });
  const owned = await loadOwnedDevice(String(deviceIdentifier), req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  await prisma.device.update({ where: { deviceIdentifier: String(deviceIdentifier) }, data: { digestOptIn: false } });
  res.json({ ok: true });
});

pushRouter.post("/opt-in", requireUser, async (req: UserRequest, res) => {
  const { deviceIdentifier } = req.body ?? {};
  if (!deviceIdentifier) return res.status(400).json({ error: "deviceIdentifier is required" });
  const owned = await loadOwnedDevice(String(deviceIdentifier), req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  await prisma.device.update({ where: { deviceIdentifier: String(deviceIdentifier) }, data: { digestOptIn: true } });
  res.json({ ok: true });
});

// GET /push/stats — admin-only. Registered-device and opt-in counts for the admin console's Push
// Notifications page.
pushRouter.get("/stats", requireAdmin, async (_req, res) => {
  const [totalDevices, registeredTokens, optedIn] = await Promise.all([
    prisma.device.count(),
    prisma.device.count({ where: { pushToken: { not: null } } }),
    prisma.device.count({ where: { pushToken: { not: null }, digestOptIn: true } }),
  ]);
  res.json({ totalDevices, registeredTokens, optedIn });
});

// POST /push/broadcast — { title, body } — admin-only. Sends an arbitrary notification to every
// opted-in device right now, for announcements/incident notices outside the weekly/monthly digest.
pushRouter.post("/broadcast", requireAdmin, async (req, res) => {
  const { title, body } = req.body ?? {};
  if (!title || !body) return res.status(400).json({ error: "title and body are required" });

  const devices = await prisma.device.findMany({
    where: { digestOptIn: true, pushToken: { not: null } },
  });
  const tokens = devices.map((d) => d.pushToken!).filter(Boolean);
  const result = await sendPushToTokens(tokens, { title, body });
  res.json({ targeted: tokens.length, ...result });
});
