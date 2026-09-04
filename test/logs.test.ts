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

describe("Event logs (/logs)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.appEventLog.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("GET /logs rejects a non-admin caller", async () => {
    const res = await request(app).get("/logs");
    expect(res.status).toBe(401);
  });

  it("POST /logs rejects an invalid source", async () => {
    const res = await request(app).post("/logs").send({ source: "IOS", message: "test" });
    expect(res.status).toBe(400);
  });

  it("POST /logs rejects a missing message", async () => {
    const res = await request(app).post("/logs").send({ source: "ANDROID" });
    expect(res.status).toBe(400);
  });

  it("POST /logs accepts a public (unauthenticated) client error report", async () => {
    const res = await request(app)
      .post("/logs")
      .send({ source: "WEB", level: "ERROR", feature: "chat", message: "network timeout after 45s" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    createdIds.push(res.body.id);

    const row = await prisma.appEventLog.findUnique({ where: { id: res.body.id } });
    expect(row?.userId).toBeNull();
    expect(row?.level).toBe("ERROR");
  });

  it("defaults level to ERROR when omitted", async () => {
    const res = await request(app).post("/logs").send({ source: "ANDROID", message: "no level given" });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    const row = await prisma.appEventLog.findUnique({ where: { id: res.body.id } });
    expect(row?.level).toBe("ERROR");
  });

  it("admin can list logs filtered by source and feature", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const marker = `test-feature-${Date.now()}`;
    const created = await request(app)
      .post("/logs")
      .send({ source: "ANDROID", level: "WARN", feature: marker, message: "filter test row" });
    createdIds.push(created.body.id);

    const res = await request(app).get(`/logs?source=ANDROID&feature=${marker}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Response is now { logs, total, limit, offset } (paged) rather than a bare array.
    expect(res.body.logs.length).toBe(1);
    expect(res.body.logs[0].feature).toBe(marker);
    expect(res.body.total).toBe(1);
  });

  it("large metadata is truncated, not rejected, and q filters by message substring", async () => {
    const token = await adminToken();
    if (!token) return;

    const marker = `meta-cap-${Date.now()}`;
    const huge = "x".repeat(40_000);
    const created = await request(app)
      .post("/logs")
      .send({ source: "ANDROID", feature: marker, message: `metadata cap ${marker}`, metadata: { blob: huge } });
    expect(created.status).toBe(201);
    createdIds.push(created.body.id);

    const row = await prisma.appEventLog.findUnique({ where: { id: created.body.id } });
    expect((row?.metadata as any)?._truncated).toBe(true);

    const res = await request(app).get(`/logs?q=${marker}`).set("Authorization", `Bearer ${token}`);
    expect(res.body.logs.length).toBe(1);
    expect(res.body.logs[0].id).toBe(created.body.id);
  });
});
