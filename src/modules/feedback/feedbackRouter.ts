import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, optionalUser, type UserRequest } from "../auth/authMiddleware.js";

export const feedbackRouter = Router();

const FEEDBACK_BONUS_COINS = 100;

// POST /feedback — { message, email?, rating? }. Public (optionalUser, not requireUser) since the
// website has no login/session concept at all and still needs to submit feedback. Coins are only
// ever awarded when a real user session token was presented (req.userId set by optionalUser) — a
// website submission, or an app request with a missing/invalid token, still gets recorded but
// coinsAwarded stays null. The Android app is never actually unauthenticated in practice (even a
// skip-login install gets a real anonymous session token from Phase 0's auth flow), so in practice
// every app submission is coin-eligible and every website one isn't.
feedbackRouter.post("/", optionalUser, async (req: UserRequest, res) => {
  const { message, email, rating } = req.body ?? {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  if (rating !== undefined && rating !== null && (typeof rating !== "number" || rating < 1 || rating > 5)) {
    return res.status(400).json({ error: "rating must be a number from 1 to 5" });
  }

  const userId = req.userId ?? null;
  const source = userId ? "APP" : "WEB";
  const coinsAwarded = userId ? FEEDBACK_BONUS_COINS : null;

  const feedback = await prisma.feedback.create({
    data: {
      userId,
      source,
      message: message.trim(),
      email: typeof email === "string" && email.trim() ? email.trim() : null,
      rating: rating ?? null,
      coinsAwarded,
    },
  });

  if (userId && coinsAwarded) {
    await prisma.coinLedgerEntry.create({
      data: { userId, delta: coinsAwarded, reason: "FEEDBACK_BONUS", relatedId: feedback.id },
    });
  }

  res.status(201).json({ id: feedback.id, coinsAwarded });
});

// GET /feedback — admin triage list. ?status= filters (NEW | REVIEWED | RESOLVED); defaults to all.
feedbackRouter.get("/", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const items = await prisma.feedback.findMany({
    where: status ? { status: String(status) as "NEW" | "REVIEWED" | "RESOLVED" } : undefined,
    include: { user: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(items);
});

feedbackRouter.patch("/:id/status", requireAdmin, async (req, res) => {
  const { status } = req.body ?? {};
  if (!["NEW", "REVIEWED", "RESOLVED"].includes(status)) {
    return res.status(400).json({ error: "status must be NEW, REVIEWED, or RESOLVED" });
  }
  const feedback = await prisma.feedback.update({ where: { id: req.params.id }, data: { status } });
  res.json(feedback);
});
