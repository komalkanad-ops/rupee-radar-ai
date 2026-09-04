import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { recordMetric, routeSummaries, routeTimeline } from "../src/lib/routeMetrics.js";

// R7 — request correlation + telemetry (2026-09-03 audit, track G / D1+D3+D6).

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

describe("X-Request-Id correlation", () => {
  it("echoes a generated request id on a successful response", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("honours a well-formed client-supplied id", async () => {
    const res = await request(app).get("/health").set("X-Request-Id", "client-abc-123456");
    expect(res.headers["x-request-id"]).toBe("client-abc-123456");
  });

  it("ignores a malformed supplied id and generates its own", async () => {
    const res = await request(app).get("/health").set("X-Request-Id", "bad id with spaces!!");
    expect(res.headers["x-request-id"]).not.toBe("bad id with spaces!!");
    expect(res.headers["x-request-id"]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("echoes the id and includes it in the body on an error response", async () => {
    const res = await request(app).get("/definitely-not-a-route").set("X-Request-Id", "err-ref-99887766");
    expect(res.headers["x-request-id"]).toBe("err-ref-99887766");
  });
});

describe("/health/db timed probe", () => {
  it("returns connectMs / uptimeS / pid alongside db status", async () => {
    const res = await request(app).get("/health/db");
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("up");
    expect(typeof res.body.connectMs).toBe("number");
    expect(res.body.connectMs).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.pid).toBe("number");
  });
});

describe("RouteMetricBucket rollup", () => {
  const bucketKeys: Array<{ method: string; route: string }> = [];

  afterAll(async () => {
    await prisma.routeMetricBucket.deleteMany({
      where: { OR: bucketKeys.map((k) => ({ method: k.method, route: k.route })) },
    });
  });

  it("recordMetric + flush surfaces in routeSummaries with an error rate and percentiles", async () => {
    const route = `/__test_metric_${Date.now()}`;
    bucketKeys.push({ method: "GET", route });
    for (let i = 0; i < 20; i++) recordMetric("GET", route, 50 + i, 200);
    recordMetric("GET", route, 900, 500); // one 5xx

    // Force a flush of the current (still-open) bucket by writing it directly, mirroring what the
    // background timer does — the read side only reads the DB.
    await prisma.routeMetricBucket.create({
      data: {
        bucketAt: new Date(Math.floor(Date.now() / 300000) * 300000),
        method: "GET",
        route,
        count: 21,
        errorCount: 1,
        clientErrs: 0,
        p50Ms: 60,
        p95Ms: 900,
        maxMs: 900,
      },
    });

    const summaries = await routeSummaries("1h");
    const row = summaries.find((s) => s.route === route);
    expect(row).toBeDefined();
    expect(row!.calls).toBe(21);
    expect(row!.errorCount).toBe(1);
    expect(row!.errorRate).toBeCloseTo(1 / 21, 5);
    expect(row!.p95).toBe(900);
  });

  it("routeTimeline returns the bucket series for one route", async () => {
    const route = `/__test_timeline_${Date.now()}`;
    bucketKeys.push({ method: "GET", route });
    await prisma.routeMetricBucket.create({
      data: {
        bucketAt: new Date(Math.floor(Date.now() / 300000) * 300000),
        method: "GET",
        route,
        count: 5,
        errorCount: 0,
        clientErrs: 0,
        p50Ms: 30,
        p95Ms: 40,
        maxMs: 45,
      },
    });
    const series = await routeTimeline(route, "GET", "1h");
    expect(series).toHaveLength(1);
    expect(series[0].calls).toBe(5);
    expect(series[0].p95).toBe(40);
  });

  it("excludes the synthetic __db_probe row from the route table", async () => {
    const summaries = await routeSummaries("24h");
    expect(summaries.every((s) => s.route !== "__db_probe")).toBe(true);
  });
});

describe("admin monitoring telemetry endpoints", () => {
  it("GET /admin/monitoring/routes rejects a non-admin", async () => {
    const res = await request(app).get("/admin/monitoring/routes");
    expect(res.status).toBe(401);
  });

  it("GET /admin/monitoring/routes returns a windowed route list for an admin", async () => {
    const token = await adminToken();
    if (!token) return;
    const res = await request(app).get("/admin/monitoring/routes?window=1h").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.window).toBe("1h");
    expect(Array.isArray(res.body.routes)).toBe(true);
  });

  it("GET /admin/monitoring/db returns a probe + connectMs series + table sizes", async () => {
    const token = await adminToken();
    if (!token) return;
    const res = await request(app).get("/admin/monitoring/db?window=24h").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.probe).toBeDefined();
    expect(Array.isArray(res.body.connectMsSeries)).toBe(true);
    expect(Array.isArray(res.body.tableSizes)).toBe(true);
    // table sizes come from information_schema — this DB has tables
    expect(res.body.tableSizes.length).toBeGreaterThan(0);
    expect(res.body.tableSizes[0]).toHaveProperty("totalMb");
  });

  it("GET /admin/monitoring/timeline requires a route param", async () => {
    const token = await adminToken();
    if (!token) return;
    const res = await request(app).get("/admin/monitoring/timeline").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
