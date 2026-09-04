import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

// Admin-only CRUD over LoginBypassEntry (see its schema doc comment for the full "why") — the
// entries themselves don't do anything by being listed here; authRouter.ts's
// POST /phone/request-otp is what actually reads this table to decide whether to disclose devCode.
export const loginBypassRouter = Router();

loginBypassRouter.get("/", requireAdmin, async (_req, res) => {
  const entries = await prisma.loginBypassEntry.findMany({ orderBy: { createdAt: "desc" } });
  res.json(entries);
});

// POST / — { phone, note? } — upserts by phone, always (re)enabling it. Re-adding a previously
// disabled number is how you turn it back on.
loginBypassRouter.post("/", requireAdmin, async (req, res) => {
  const { phone, note } = req.body ?? {};
  if (!phone || typeof phone !== "string") return res.status(400).json({ error: "phone is required" });

  const entry = await prisma.loginBypassEntry.upsert({
    where: { phone },
    create: { phone, note: note || null, enabled: true },
    update: { enabled: true, note: note !== undefined ? note : undefined },
  });
  res.status(201).json(entry);
});

// PATCH /:id — { enabled?, note? } — the toggle switch's endpoint.
loginBypassRouter.patch("/:id", requireAdmin, async (req, res) => {
  const { enabled, note } = req.body ?? {};
  const entry = await prisma.loginBypassEntry.update({
    where: { id: req.params.id },
    data: {
      enabled: typeof enabled === "boolean" ? enabled : undefined,
      note: note !== undefined ? note : undefined,
    },
  });
  res.json(entry);
});

loginBypassRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.loginBypassEntry.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
