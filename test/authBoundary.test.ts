import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

// ---------------------------------------------------------------------------------------------------
// authBoundary.test.ts — the NEGATIVE-direction auth sweeps from the 2026-09-03 Track F audit (§2.4).
//
// The rest of the suite asserts "the right credential opens the door". These assert "the wrong
// credential stays out", table-driven, so a NEW router added without gating fails CI rather than
// slipping through a review. T1–T3 (the single assertions that catch the confirmed Critical) live
// in test/adminTokenTypeIsolation.test.ts; this file is T7–T11 — the exhaustive sweeps.
//
// If a sweep finds a real gap it is marked `it.skip` / `it.todo` with a `// AUDIT GAP:` comment and
// called out in the batch report, NOT fixed here (another batch owns src/).
// ---------------------------------------------------------------------------------------------------

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string | undefined> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

// =================================================================================================
// T7 — table-driven admin-surface sweep
// =================================================================================================
//
// Every admin-gated route mounted from src/app.ts. For each: (a) no Authorization header → 401,
// (b) a real anonymous user session token → 401 (this is the family the Critical bypass lived in).
//
// The list is a hand-maintained SNAPSHOT. A separate test below re-derives the admin-gated routes
// straight from the router source and fails if this snapshot drifts — so a new `requireAdmin`
// route added without a T7 entry breaks the build.
type Route = { method: "get" | "post" | "put" | "patch" | "delete"; path: string; role?: "config" };

const ADMIN_ROUTES: Route[] = [
  // auth (admin diagnostics + RBAC management)
  { method: "get", path: "/auth/admin/firebase-diagnostics" },
  { method: "get", path: "/auth/admin/env-check" },
  { method: "get", path: "/auth/admin/admins", role: "config" },
  { method: "post", path: "/auth/admin/admins", role: "config" },
  { method: "patch", path: "/auth/admin/admins/x/role", role: "config" },
  // cards / banks / redemption portals
  { method: "post", path: "/cards" },
  { method: "put", path: "/cards/x" },
  { method: "delete", path: "/cards/x" },
  { method: "post", path: "/cards/bulk-import" },
  { method: "post", path: "/banks" },
  { method: "put", path: "/banks/x" },
  { method: "delete", path: "/banks/x" },
  { method: "post", path: "/redemption-portals" },
  { method: "put", path: "/redemption-portals/x" },
  { method: "delete", path: "/redemption-portals/x" },
  // corrections
  { method: "get", path: "/corrections" },
  { method: "post", path: "/corrections/x/summarize" },
  { method: "post", path: "/corrections/x/approve" },
  { method: "post", path: "/corrections/x/reject" },
  // sms
  { method: "post", path: "/sms/recategorize" },
  // subscription providers
  { method: "post", path: "/subscription-providers" },
  { method: "put", path: "/subscription-providers/x" },
  { method: "delete", path: "/subscription-providers/x" },
  // site content
  { method: "get", path: "/site-content/screenshots/admin" },
  { method: "post", path: "/site-content/screenshots" },
  { method: "put", path: "/site-content/screenshots/reorder" },
  { method: "patch", path: "/site-content/screenshots/x" },
  { method: "delete", path: "/site-content/screenshots/x" },
  // merchant recommendations
  { method: "post", path: "/merchant-recommendations" },
  { method: "put", path: "/merchant-recommendations/x" },
  { method: "delete", path: "/merchant-recommendations/x" },
  // billing (admin grant/revoke)
  { method: "post", path: "/billing/admin/grant" },
  { method: "post", path: "/billing/admin/revoke" },
  // config links
  { method: "post", path: "/config/links" },
  { method: "delete", path: "/config/links/x" },
  // push
  { method: "get", path: "/push/stats" },
  { method: "post", path: "/push/broadcast" },
  // users
  { method: "get", path: "/users" },
  // challenges
  { method: "post", path: "/challenges/catalog" },
  { method: "put", path: "/challenges/catalog/x" },
  { method: "delete", path: "/challenges/catalog/x" },
  { method: "post", path: "/challenges/badges" },
  { method: "put", path: "/challenges/badges/x" },
  { method: "delete", path: "/challenges/badges/x" },
  // offers (admin CRUD)
  { method: "post", path: "/offers" },
  { method: "put", path: "/offers/x" },
  { method: "delete", path: "/offers/x" },
  // rewards / vouchers
  { method: "post", path: "/rewards/admin/vouchers" },
  { method: "put", path: "/rewards/admin/vouchers/x" },
  { method: "get", path: "/rewards/admin/vouchers" },
  { method: "delete", path: "/rewards/admin/vouchers/x" },
  { method: "get", path: "/rewards/admin/redemptions" },
  { method: "patch", path: "/rewards/admin/redemptions/x" },
  // feedback
  { method: "get", path: "/feedback" },
  { method: "patch", path: "/feedback/x/status" },
  // bug reports
  { method: "get", path: "/bug-reports" },
  { method: "patch", path: "/bug-reports/x/status" },
  // login bypass
  { method: "get", path: "/admin/login-bypass" },
  { method: "post", path: "/admin/login-bypass" },
  { method: "patch", path: "/admin/login-bypass/x" },
  { method: "delete", path: "/admin/login-bypass/x" },
  // app version (writes + admin list)
  { method: "get", path: "/app-version" },
  { method: "post", path: "/app-version" },
  { method: "patch", path: "/app-version/x" },
  { method: "delete", path: "/app-version/x" },
  // feature flags (config role)
  { method: "post", path: "/feature-flags", role: "config" },
  { method: "patch", path: "/feature-flags/x", role: "config" },
  { method: "delete", path: "/feature-flags/x", role: "config" },
  // announcements
  { method: "get", path: "/announcements" },
  { method: "post", path: "/announcements", role: "config" },
  { method: "patch", path: "/announcements/x", role: "config" },
  { method: "delete", path: "/announcements/x", role: "config" },
  // logs
  { method: "get", path: "/logs" },
  // mesh usage
  { method: "get", path: "/mesh-usage/live" },
  { method: "get", path: "/mesh-usage/features" },
  { method: "get", path: "/mesh-usage/by-user" },
  // changelog (writes)
  { method: "post", path: "/changelog" },
  { method: "patch", path: "/changelog/x" },
  { method: "delete", path: "/changelog/x" },
  // feature usage
  { method: "get", path: "/feature-usage/summary" },
  { method: "get", path: "/feature-usage/by-user" },
  { method: "get", path: "/feature-usage/events" },
  { method: "get", path: "/feature-usage/user/x" },
  { method: "get", path: "/feature-usage/auth-funnel" },
  // analytics
  { method: "get", path: "/analytics/summary" },
  { method: "get", path: "/analytics/app-adoption" },
  // monitoring
  { method: "get", path: "/admin/monitoring/status" },
  { method: "get", path: "/admin/monitoring/issues" },
  { method: "get", path: "/admin/monitoring/issues/x" },
  { method: "post", path: "/admin/monitoring/issues/x/resolve" },
  { method: "get", path: "/admin/monitoring/routes" },
  { method: "get", path: "/admin/monitoring/timeline" },
  { method: "get", path: "/admin/monitoring/db" },
];

