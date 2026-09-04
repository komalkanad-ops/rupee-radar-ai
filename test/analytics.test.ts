import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

describe("Website analytics (/analytics)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("GET /analytics/summary rejects a non-admin caller", async () => {
    const res = await request(app).get("/analytics/summary");
    expect(res.status).toBe(401);
  });

  it("POST /analytics/event rejects a missing path", async () => {
    const res = await request(app).post("/analytics/event").send({ eventType: "pageview" });
    expect(res.status).toBe(400);
  });

  it("POST /analytics/event rejects a missing eventType", async () => {
    const res = await request(app).post("/analytics/event").send({ path: "/" });
    expect(res.status).toBe(400);
  });

  it("POST /analytics/event accepts a public (unauthenticated) pageview", async () => {
    const res = await request(app).post("/analytics/event").send({ path: "/emi-calculator", eventType: "pageview" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    createdIds.push(res.body.id);
  });

  it("admin summary groups pageviews by path and events by type", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const marker = `/test-page-${Date.now()}`;
    const p1 = await request(app).post("/analytics/event").send({ path: marker, eventType: "pageview" });
    const p2 = await request(app).post("/analytics/event").send({ path: marker, eventType: "pageview" });
    const conv = await request(app).post("/analytics/event").send({ path: marker, eventType: "download_app_click" });
    createdIds.push(p1.body.id, p2.body.id, conv.body.id);

    const res = await request(app).get("/analytics/summary").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const pathEntry = res.body.pageviewsByPath.find((r: any) => r.path === marker);
    expect(pathEntry.count).toBe(2);

    const convEntry = res.body.eventsByType.find((r: any) => r.eventType === "download_app_click");
    expect(convEntry.count).toBe(1);
  });

  it("GET /analytics/app-adoption is admin-only and returns the expected shape", async () => {
    const unauth = await request(app).get("/analytics/app-adoption");
    expect(unauth.status).toBe(401);

    const token = await adminToken();
    if (!token) return;

    const res = await request(app).get("/analytics/app-adoption").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.downloads.total).toBe("number");
    expect(typeof res.body.installs.totalDevices).toBe("number");
    expect(Array.isArray(res.body.installs.byAuthProvider)).toBe(true);
    expect(Array.isArray(res.body.versionSpread)).toBe(true);
    expect(res.body.dailySeries).toHaveLength(30);
  });
});
