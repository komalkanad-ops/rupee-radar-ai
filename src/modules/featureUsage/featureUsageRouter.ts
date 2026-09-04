import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, requireAdmin, type UserRequest } from "../auth/authMiddleware.js";

export const featureUsageRouter = Router();

// authProvider is a category, not an identity. "phone_custom" (our own OTP backend) and
// "phone_firebase" (Firebase phone auth) are both "signed in with a phone number + OTP" from the
// operator's point of view, so they collapse to one label.
function signInMethodLabel(authProvider: string | null | undefined): string {
  switch (authProvider) {
    case "google":
      return "Google";
    case "phone_custom":
    case "phone_firebase":
      return "Phone OTP";
    case "anonymous":
      return "Anonymous";
    default:
      return "Unknown";
  }
}

function parseDateParam(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function clampInt(v: unknown, fallback: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.trunc(n), max);
}

// POST /feature-usage — { screen, action? }. requireUser (not public like the website's
// AnalyticsEvent) — this is per-user telemetry, the whole point is answering "which real users use
// which features," which a public/unauthenticated event can't attribute to anyone. Fired once per
// navigation from RupeeRadarNavHost, plus a few explicit actions (e.g. "export_csv", and the
// login-screen funnel actions "google_tapped" / "otp_requested" / "otp_success" — those POST under
// whatever token the app holds at the time, which pre-login is the anonymous session).
featureUsageRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const { screen, action } = req.body ?? {};
  if (!screen || typeof screen !== "string") {
    return res.status(400).json({ error: "screen is required" });
  }

  const event = await prisma.featureUsageEvent.create({
    data: {
      userId: req.userId!,
      screen: screen.slice(0, 200),
      action: typeof action === "string" ? action.slice(0, 200) : null,
    },
  });
  res.status(201).json({ id: event.id });
});