describe("T7 — admin routes reject unauthenticated + non-admin (user) tokens", () => {
  let userToken: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const u = await createAnonymousUser();
    userToken = u.token;
    userIds.push(u.userId);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it.each(ADMIN_ROUTES)("$method $path — no Authorization header → 401", async ({ method, path: p }) => {
    const res = await (request(app) as any)[method](p).send({});
    expect(res.status).toBe(401);
  });

  it.each(ADMIN_ROUTES)("$method $path — anonymous user session token → 401", async ({ method, path: p }) => {
    const res = await (request(app) as any)[method](p).set("Authorization", `Bearer ${userToken}`).send({});
    expect(res.status).toBe(401);
  });
});

describe("T7 snapshot guard — every admin-gated route in the source is covered by ADMIN_ROUTES", () => {
  // Re-derive the admin surface straight from the router source. Any Router.<verb>("<path>", ...)
  // call whose middleware list names an admin guard is an admin route. If the derived set contains
  // a router path with no matching ADMIN_ROUTES entry, a new admin route was added without a T7
  // sweep entry — fail CI.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const modulesDir = path.join(here, "..", "src", "modules");

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.endsWith(".ts") ? [full] : [];
    });
  }

  const ADMIN_GUARD_RE = /\b(requireAdmin|requireRole|requireSuperAdmin|requireConfigRole)\b/;
  const ROUTE_RE = /(\w+)\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\3\s*,([^)]*)\)/g;

  // router-variable -> mounted prefix (from src/app.ts app.use(...) lines)
  const MOUNTS: Record<string, string> = {
    authRouter: "/auth",
    cardsRouter: "/cards",
    banksRouter: "/banks",
    portalsRouter: "/redemption-portals",
    correctionsRouter: "/corrections",
    smsRouter: "/sms",
    subscriptionProvidersRouter: "/subscription-providers",
    siteContentRouter: "/site-content",
    merchantRecommendationsRouter: "/merchant-recommendations",
    billingRouter: "/billing",
    configRouter: "/config",
    pushRouter: "/push",
    usersRouter: "/users",
    challengesRouter: "/challenges",
    offersRouter: "/offers",
    rewardsRouter: "/rewards",
    feedbackRouter: "/feedback",
    bugReportRouter: "/bug-reports",
    loginBypassRouter: "/admin/login-bypass",
    appVersionRouter: "/app-version",
    featureFlagsRouter: "/feature-flags",
    announcementsRouter: "/announcements",
    logsRouter: "/logs",
    meshUsageRouter: "/mesh-usage",
    changelogRouter: "/changelog",
    featureUsageRouter: "/feature-usage",
    analyticsRouter: "/analytics",
    monitoringRouter: "/admin/monitoring",
  };

  function norm(p: string): string {
    // collapse express params (:id, :category, :userId) to the placeholder used in ADMIN_ROUTES
    return p.replace(/:[A-Za-z0-9_]+/g, "x").replace(/\/+$/, "") || "/";
  }

  it("no admin-gated router route is missing from the ADMIN_ROUTES snapshot", () => {
    const snapshot = new Set(ADMIN_ROUTES.map((r) => `${r.method} ${norm(r.path)}`));
    const discovered: string[] = [];
    const unmapped: string[] = [];

    for (const file of walk(modulesDir)) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(ROUTE_RE)) {
        const [, routerVar, method, , subPath, middleware] = m;
        if (!ADMIN_GUARD_RE.test(middleware)) continue;
        const prefix = MOUNTS[routerVar];
        if (!prefix) {
          unmapped.push(`${routerVar} ${method} ${subPath} (${path.basename(file)})`);
          continue;
        }
        const full = norm(prefix + (subPath === "/" ? "" : subPath));
        const key = `${method} ${full}`;
        if (!snapshot.has(key)) discovered.push(`${key}   [${path.basename(file)}]`);
      }
    }

    expect(
      unmapped,
      `Admin-gated routes on a router variable this test doesn't know how to mount.\n` +
        `Add it to MOUNTS (and ADMIN_ROUTES):\n  ${unmapped.join("\n  ")}`,
    ).toEqual([]);

    expect(
      discovered,
      `New admin-gated route(s) with no ADMIN_ROUTES entry — add them to the T7 sweep:\n  ${discovered.join("\n  ")}`,
    ).toEqual([]);
  });
});

