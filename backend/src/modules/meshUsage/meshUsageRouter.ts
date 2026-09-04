import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

export const meshUsageRouter = Router();

const MESH_API_KEY = process.env.MESH_API_KEY;
const MESH_ORG_ID = process.env.MESH_ORG_ID;
const MESH_BASE_URL = process.env.MESH_BASE_URL || "https://api.meshapi.ai/v1";

// GET /mesh-usage/live?since=&until= — proxies mesh-api's own official /usage report (the real
// billing/cost source of truth for the whole account key, across every feature that ever calls
// callMesh). Read server-side only — MESH_API_KEY must never reach the browser. Mirrors
// /billing/verify's "501 if unconfigured" shape rather than throwing an opaque 500.
// mesh-api's real /usage endpoint (confirmed by calling it directly) requires an org_id field
// that isn't derivable from any other endpoint or from the existing MESH_API_KEY/MESH_BASE_URL —
// it has to come from the mesh-api dashboard, so this is gated behind its own env var rather than
// guessed, same as every other "vendor account exists but a specific credential is still missing"
// case in this project (Setu, Razorpay, credit bureau).
meshUsageRouter.get("/live", requireAdmin, async (req, res) => {
  if (!MESH_API_KEY) {
    return res.status(501).json({ error: "MESH_API_KEY is not configured" });
  }
  if (!MESH_ORG_ID) {
    return res.status(501).json({ error: "MESH_ORG_ID is not configured — find your org ID in the mesh-api dashboard and set it in the backend env" });
  }
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  const until = typeof req.query.until === "string" ? req.query.until : undefined;

  const meshRes = await fetch(`${MESH_BASE_URL}/usage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MESH_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ org_id: MESH_ORG_ID, since, until, limit: 100 }),
  });

  const data = await meshRes.json().catch(() => null);
  if (!meshRes.ok) {
    return res.status(502).json({ error: data?.error?.message || "mesh-api usage request failed" });
  }
  res.json(data);
});

// GET /mesh-usage/features?since=&until= — our own internal breakdown by feature tag, which
// mesh-api's account-wide report has no concept of. This is the only way to answer "how much of
// our mesh spend is chat vs. SMS-parsing fallback vs. insight narratives."
meshUsageRouter.get("/features", requireAdmin, async (req, res) => {
  const since = typeof req.query.since === "string" ? new Date(req.query.since) : undefined;
  const until = typeof req.query.until === "string" ? new Date(req.query.until) : undefined;
  const where: any = {};
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = since;
    if (until) where.createdAt.lte = until;
  }

  const rows = await prisma.meshUsageLog.findMany({ where });
  const byFeature = new Map<string, { feature: string; calls: number; promptTokens: number; completionTokens: number; totalTokens: number }>();
  for (const row of rows) {
    const entry = byFeature.get(row.feature) ?? { feature: row.feature, calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    entry.calls += 1;
    entry.promptTokens += row.promptTokens ?? 0;
    entry.completionTokens += row.completionTokens ?? 0;
    entry.totalTokens += row.totalTokens ?? 0;
    byFeature.set(row.feature, entry);
  }

  res.json({ totalCalls: rows.length, byFeature: Array.from(byFeature.values()).sort((a, b) => b.calls - a.calls) });
});

// GET /mesh-usage/by-user?since=&until= — which real user/device is actually driving mesh-api
// spend. Only covers activity since MeshUsageLog itself started recording (this table has no
// history before it existed) — the official /live report above is the only source for anything
// older than that, but it has no per-user concept at all, only an account-wide total.
meshUsageRouter.get("/by-user", requireAdmin, async (req, res) => {
  const since = typeof req.query.since === "string" ? new Date(req.query.since) : undefined;
  const until = typeof req.query.until === "string" ? new Date(req.query.until) : undefined;
  const where: any = { userId: { not: null } };
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = since;
    if (until) where.createdAt.lte = until;
  }

  const rows = await prisma.meshUsageLog.findMany({ where });

  const userIds = Array.from(new Set(rows.map((r) => r.userId).filter((id): id is string => !!id)));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, phone: true, email: true, authProvider: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const byUser = new Map<
    string,
    { userId: string; label: string; authProvider: string | null; calls: number; totalTokens: number; features: Set<string> }
  >();
  for (const row of rows) {
    if (!row.userId) continue;
    const user = userById.get(row.userId);
    const label = user?.phone || user?.email || row.userId;
    const entry = byUser.get(row.userId) ?? {
      userId: row.userId,
      label,
      authProvider: user?.authProvider ?? null,
      calls: 0,
      totalTokens: 0,
      features: new Set<string>(),
    };
    entry.calls += 1;
    entry.totalTokens += row.totalTokens ?? 0;
    entry.features.add(row.feature);
    byUser.set(row.userId, entry);
  }

  res.json({
    totalUsers: byUser.size,
    byUser: Array.from(byUser.values())
      .map((u) => ({ ...u, features: Array.from(u.features) }))
      .sort((a, b) => b.calls - a.calls),
  });
});