// GET /feature-usage/summary?since=&until= — admin console's "Screens" tab. Ranks screens by total
// event count and distinct-user count, plus a day-by-day breakdown. Only screens with at least one
// event appear — the admin console cross-references the app's full known screen list to show true
// zeros.
featureUsageRouter.get("/summary", requireAdmin, async (req, res) => {
  const since = parseDateParam(req.query.since);
  const until = parseDateParam(req.query.until);
  const where: any = {};
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = since;
    if (until) where.createdAt.lte = until;
  }

  const rows = await prisma.featureUsageEvent.findMany({ where, select: { screen: true, userId: true, createdAt: true } });

  const byScreen = new Map<string, { events: number; users: Set<string> }>();
  const byDay = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const s = byScreen.get(row.screen) ?? { events: 0, users: new Set() };
    s.events += 1;
    s.users.add(row.userId);
    byScreen.set(row.screen, s);

    const day = row.createdAt.toISOString().slice(0, 10);
    const dayMap = byDay.get(day) ?? new Map<string, number>();
    dayMap.set(row.screen, (dayMap.get(row.screen) ?? 0) + 1);
    byDay.set(day, dayMap);
  }

  const screens = Array.from(byScreen.entries())
    .map(([screen, s]) => ({ screen, events: s.events, distinctUsers: s.users.size }))
    .sort((a, b) => b.events - a.events);

  const daily = Array.from(byDay.entries())
    .map(([date, screenMap]) => ({
      date,
      screens: Array.from(screenMap.entries())
        .map(([screen, count]) => ({ screen, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  res.json({ totalEvents: rows.length, screens, daily });
});

// GET /feature-usage/by-user — admin "Users" tab. One row per user who has any activity, enriched
// with sign-in method, primary device, app version, and PRO status, so the operator can answer
// "who is using the app, on what, and how did they sign in." Returns real email/phone — same
// exposure as GET /users, still requireAdmin.
// Query: sort=lastSeen|firstSeen|events|screens|accountCreatedAt, order=asc|desc,
//        provider=<authProvider>, since=&until= (activity window), q=<email/phone substring>
featureUsageRouter.get("/by-user", requireAdmin, async (req, res) => {
  const since = parseDateParam(req.query.since);
  const until = parseDateParam(req.query.until);
  const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const sort = typeof req.query.sort === "string" ? req.query.sort : "lastSeen";
  const order = req.query.order === "asc" ? "asc" : "desc";

  const eventWhere: any = {};
  if (since || until) {
    eventWhere.createdAt = {};
    if (since) eventWhere.createdAt.gte = since;
    if (until) eventWhere.createdAt.lte = until;
  }

  const events = await prisma.featureUsageEvent.findMany({
    where: eventWhere,
    select: { userId: true, screen: true, createdAt: true },
  });

  const byUser = new Map<
    string,
    { events: number; screens: Map<string, number>; first: Date; last: Date }
  >();
  for (const row of events) {
    const u = byUser.get(row.userId) ?? { events: 0, screens: new Map<string, number>(), first: row.createdAt, last: row.createdAt };
    u.events += 1;
    u.screens.set(row.screen, (u.screens.get(row.screen) ?? 0) + 1);
    if (row.createdAt < u.first) u.first = row.createdAt;
    if (row.createdAt > u.last) u.last = row.createdAt;
    byUser.set(row.userId, u);
  }

  const userIds = Array.from(byUser.keys());
  const [users, bugReportCounts, devices, proRows] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, phone: true, name: true, authProvider: true, createdAt: true },
    }),
    prisma.bugReport.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { _all: true } }),
    prisma.device.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, deviceModel: true, deviceManufacturer: true, osVersion: true, appVersionName: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
    }),
    prisma.proEntitlement.findMany({
      where: { userId: { in: userIds }, status: "active", expiryAt: { gt: new Date() } },
      select: { userId: true },
    }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const bugCountById = new Map(bugReportCounts.map((r) => [r.userId as string, r._count._all]));
  const proUserIds = new Set(proRows.map((r) => r.userId));
  const deviceCountById = new Map<string, number>();
  const primaryDeviceById = new Map<string, (typeof devices)[number]>();
  for (const d of devices) {
    deviceCountById.set(d.userId, (deviceCountById.get(d.userId) ?? 0) + 1);
    if (!primaryDeviceById.has(d.userId)) primaryDeviceById.set(d.userId, d); // devices are lastSeenAt desc
  }

  let result = userIds.map((userId) => {
    const u = byUser.get(userId)!;
    const profile = userById.get(userId);
    const pd = primaryDeviceById.get(userId);
    const topScreen = Array.from(u.screens.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      userId,
      email: profile?.email ?? null,
      phone: profile?.phone ?? null,
      name: profile?.name ?? null,
      authProvider: profile?.authProvider ?? null,
      signInMethod: signInMethodLabel(profile?.authProvider),
      accountCreatedAt: profile?.createdAt ?? null,
      deviceCount: deviceCountById.get(userId) ?? 0,
      primaryDevice: pd
        ? {
            model: pd.deviceModel,
            manufacturer: pd.deviceManufacturer,
            osVersion: pd.osVersion,
            appVersionName: pd.appVersionName,
          }
        : null,
      isPro: proUserIds.has(userId),
      totalEvents: u.events,
      distinctScreens: u.screens.size,
      topScreen,
      bugReportCount: bugCountById.get(userId) ?? 0,
      firstSeen: u.first,
      lastSeen: u.last,
    };
  });

  if (provider) result = result.filter((r) => r.authProvider === provider);
  if (q) {
    const needle = q.toLowerCase();
    result = result.filter(
      (r) =>
        (r.email ?? "").toLowerCase().includes(needle) ||
        (r.phone ?? "").toLowerCase().includes(needle) ||
        (r.name ?? "").toLowerCase().includes(needle),
    );
  }

  const dir = order === "asc" ? 1 : -1;
  const keyFn: Record<string, (r: (typeof result)[number]) => number> = {
    lastSeen: (r) => r.lastSeen.getTime(),
    firstSeen: (r) => r.firstSeen.getTime(),
    events: (r) => r.totalEvents,
    screens: (r) => r.distinctScreens,
    accountCreatedAt: (r) => r.accountCreatedAt?.getTime() ?? 0,
  };
  const getKey = keyFn[sort] ?? keyFn.lastSeen;
  result.sort((a, b) => (getKey(a) - getKey(b)) * dir);

  res.json({ totalUsers: result.length, users: result });
});

