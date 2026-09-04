import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, optionalUser, type UserRequest } from "../auth/authMiddleware.js";

export const logsRouter = Router();

const VALID_SOURCES = ["ANDROID", "WEB", "ADMIN", "BACKEND"];
const VALID_LEVELS = ["INFO", "WARN", "ERROR"];

// A real crash report + diagnostics bundle is a few KB; a stack trace with a wide device-state map
// can be larger. 16 KB truncates the pathological case (or a spam blob up to the 2 MB body limit)
// without 400-ing a legitimate report.
const METADATA_MAX_CHARS = 16_384;

// POST /logs is unauthenticated (a fresh crash then cold-start may not have a token yet — see the
// Android CrashReporter flush path), so it gets its own tighter limiter instead of relying on the
// app-wide generalLimiter. 60/15min per IP is plenty for a client that batches its pending logs.
const logIngestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /logs — { source, level?, feature?, message, metadata? }. Public (optionalUser) so a client
// can report a real error the moment it happens — the gap that made a real on-device chat-timeout
// bug slower to diagnose than it needed to be (the only prior option was connecting a device and
// reading adb logcat).
logsRouter.post("/", logIngestLimiter, optionalUser, async (req: UserRequest, res) => {
  const { source, level, feature, message, metadata } = req.body ?? {};
  if (!VALID_SOURCES.includes(source)) {
    return res.status(400).json({ error: `source must be one of ${VALID_SOURCES.join(", ")}` });
  }
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  if (level !== undefined && !VALID_LEVELS.includes(level)) {
    return res.status(400).json({ error: `level must be one of ${VALID_LEVELS.join(", ")}` });
  }

  // Cap metadata by serialized size — truncate + flag rather than reject, so an oversized stack
  // trace still lands as a (marked) partial record instead of being lost.
  let storedMetadata: unknown = metadata ?? undefined;
  if (metadata !== undefined && metadata !== null) {
    const json = JSON.stringify(metadata);
    if (json.length > METADATA_MAX_CHARS) {
      storedMetadata = { _truncated: true, _originalChars: json.length, preview: json.slice(0, METADATA_MAX_CHARS) };
    }
  }

  const log = await prisma.appEventLog.create({
    data: {
      source,
      level: level ?? "ERROR",
      feature: typeof feature === "string" ? feature : null,
      message: message.slice(0, 2000),
      metadata: storedMetadata === undefined ? undefined : (storedMetadata as any),
      userId: req.userId ?? null,
    },
  });
  res.status(201).json({ id: log.id });
});

// GET /logs — admin console's Event Logs table. Filters: source, level, feature, userId, q
// (substring on message), since, until. Paged via limit (<=200) + offset.
logsRouter.get("/", requireAdmin, async (req, res) => {
  const { source, level, feature, userId, q, since, until } = req.query;
  const where: any = {};
  if (typeof source === "string") where.source = source;
  if (typeof level === "string") where.level = level;
  if (typeof feature === "string") where.feature = feature;
  if (typeof userId === "string" && userId) where.userId = userId;
  if (typeof q === "string" && q.trim()) where.message = { contains: q.trim() };
  if (typeof since === "string" || typeof until === "string") {
    where.createdAt = {};
    if (typeof since === "string") where.createdAt.gte = new Date(since);
    if (typeof until === "string") where.createdAt.lte = new Date(until);
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const [logs, total] = await Promise.all([
    prisma.appEventLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.appEventLog.count({ where }),
  ]);
  res.json({ logs, total, limit, offset });
});
