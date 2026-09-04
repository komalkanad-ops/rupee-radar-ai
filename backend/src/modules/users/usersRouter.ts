import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

export const usersRouter = Router();

// GET /users?search= — admin-only. Lists app users with device/SMS counts and PRO status so support
// can look someone up without touching the database directly.
usersRouter.get("/", requireAdmin, async (req, res) => {
  const { search } = req.query;

  const users = await prisma.user.findMany({
    where: search
      ? { OR: [{ email: { contains: String(search) } }, { phone: { contains: String(search) } }] }
      : undefined,
    include: {
      _count: { select: { devices: true, smsTransactions: true, recurringPayments: true } },
      proEntitlement: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      createdAt: u.createdAt,
      deviceCount: u._count.devices,
      smsTransactionCount: u._count.smsTransactions,
      recurringPaymentCount: u._count.recurringPayments,
      isPro: u.proEntitlement?.status === "active" && (u.proEntitlement.expiryAt?.getTime() ?? 0) > Date.now(),
      proExpiryAt: u.proEntitlement?.expiryAt ?? null,
    })),
  );
});