// GET /feature-usage/events — admin "Activity feed" tab. Global chronological list of screen opens
// / actions: which user, which screen, when. Params: since, until, screen, userId, provider,
// order=asc|desc, limit (<=500, default 100), offset.
featureUsageRouter.get("/events", requireAdmin, async (req, res) => {
  const since = parseDateParam(req.query.since);
  const until = parseDateParam(req.query.until);
  const screen = typeof req.query.screen === "string" && req.query.screen ? req.query.screen : undefined;
  const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : undefined;
  const provider = typeof req.query.provider === "string" && req.query.provider ? req.query.provider : undefined;
  const order = req.query.order === "asc" ? "asc" : "desc";
  const limit = clampInt(req.query.limit, 100, 500);
  const offset = clampInt(req.query.offset, 0, 1_000_000);

  const where: any = {};
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = since;
    if (until) where.createdAt.lte = until;
  }
  if (screen) where.screen = screen;
  if (userId) where.userId = userId;

  // A provider filter needs the set of userIds with that authProvider first.
  if (provider) {
    const ids = await prisma.user.findMany({ where: { authProvider: provider }, select: { id: true } });
    where.userId = userId ? userId : { in: ids.map((u) => u.id) };
  }

  const [total, rows] = await Promise.all([
    prisma.featureUsageEvent.count({ where }),
    prisma.featureUsageEvent.findMany({
      where,
      select: { id: true, userId: true, screen: true, action: true, createdAt: true },
      orderBy: { createdAt: order },
      take: limit,
      skip: offset,
    }),
  ]);

  const ids = Array.from(new Set(rows.map((r) => r.userId)));
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, phone: true, name: true, authProvider: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  res.json({
    total,
    limit,
    offset,
    events: rows.map((r) => {
      const u = userById.get(r.userId);
      return {
        id: r.id,
        createdAt: r.createdAt,
        screen: r.screen,
        action: r.action,
        userId: r.userId,
        email: u?.email ?? null,
        phone: u?.phone ?? null,
        name: u?.name ?? null,
        signInMethod: signInMethodLabel(u?.authProvider),
      };
    }),
  });
});

// GET /feature-usage/user/:userId — admin per-user drill-down. Profile basics, every device, a
// screen-visit breakdown, and a paginated raw event timeline (limit<=500 default 200, offset).
featureUsageRouter.get("/user/:userId", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const limit = clampInt(req.query.limit, 200, 500);
  const offset = clampInt(req.query.offset, 0, 1_000_000);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      phone: true,
      name: true,
      authProvider: true,
      persona: true,
      city: true,
      incomeBracket: true,
      createdAt: true,
      lastLoginAt: true,
      proEntitlement: { select: { status: true, expiryAt: true, productId: true } },
    },
  });
  if (!user) return res.status(404).json({ error: "User not found" });

  const [devices, allEvents, total, timeline] = await Promise.all([
    prisma.device.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
      select: {
        deviceIdentifier: true,
        platform: true,
        deviceModel: true,
        deviceManufacturer: true,
        osVersion: true,
        appVersionName: true,
        appVersionCode: true,
        digestOptIn: true,
        createdAt: true,
        lastSeenAt: true,
      },
    }),
    prisma.featureUsageEvent.findMany({ where: { userId }, select: { screen: true } }),
    prisma.featureUsageEvent.count({ where: { userId } }),
    prisma.featureUsageEvent.findMany({
      where: { userId },
      select: { id: true, screen: true, action: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
  ]);

  const screenCounts = new Map<string, number>();
  for (const e of allEvents) screenCounts.set(e.screen, (screenCounts.get(e.screen) ?? 0) + 1);

  const isPro =
    user.proEntitlement?.status === "active" && (user.proEntitlement.expiryAt?.getTime() ?? 0) > Date.now();

  res.json({
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      authProvider: user.authProvider,
      signInMethod: signInMethodLabel(user.authProvider),
      persona: user.persona,
      city: user.city,
      incomeBracket: user.incomeBracket,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      isPro,
      proExpiryAt: user.proEntitlement?.expiryAt ?? null,
    },
    devices,
    screenBreakdown: Array.from(screenCounts.entries())
      .map(([screen, count]) => ({ screen, count }))
      .sort((a, b) => b.count - a.count),
    totalEvents: total,
    timeline,
    limit,
    offset,
  });
});

