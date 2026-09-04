import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

export const analyticsRouter = Router();

// POST /analytics/event — { path, eventType, metadata? }. Public — the website has no login
// system at all — rate-limited by the app-wide general limiter already applied in app.ts. First-
// party, self-hosted (no Google Analytics/Plausible-style third-party service, which would need an
// external account signup this pass is deliberately scoped without).
analyticsRouter.post("/event", async (req, res) => {
  const { path, eventType, metadata } = req.body ?? {};
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "path is required" });
  }
  if (!eventType || typeof eventType !== "string") {
    return res.status(400).json({ error: "eventType is required" });
  }

  const event = await prisma.analyticsEvent.create({
    data: {
      path: path.slice(0, 500),
      eventType: eventType.slice(0, 100),
      metadata: metadata ?? undefined,
    },
  });
  res.status(201).json({ id: event.id });
});

// GET /analytics/summary?since=&until= — admin console's Analytics page. Pageview counts grouped
// by path, and every event type's total count (conversion events included) — two different
// questions ("what pages get traffic" vs "how often does each conversion event fire") answered
// separately rather than conflated into one list.
analyticsRouter.get("/summary", requireAdmin, async (req, res) => {
  const { since, until } = req.query;
  const where: any = {};
  if (typeof since === "string" || typeof until === "string") {
    where.createdAt = {};
    if (typeof since === "string") where.createdAt.gte = new Date(since);
    if (typeof until === "string") where.createdAt.lte = new Date(until);
  }

  const rows = await prisma.analyticsEvent.findMany({ where });

  const byPath = new Map<string, number>();
  const byEventType = new Map<string, number>();
  for (const row of rows) {
    if (row.eventType === "pageview") {
      byPath.set(row.path, (byPath.get(row.path) ?? 0) + 1);
    }
    byEventType.set(row.eventType, (byEventType.get(row.eventType) ?? 0) + 1);
  }

  res.json({
    totalEvents: rows.length,
    pageviewsByPath: Array.from(byPath.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count),
    eventsByType: Array.from(byEventType.entries())
      .map(([eventType, count]) => ({ eventType, count }))
      .sort((a, b) => b.count - a.count),
  });
});

// GET /analytics/app-adoption — admin App Adoption page. "Downloads" come from website click
// events (the site has no login, so there is no per-person download data — only counts). "Installs"
// are derived from Device rows (one per install, upserted on every /push/register) and User rows
// (created/touched on every launch via /auth/session).
const DOWNLOAD_EVENTS = ["download_app_click", "apk_download"];
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

analyticsRouter.get("/app-adoption", requireAdmin, async (_req, res) => {
  const now = Date.now();
  const d7 = new Date(now - 7 * 86400_000);
  const d30 = new Date(now - 30 * 86400_000);

  const [downloadRows, devices, usersByProvider, totalUsers, newUsers7, newUsers30, activeUsers7, activeUsers30, proActive] =
    await Promise.all([
      prisma.analyticsEvent.findMany({
        where: { eventType: { in: DOWNLOAD_EVENTS }, createdAt: { gte: d30 } },
        select: { createdAt: true, metadata: true },
      }),
      prisma.device.findMany({
        select: { createdAt: true, lastSeenAt: true, appVersionName: true, appVersionCode: true, platform: true },
      }),
      prisma.user.groupBy({ by: ["authProvider"], _count: { _all: true } }),
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: d7 } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: d30 } } }),
      prisma.proEntitlement.count({ where: { status: "active", expiryAt: { gt: new Date() } } }),
    ]);

  // Downloads
  const downloadsTotal = await prisma.analyticsEvent.count({ where: { eventType: { in: DOWNLOAD_EVENTS } } });
  const downloads7 = downloadRows.filter((r) => r.createdAt >= d7).length;
  const bySource = new Map<string, number>();
  for (const r of downloadRows) {
    const src = (r.metadata as { location?: string; source?: string } | null)?.location
      ?? (r.metadata as { source?: string } | null)?.source
      ?? "unknown";
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
  }

  // Installs (devices)
  const newDevices7 = devices.filter((d) => d.createdAt >= d7).length;
  const newDevices30 = devices.filter((d) => d.createdAt >= d30).length;
  const activeDevices7 = devices.filter((d) => d.lastSeenAt >= d7).length;
  const activeDevices30 = devices.filter((d) => d.lastSeenAt >= d30).length;

  // 30-day daily series: downloads vs new installs
  const series: { date: string; downloads: number; newInstalls: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const key = dayKey(new Date(now - i * 86400_000));
    series.push({
      date: key,
      downloads: downloadRows.filter((r) => dayKey(r.createdAt) === key).length,
      newInstalls: devices.filter((d) => dayKey(d.createdAt) === key).length,
    });
  }

  // Version spread of devices seen in the last 30 days
  const versionCounts = new Map<string, number>();
  for (const d of devices) {
    if (d.lastSeenAt < d30) continue;
    versionCounts.set(d.appVersionName ?? "unknown / pre-1.0.2", (versionCounts.get(d.appVersionName ?? "unknown / pre-1.0.2") ?? 0) + 1);
  }

  res.json({
    downloads: {
      total: downloadsTotal,
      last7Days: downloads7,
      last30Days: downloadRows.length,
      bySource: Array.from(bySource.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    },
    installs: {
      totalDevices: devices.length,
      totalUsers,
      newDevicesLast7Days: newDevices7,
      newDevicesLast30Days: newDevices30,
      newUsersLast7Days: newUsers7,
      newUsersLast30Days: newUsers30,
      activeDevicesLast7Days: activeDevices7,
      activeDevicesLast30Days: activeDevices30,
      activeUsersLast7Days: activeUsers7,
      activeUsersLast30Days: activeUsers30,
      byAuthProvider: Object.entries(
        usersByProvider.reduce<Record<string, number>>((acc, r) => {
          // Both a null and a literal "anonymous" authProvider mean "no real identity" — merge them.
          const key = r.authProvider || "anonymous";
          acc[key] = (acc[key] ?? 0) + r._count._all;
          return acc;
        }, {}),
      )
        .map(([provider, count]) => ({ provider, count }))
        .sort((a, b) => b.count - a.count),
      proActive,
    },
    // Rough conversion — website download clicks vs new installs over the same 30 days. Not exact
    // (one person can click multiple times / on multiple devices; some installs come from other
    // channels) but a directional signal.
    downloadToInstallRate: downloadRows.length > 0 ? Math.round((newDevices30 / downloadRows.length) * 100) : null,
    versionSpread: Array.from(versionCounts.entries()).map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
    dailySeries: series,
  });
});
