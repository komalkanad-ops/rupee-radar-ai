import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, requireAdmin, type UserRequest } from "../auth/authMiddleware.js";

export const bugReportRouter = Router();

const VALID_TYPES = ["BUG", "SUGGESTION"];

// POST /bug-reports — { type, message, screenRoute, appVersionName?, appVersionCode?, deviceModel?,
// androidSdkInt? }. requireUser (not optionalUser like /feedback) — the app always has at least an
// anonymous session (POST /auth/session, provider: "anonymous") by the time any screen with this
// button renders, so there's no unauthenticated case to design around here. Deliberately never
// awards coins (distinct from /feedback's 100-coin flow) — this is meant to be a zero-friction,
// one-tap-from-anywhere report, not a rewarded action.
bugReportRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const { type, message, screenRoute, appVersionName, appVersionCode, deviceModel, androidSdkInt } = req.body ?? {};

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: "type must be BUG or SUGGESTION" });
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  if (!screenRoute || typeof screenRoute !== "string" || !screenRoute.trim()) {
    return res.status(400).json({ error: "screenRoute is required" });
  }

  const report = await prisma.bugReport.create({
    data: {
      userId: req.userId!,
      type,
      message: message.trim(),
      screenRoute: screenRoute.trim(),
      appVersionName: typeof appVersionName === "string" ? appVersionName : null,
      appVersionCode: typeof appVersionCode === "number" ? appVersionCode : null,
      deviceModel: typeof deviceModel === "string" ? deviceModel : null,
      androidSdkInt: typeof androidSdkInt === "number" ? androidSdkInt : null,
    },
  });
  res.status(201).json({ id: report.id });
});

// GET /bug-reports — admin triage list. ?type= / ?status= filter; defaults to all, newest first.
bugReportRouter.get("/", requireAdmin, async (req, res) => {
  const { type, status } = req.query;
  const where: any = {};
  if (typeof type === "string") where.type = type;
  if (typeof status === "string") where.status = status;

  const items = await prisma.bugReport.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json(items);
});

bugReportRouter.patch("/:id/status", requireAdmin, async (req, res) => {
  const { status } = req.body ?? {};
  if (!["NEW", "REVIEWED", "RESOLVED"].includes(status)) {
    return res.status(400).json({ error: "status must be NEW, REVIEWED, or RESOLVED" });
  }
  const report = await prisma.bugReport.update({ where: { id: req.params.id }, data: { status } });
  res.json(report);
});