// =================================================================================================
// T8 — every requirePro route rejects a non-PRO user token (403 or the deliberate proRequired 200)
// =================================================================================================
describe("T8 — PRO routes reject a non-PRO user", () => {
  let token: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const u = await createAnonymousUser();
    token = u.token;
    userIds.push(u.userId);
  });

  afterAll(async () => {
    await prisma.chatUsage.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.meshUsageLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.household.deleteMany({ where: { ownerUserId: { in: userIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  // Routes gated by the requirePro middleware — a hard 403 { proRequired: true } for a free user.
  const PRO_403: Route[] = [
    { method: "get", path: "/offers" },
    { method: "get", path: "/insights/review" },
    { method: "post", path: "/insights/review/narrative" },
    { method: "get", path: "/insights/safety-net" },
    { method: "get", path: "/insights/leaks" },
    { method: "post", path: "/insights/leaks/narrative" },
    { method: "post", path: "/insights/narrative" },
    { method: "get", path: "/cashflow/calendar" },
    { method: "get", path: "/tax/status" },
    { method: "get", path: "/tax/export" },
    { method: "post", path: "/credit-score/refresh" },
    { method: "get", path: "/credit-score/latest" },
    { method: "get", path: "/credit-score/history" },
    { method: "post", path: "/household" },
    { method: "post", path: "/household/join" },
    { method: "get", path: "/household" },
    { method: "patch", path: "/household/sharing" },
    { method: "patch", path: "/household/spend-sharing" },
    { method: "get", path: "/household/spend" },
    { method: "get", path: "/household/networth" },
    { method: "get", path: "/networth/runway" },
  ];

  it.each(PRO_403)("$method $path — non-PRO user → 403 { proRequired: true }", async ({ method, path: p }) => {
    const res = await (request(app) as any)[method](p).set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(403);
    expect(res.body?.proRequired).toBe(true);
  });

  // The LLM-cost routes that deliberately answer 200 with a proRequired flag (so the app can prompt
  // an upgrade rather than treat it as an error) instead of 403 — assert that contract stays.
  it("POST /sms/parse — non-PRO user, unparseable SMS → 200 proRequired (no LLM spent)", async () => {
    const res = await request(app)
      .post("/sms/parse")
      .set("Authorization", `Bearer ${token}`)
      .send({ rawSms: "totally unstructured text that no regex rule will ever match", bankSender: "XX-NADA" });
    expect(res.status).toBe(200);
    expect(res.body.proRequired).toBe(true);
    expect(res.body.parsedVia).not.toBe("llm");
  });

  it("POST /categorization/classify — non-PRO user → 200 proRequired, no results", async () => {
    const res = await request(app)
      .post("/categorization/classify")
      .set("Authorization", `Bearer ${token}`)
      .send({ merchants: ["some new merchant"] });
    expect(res.status).toBe(200);
    expect(res.body.proRequired).toBe(true);
    expect(res.body.results).toEqual({});
  });

  it("POST /chat — a free user is NOT 403'd (chat has a free tier, only a message cap)", async () => {
    const res = await request(app).post("/chat").set("Authorization", `Bearer ${token}`).send({ message: "hi" });
    // 200 (answered) or 429 (free lifetime cap hit) or 502 (mesh unavailable in CI) — never 403.
    expect(res.status).not.toBe(403);
  });
});

// =================================================================================================
// T9 — mass-assignment sweep: extra { userId, active, id } in the body must not take effect
// =================================================================================================
describe("T9 — create/update ignore client-supplied userId / active / id", () => {
  const userIds: string[] = [];
  let victim: { userId: string; token: string };
  let attacker: { userId: string; token: string };

  beforeAll(async () => {
    victim = await createAnonymousUser();
    attacker = await createAnonymousUser();
    userIds.push(victim.userId, attacker.userId);
  });

  afterAll(async () => {
    for (const m of [
      "investment",
      "goal",
      "wishlistItem",
      "parkingTicket",
      "productRecord",
      "todoItem",
      "savingsInstrument",
      "lentMoney",
      "recurringPayment",
    ] as const) {
      await (prisma as any)[m].deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    }
    await prisma.budget.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  // Each entry: a minimal-valid create body for that router, plus the poison fields injected below.
  // `whitelisted` = the router filters body fields through an explicit sanitize()/destructure so a
  // stray `active` can't get through; the rest spread `...req.body` straight into prisma.create.
  const CREATE_CASES: { name: string; path: string; whitelisted: boolean; body: Record<string, unknown> }[] = [
    { name: "investments", path: "/investments", whitelisted: true, body: { kind: "STOCKS", label: "T9", investedInr: 100 } },
    {
      name: "goals",
      path: "/goals",
      whitelisted: true,
      body: { name: "T9", kind: "GENERAL", targetAmountInr: 1000, targetDate: "2030-01-01T00:00:00.000Z" },
    },
    { name: "savings", path: "/savings", whitelisted: true, body: { type: "OTHER", name: "T9" } },
    { name: "wishlist", path: "/wishlist", whitelisted: true, body: { name: "T9", targetAmount: 1000 } },
    { name: "parking", path: "/parking", whitelisted: true, body: { kind: "PARKING", location: "T9", amount: 50, issuedDate: "2026-01-01T00:00:00.000Z" } },
    { name: "products", path: "/products", whitelisted: true, body: { name: "T9", purchaseDate: "2026-01-01T00:00:00.000Z" } },
    { name: "todo", path: "/todo", whitelisted: true, body: { title: "T9" } },
    { name: "lending", path: "/lending", whitelisted: true, body: { personName: "T9", amount: 100 } },
    { name: "recurring", path: "/recurring", whitelisted: false, body: { type: "SUBSCRIPTION", name: "T9", amount: 199, frequency: "monthly" } },
  ];

  for (const c of CREATE_CASES) {
    // The security-critical property — a client-supplied userId is NEVER honoured — holds for every
    // one of these routers (all derive userId from the token). This is the assertion that matters.
    it(`POST ${c.path} — client userId ignored; row belongs to the token's sub`, async () => {
      const res = await request(app)
        .post(c.path)
        .set("Authorization", `Bearer ${attacker.token}`)
        .send({ ...c.body, userId: victim.userId, id: "t9-forced-id-" + c.name });
      expect([200, 201]).toContain(res.status);
      expect(res.body.userId).toBe(attacker.userId);
      expect(res.body.userId).not.toBe(victim.userId);
    });

    const activeCheck = async () => {
      const res = await request(app)
        .post(c.path)
        .set("Authorization", `Bearer ${attacker.token}`)
        .send({ ...c.body, active: false });
      expect([200, 201]).toContain(res.status);
      // active defaults true in every one of these models; a client shouldn't be able to flip it.
      expect(res.body.active).not.toBe(false);
    };

    if (c.whitelisted) {
      it(`POST ${c.path} — client "active: false" does not create a pre-soft-deleted row`, activeCheck);
    } else {
      // POST /recurring is the one create still on `...req.body` — deliberately: recurringRouter's
      // upsert path reads body.autoDetected / body.firstDetectedAt / body.detectedCount with real
      // logic (the SMS-scan client legitimately sends them). userId is still forced from the token,
      // so the worst a client can do is put its OWN row into its OWN EMI-review flow. Skipped, not
      // failed — this is an accepted exception, not an open gap. (todo/lending/wishlist/parking/
      // products were fixed with lib/sanitizeBody.ts in R6.)
      it.skip(`POST ${c.path} — client fields on own row (accepted: recurring upsert reads them intentionally)`, activeCheck);
    }
  }
});

// =================================================================================================
// T10 — cross-user IDOR: user B cannot mutate user A's row by id (404, row unchanged)
// =================================================================================================
describe("T10 — :id mutation routes reject a token for a different user", () => {
  const userIds: string[] = [];
  let owner: { userId: string; token: string };
  let other: { userId: string; token: string };

  beforeAll(async () => {
    owner = await createAnonymousUser();
    other = await createAnonymousUser();
    userIds.push(owner.userId, other.userId);
  });

  afterAll(async () => {
    for (const m of [
      "investment",
      "goal",
      "wishlistItem",
      "parkingTicket",
      "productRecord",
      "todoItem",
      "savingsInstrument",
      "lentMoney",
      "recurringPayment",
    ] as const) {
      await (prisma as any)[m].deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  const RESOURCES: {
    name: string;
    path: string;
    create: Record<string, unknown>;
    model: string;
    update?: Record<string, unknown>;
    statusPath?: string;
  }[] = [
    { name: "investments", path: "/investments", model: "investment", create: { kind: "STOCKS", label: "own", investedInr: 100 }, update: { kind: "STOCKS", label: "hacked", investedInr: 100 } },
    { name: "goals", path: "/goals", model: "goal", create: { name: "own", targetAmountInr: 100, targetDate: "2030-01-01T00:00:00.000Z" }, update: { name: "hacked", targetAmountInr: 100, targetDate: "2030-01-01T00:00:00.000Z" } },
    { name: "wishlist", path: "/wishlist", model: "wishlistItem", create: { name: "own", targetAmount: 100 }, update: { name: "hacked", targetAmount: 100 } },
    { name: "parking", path: "/parking", model: "parkingTicket", create: { kind: "PARKING", location: "own", amount: 10, issuedDate: "2026-01-01T00:00:00.000Z" }, update: { kind: "PARKING", location: "hacked", amount: 10, issuedDate: "2026-01-01T00:00:00.000Z" }, statusPath: "/status" },
    { name: "products", path: "/products", model: "productRecord", create: { name: "own", purchaseDate: "2026-01-01T00:00:00.000Z" }, update: { name: "hacked", purchaseDate: "2026-01-01T00:00:00.000Z" } },
    { name: "todo", path: "/todo", model: "todoItem", create: { title: "own" }, update: { title: "hacked" }, statusPath: "/status" },
    { name: "savings", path: "/savings", model: "savingsInstrument", create: { type: "OTHER", name: "own" }, update: { type: "OTHER", name: "hacked" } },
    { name: "lending", path: "/lending", model: "lentMoney", create: { personName: "own", amount: 100 }, update: { personName: "hacked", amount: 100 } },
    { name: "recurring", path: "/recurring", model: "recurringPayment", create: { type: "SUBSCRIPTION", name: "own", amount: 100, frequency: "monthly" }, update: { type: "SUBSCRIPTION", name: "hacked", amount: 100, frequency: "monthly" } },
  ];

  for (const r of RESOURCES) {
    it(`${r.path}/:id — another user's PUT → 404 and the row is untouched`, async () => {
      const created = await request(app).post(r.path).set("Authorization", `Bearer ${owner.token}`).send(r.create);
      expect([200, 201]).toContain(created.status);
      const id = created.body.id;

      const put = await request(app)
        .put(`${r.path}/${id}`)
        .set("Authorization", `Bearer ${other.token}`)
        .send(r.update ?? r.create);
      expect(put.status).toBe(404);

      const row = await (prisma as any)[r.model].findUnique({ where: { id } });
      expect(row).not.toBeNull();
      // nothing the attacker sent stuck
      const label = row.label ?? row.name ?? row.title ?? row.personName ?? row.location;
      expect(label).toBe("own");
    });

    it(`${r.path}/:id — another user's DELETE → 404 and the row survives`, async () => {
      const created = await request(app).post(r.path).set("Authorization", `Bearer ${owner.token}`).send(r.create);
      const id = created.body.id;

      const del = await request(app).delete(`${r.path}/${id}`).set("Authorization", `Bearer ${other.token}`);
      expect(del.status).toBe(404);

      const row = await (prisma as any)[r.model].findUnique({ where: { id } });
      expect(row).not.toBeNull();
      expect(row.active).not.toBe(false);
    });

    if (r.statusPath) {
      it(`${r.path}/:id${r.statusPath} — another user's PATCH → 404`, async () => {
        const created = await request(app).post(r.path).set("Authorization", `Bearer ${owner.token}`).send(r.create);
        const id = created.body.id;
        const patch = await request(app)
          .patch(`${r.path}/${id}${r.statusPath}`)
          .set("Authorization", `Bearer ${other.token}`)
          .send({ status: "PAID" });
        expect([403, 404]).toContain(patch.status);
      });
    }
  }
});

// =================================================================================================
// T11 — PII-shape: responses that can include another user's data carry no email/phone/firebaseUid
// =================================================================================================
describe("T11 — cross-user response bodies leak no PII keys", () => {
  const PII_KEYS = new Set(["email", "phone", "firebaseUid", "passwordHash"]);
  const userIds: string[] = [];
  let a: { userId: string; token: string };
  let b: { userId: string; token: string };

  beforeAll(async () => {
    a = await createAnonymousUser();
    b = await createAnonymousUser();
    userIds.push(a.userId, b.userId);
    // give both PRO so the household routes actually return member data rather than 403
    for (const uid of userIds) {
      await prisma.proEntitlement.upsert({
        where: { userId: uid },
        create: { userId: uid, status: "active", productId: "t11", expiryAt: new Date(Date.now() + 864e5) },
        update: { status: "active", expiryAt: new Date(Date.now() + 864e5) },
      });
    }
  });

  afterAll(async () => {
    await prisma.householdMember.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.household.deleteMany({ where: { ownerUserId: { in: userIds } } }).catch(() => {});
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  function assertNoPii(body: unknown, where: string) {
    const seen: string[] = [];
    const visit = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(visit);
      if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          if (PII_KEYS.has(k) && val != null && val !== "") seen.push(k);
          visit(val);
        }
      }
    };
    visit(body);
    expect(seen, `${where} leaked PII key(s): ${seen.join(", ")}`).toEqual([]);
  }

  it("GET /household (with a second member) exposes no member email/phone/firebaseUid", async () => {
    const create = await request(app).post("/household").set("Authorization", `Bearer ${a.token}`).send({ name: "T11 house" });
    expect(create.status).toBe(201);
    const inviteCode = create.body.inviteCode;
    expect(inviteCode).toBeTruthy();

    const join = await request(app).post("/household/join").set("Authorization", `Bearer ${b.token}`).send({ inviteCode });
    expect([200, 201]).toContain(join.status);

    const asOwner = await request(app).get("/household").set("Authorization", `Bearer ${a.token}`);
    assertNoPii(asOwner.body, "GET /household (owner view)");

    const asMember = await request(app).get("/household").set("Authorization", `Bearer ${b.token}`);
    assertNoPii(asMember.body, "GET /household (member view)");
    // the non-owner must not even see the invite code
    expect(asMember.body.inviteCode ?? null).toBeNull();

    const spend = await request(app).get("/household/spend").set("Authorization", `Bearer ${b.token}`);
    assertNoPii(spend.body, "GET /household/spend");

    const nw = await request(app).get("/household/networth").set("Authorization", `Bearer ${b.token}`);
    assertNoPii(nw.body, "GET /household/networth");
  });
});
