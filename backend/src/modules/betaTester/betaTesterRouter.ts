import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

export const betaTesterRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 191; // matches the column's VARCHAR(191)

// POST /beta-tester-requests — { email } — public, no login concept on the website. Just a queue
// for the admin console (see GET below); actually granting access still means the owner manually
// adding this email in Play Console — the Internal Testing link on /download only works for
// emails already added there.
betaTesterRouter.post("/", async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ error: "email is required" });
  }
  const cleaned = email.trim().toLowerCase();
  if (cleaned.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(cleaned)) {
    return res.status(400).json({ error: "a valid email is required" });
  }

  // Idempotent on repeat submissions (e.g. a double-click) rather than piling up duplicate rows
  // for the same address — the admin console queue should read as "who's asked", not "how many
  // times".
  const existing = await prisma.betaTesterRequest.findFirst({ where: { email: cleaned } });
  if (existing) {
    return res.status(200).json(existing);
  }

  const request = await prisma.betaTesterRequest.create({ data: { email: cleaned } });
  res.status(201).json(request);
});

// GET /beta-tester-requests — admin console queue, newest first.
betaTesterRouter.get("/", requireAdmin, async (req, res) => {
  const requests = await prisma.betaTesterRequest.findMany({ orderBy: { createdAt: "desc" } });
  res.json(requests);
});

// DELETE /beta-tester-requests/:id — admin dismisses an entry once the email's been added in Play
// Console (or was spam/a typo) — no separate status field, this list is meant to stay short.
betaTesterRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.betaTesterRequest.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
