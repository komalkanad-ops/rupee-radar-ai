import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, requireAdmin, type UserRequest } from "../auth/authMiddleware.js";

export const bugReportRouter = Router();

const VALID_TYPES = ["BUG", "SUGGESTION"];
// Same reward tier as /feedback's FEEDBACK_BONUS_COINS — bug reports and suggestions now earn coins
// through the exact same mechanism (a CoinLedgerEntry), matching the owner's ask to wire this up the
// same way. Previously deliberately coin-less ("zero-friction, one-tap-from-anywhere report, not a
// rewarded action") — that design changed 2026-09-14.
const BUG_REPORT_BONUS_COINS = 100;

// POST /bug-reports — { type, message, screenRoute, appVersionName?, appVersionCode?, deviceModel?,
// androidSdkInt? }. requireUser (not optionalUser like /feedback) — the app always has at least an
// anonymous session (POST /auth/session, provider: "anonymous") by the time any screen with this
// button renders, so there's no unauthenticated case to design around here — every submission is
// coin-eligible.
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

  const userId = req.userId!;
  const report = await prisma.bugReport.create({
    data: {
      userId,
      type,
      message: message.trim(),
      screenRoute: screenRoute.trim(),
      appVersionName: typeof appVersionName === "string" ? appVersionName : null,
      appVersionCode: typeof appVersionCode === "number" ? appVersionCode : null,
      deviceModel: typeof deviceModel === "string" ? deviceModel : null,
      androidSdkInt: typeof androidSdkInt === "number" ? androidSdkInt : null,
      coinsAwarded: BUG_REPORT_BONUS_COINS,
    },
  });

  await prisma.coinLedgerEntry.create({
    data: { userId, delta: BUG_REPORT_BONUS_COINS, reason: "BUG_REPORT_BONUS", relatedId: report.id },
  });

  res.status(201).json({ id: report.id, coinsAwarded: BUG_REPORT_BONUS_COINS });
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
