import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { requirePro } from "../auth/proMiddleware.js";

export const householdRouter = Router();

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// Privacy-First Household Vault — deliberately narrow: only these two categories ever get pooled,
// never net worth, never any other category (dining/shopping/etc. stay private), matching the
// "grocery totals, shared utility limits" scope the feature was asked for, nothing broader.
const HOUSEHOLD_SHARED_CATEGORIES = ["groceries", "utilities"];

// POST /household — { name }
householdRouter.post("/", requireUser, requirePro, async (req: UserRequest, res) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const userId = req.userId!;

  const household = await prisma.household.create({
    data: {
      name,
      ownerUserId: userId,
      inviteCode: generateInviteCode(),
      members: { create: { userId, role: "owner", netWorthSharingEnabled: true } },
    },
  });
  // Client re-fetches GET /household after this — return only the shareable shape, never the
  // raw member rows (which carry other users' ids once a household has more than one member).
  res.status(201).json({ id: household.id, name: household.name, inviteCode: household.inviteCode });
});

// POST /household/join — { inviteCode }
householdRouter.post("/join", requireUser, requirePro, async (req: UserRequest, res) => {
  const { inviteCode } = req.body ?? {};
  if (!inviteCode) return res.status(400).json({ error: "inviteCode is required" });

  const household = await prisma.household.findUnique({ where: { inviteCode } });
  if (!household) return res.status(404).json({ error: "Invalid invite code" });

  try {
    await prisma.householdMember.create({ data: { householdId: household.id, userId: req.userId! } });
    res.status(201).json({ ok: true, householdId: household.id });
  } catch (err: any) {
    if (err.code === "P2002") return res.status(409).json({ error: "Already a member of this household" });
    throw err;
  }
});

// GET /household — the caller's household (if any), with member list.
householdRouter.get("/", requireUser, requirePro, async (req: UserRequest, res) => {
  const membership = await prisma.householdMember.findFirst({
    where: { userId: req.userId },
    include: {
      household: {
        include: { members: { include: { user: { select: { name: true } } } } },
      },
    },
  });
  if (!membership) return res.json(null);

  const h = membership.household;
  // Members only ever expose a display name + their own sharing toggles to each other — never
  // another member's User.id, email, phone, city or income bracket. `isSelf` lets the client
  // mark the caller's own row without handing out raw user ids.
  res.json({
    id: h.id,
    name: h.name,
    // The invite code is only shown to the owner (it's a bearer secret for joining).
    inviteCode: membership.role === "owner" ? h.inviteCode : undefined,
    members: h.members.map((m) => ({
      isSelf: m.userId === req.userId,
      name: m.user.name,
      role: m.role,
      netWorthSharingEnabled: m.netWorthSharingEnabled,
      categorySpendSharingEnabled: m.categorySpendSharingEnabled,
    })),
  });
});

// PATCH /household/sharing — { householdId, enabled } — per-member opt-in toggle. A member can only
// ever toggle their own sharing flag — userId comes from the verified token, not the request body,
// so one household member can't flip another member's sharing setting.
householdRouter.patch("/sharing", requireUser, requirePro, async (req: UserRequest, res) => {
  const { householdId, enabled } = req.body ?? {};
  if (!householdId || typeof enabled !== "boolean") {
    return res.status(400).json({ error: "householdId and enabled are required" });
  }
  await prisma.householdMember.update({
    where: { householdId_userId: { householdId, userId: req.userId! } },
    data: { netWorthSharingEnabled: enabled },
  });
  res.json({ ok: true });
});

// PATCH /household/spend-sharing — { householdId, enabled } — the separate, narrower opt-in for
// pooled grocery/utility totals. Same self-only-toggle rule as /sharing above.
householdRouter.patch("/spend-sharing", requireUser, requirePro, async (req: UserRequest, res) => {
  const { householdId, enabled } = req.body ?? {};
  if (!householdId || typeof enabled !== "boolean") {
    return res.status(400).json({ error: "householdId and enabled are required" });
  }
  await prisma.householdMember.update({
    where: { householdId_userId: { householdId, userId: req.userId! } },
    data: { categorySpendSharingEnabled: enabled },
  });
  res.json({ ok: true });
});

// GET /household/spend?month=2026-08 — pooled grocery/utility totals across opted-in members only.
// Never touches net worth or any other category — a household member who wants to share how much
// the family spends on groceries without exposing their bank balance or discretionary spend uses
// this instead of /networth.
householdRouter.get("/spend", requireUser, requirePro, async (req: UserRequest, res) => {
  const membership = await prisma.householdMember.findFirst({
    where: { userId: req.userId },
    include: { household: { include: { members: { include: { user: { select: { name: true } } } } } } },
  });
  if (!membership) return res.status(404).json({ error: "Not a member of any household" });

  const { month } = req.query;
  const monthStr = String(month || new Date().toISOString().slice(0, 7));
  const monthStart = new Date(`${monthStr}-01T00:00:00.000Z`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const breakdown = await Promise.all(
    membership.household.members.map(async (member) => {
      if (!member.categorySpendSharingEnabled) {
        return { isSelf: member.userId === req.userId, name: member.user.name, hidden: true, byCategory: null };
      }
      const grouped = await prisma.smsTransaction.groupBy({
        by: ["category"],
        where: {
          userId: member.userId,
          txnDate: { gte: monthStart, lt: monthEnd },
          category: { in: HOUSEHOLD_SHARED_CATEGORIES },
        },
        _sum: { amount: true },
      });
      const byCategory = Object.fromEntries(grouped.map((g) => [g.category, Math.round(g._sum.amount ?? 0)]));
      return { isSelf: member.userId === req.userId, name: member.user.name, hidden: false, byCategory };
    }),
  );

  const total: Record<string, number> = {};
  for (const category of HOUSEHOLD_SHARED_CATEGORIES) {
    total[category] = breakdown.reduce((sum, m) => sum + (m.byCategory?.[category] ?? 0), 0);
  }

  res.json({ householdId: membership.household.id, month: monthStr, categories: HOUSEHOLD_SHARED_CATEGORIES, total, members: breakdown });
});

// GET /household/networth — consolidated net worth across opted-in members only. Members who
// haven't opted in show as "hidden" rather than being silently excluded, so nothing looks like
// missing data.
householdRouter.get("/networth", requireUser, requirePro, async (req: UserRequest, res) => {
  const membership = await prisma.householdMember.findFirst({
    where: { userId: req.userId },
    include: { household: { include: { members: { include: { user: { select: { name: true } } } } } } },
  });
  if (!membership) return res.status(404).json({ error: "Not a member of any household" });

  const breakdown = await Promise.all(
    membership.household.members.map(async (member) => {
      if (!member.netWorthSharingEnabled) {
        return { isSelf: member.userId === req.userId, name: member.user.name, hidden: true, netWorth: null };
      }
      const snapshot = await prisma.netWorthSnapshot.findFirst({
        where: { userId: member.userId },
        orderBy: { month: "desc" },
      });
      return { isSelf: member.userId === req.userId, name: member.user.name, hidden: false, netWorth: snapshot?.totalNetWorth ?? 0 };
    }),
  );

  const total = breakdown.reduce((sum, m) => sum + (m.netWorth ?? 0), 0);
  res.json({ householdId: membership.household.id, total, members: breakdown });
});