// GET /feature-usage/auth-funnel?since=&until= — admin "Sign-in" tab. How people get into the app:
// provider mix (retroactive, from User rows), new signups per day per provider, and the
// attempt-level login-screen funnel (google_tapped -> otp_requested -> otp_submitted -> *_success),
// which only has data from the app build that started emitting those actions.
featureUsageRouter.get("/auth-funnel", requireAdmin, async (req, res) => {
  const since = parseDateParam(req.query.since);
  const until = parseDateParam(req.query.until);
  const userWhere: any = {};
  if (since || until) {
    userWhere.createdAt = {};
    if (since) userWhere.createdAt.gte = since;
    if (until) userWhere.createdAt.lte = until;
  }
  const eventWhere: any = { screen: "login" };
  if (since || until) {
    eventWhere.createdAt = {};
    if (since) eventWhere.createdAt.gte = since;
    if (until) eventWhere.createdAt.lte = until;
  }

  const [providerGroups, signupUsers, loginEvents] = await Promise.all([
    prisma.user.groupBy({ by: ["authProvider"], _count: { _all: true } }),
    prisma.user.findMany({ where: userWhere, select: { authProvider: true, createdAt: true } }),
    prisma.featureUsageEvent.findMany({ where: eventWhere, select: { action: true, createdAt: true } }),
  ]);

  // Provider mix — merge null + "anonymous".
  const byProviderMap = new Map<string, number>();
  for (const g of providerGroups) {
    const key = g.authProvider || "anonymous";
    byProviderMap.set(key, (byProviderMap.get(key) ?? 0) + g._count._all);
  }
  const byMethodMap = new Map<string, number>();
  for (const [prov, count] of byProviderMap) {
    const label = signInMethodLabel(prov);
    byMethodMap.set(label, (byMethodMap.get(label) ?? 0) + count);
  }

  // New signups per day per provider.
  const signupsByDay = new Map<string, Map<string, number>>();
  for (const u of signupUsers) {
    const day = u.createdAt.toISOString().slice(0, 10);
    const prov = u.authProvider || "anonymous";
    const m = signupsByDay.get(day) ?? new Map<string, number>();
    m.set(prov, (m.get(prov) ?? 0) + 1);
    signupsByDay.set(day, m);
  }

  // Attempt-level login funnel.
  const loginActions = new Map<string, number>();
  const loginActionsByDay = new Map<string, Map<string, number>>();
  for (const e of loginEvents) {
    const a = e.action ?? "(screen open)";
    loginActions.set(a, (loginActions.get(a) ?? 0) + 1);
    const day = e.createdAt.toISOString().slice(0, 10);
    const m = loginActionsByDay.get(day) ?? new Map<string, number>();
    m.set(a, (m.get(a) ?? 0) + 1);
    loginActionsByDay.set(day, m);
  }

  res.json({
    byProvider: Array.from(byProviderMap.entries())
      .map(([provider, count]) => ({ provider, count }))
      .sort((a, b) => b.count - a.count),
    byMethod: Array.from(byMethodMap.entries())
      .map(([method, count]) => ({ method, count }))
      .sort((a, b) => b.count - a.count),
    signupsByDay: Array.from(signupsByDay.entries())
      .map(([date, m]) => ({ date, providers: Array.from(m.entries()).map(([provider, count]) => ({ provider, count })) }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    loginActions: Array.from(loginActions.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count),
    loginActionsByDay: Array.from(loginActionsByDay.entries())
      .map(([date, m]) => ({ date, actions: Array.from(m.entries()).map(([action, count]) => ({ action, count })) }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
  });
});
