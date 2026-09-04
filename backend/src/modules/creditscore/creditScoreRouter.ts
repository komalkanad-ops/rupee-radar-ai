import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { requirePro } from "../auth/proMiddleware.js";
import { getCreditBureauClient } from "./creditBureauClient.js";

export const creditScoreRouter = Router();

// POST /credit-score/refresh — { pan, fullName, dateOfBirth, mobile } — PRO feature. 501s with an
// explanatory error until a real bureau vendor is wired into creditBureauClient.ts (same shape as
// POST /billing/verify and POST /account-aggregator/link when their respective external configs
// are unset).
creditScoreRouter.post("/refresh", requireUser, requirePro, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const { pan, fullName, dateOfBirth, mobile } = req.body ?? {};
  if (!pan || !fullName || !dateOfBirth || !mobile) {
    return res.status(400).json({ error: "pan, fullName, dateOfBirth, mobile are required" });
  }

  let client;
  try {
    client = getCreditBureauClient();
  } catch (err) {
    return res.status(501).json({ error: (err as Error).message });
  }

  const pending = await prisma.creditScoreSnapshot.create({
    data: { userId, status: "PENDING" },
  });

  try {
    const result = await client.fetchScore({ pan, fullName, dateOfBirth, mobile });
    const snapshot = await prisma.creditScoreSnapshot.update({
      where: { id: pending.id },
      data: {
        bureau: result.bureau,
        score: result.score,
        scoreBand: result.scoreBand,
        factors: result.factors,
        status: "FETCHED",
        pulledAt: new Date(),
      },
    });
    res.json(snapshot);
  } catch (err) {
    await prisma.creditScoreSnapshot.update({ where: { id: pending.id }, data: { status: "FAILED" } });
    res.status(502).json({ error: "Could not fetch credit score", detail: (err as Error).message });
  }
});

// GET /credit-score/latest — the caller's most recent successfully-fetched snapshot.
creditScoreRouter.get("/latest", requireUser, requirePro, async (req: UserRequest, res) => {
  const latest = await prisma.creditScoreSnapshot.findFirst({
    where: { userId: req.userId, status: "FETCHED" },
    orderBy: { pulledAt: "desc" },
  });
  res.json(latest);
});

// GET /credit-score/history?limit=12 — trend list, mirrors GET /health-score/history's shape.
creditScoreRouter.get("/history", requireUser, requirePro, async (req: UserRequest, res) => {
  const { limit } = req.query;
  const take = Math.min(Math.max(Number(limit) || 12, 1), 36);

  const history = await prisma.creditScoreSnapshot.findMany({
    where: { userId: req.userId, status: "FETCHED" },
    orderBy: { pulledAt: "desc" },
    take,
  });
  res.json(history);
});
