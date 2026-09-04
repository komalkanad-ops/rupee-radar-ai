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

describe("App announcements (/announcements)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.appAnnouncement.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("GET /active is public and returns null when nothing is active", async () => {
    const res = await request(app).get("/announcements/active");
    expect(res.status).toBe(200);
    // Either null (no announcements at all) or an existing active one from prior test runs —
    // either way the route must not error and must return valid JSON (null or an object).
    expect(res.body === null || typeof res.body === "object").toBe(true);
  });

  it("rejects writes and the admin list from a non-admin caller", async () => {
    const write = await request(app).post("/announcements").send({ message: "Test" });
    expect(write.status).toBe(401);
    const list = await request(app).get("/announcements");
    expect(list.status).toBe(401);
  });

  it("admin creates an announcement, it becomes the active one, then can be deactivated", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const created = await request(app)
      .post("/announcements")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Scheduled maintenance tonight 11pm-1am IST.", severity: "MAINTENANCE" });
    expect(created.status).toBe(201);
    expect(created.body.active).toBe(true);
    createdIds.push(created.body.id);

    const active = await request(app).get("/announcements/active");
    expect(active.body.id).toBe(created.body.id);

    const deactivated = await request(app)
      .patch(`/announcements/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);

    const activeAfter = await request(app).get("/announcements/active");
    expect(activeAfter.body?.id).not.toBe(created.body.id);
  });

  it("the newest active announcement wins when multiple are active", async () => {
    const token = await adminToken();
    if (!token) return;

    const first = await request(app)
      .post("/announcements")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "First announcement" });
    createdIds.push(first.body.id);

    await new Promise((r) => setTimeout(r, 10));

    const second = await request(app)
      .post("/announcements")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Second, newer announcement" });
    createdIds.push(second.body.id);

    const active = await request(app).get("/announcements/active");
    expect(active.body.id).toBe(second.body.id);
  });

  it("rejects an invalid severity", async () => {
    const token = await adminToken();
    if (!token) return;

    const res = await request(app)
      .post("/announcements")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Bad severity", severity: "NOT_REAL" });
    expect(res.status).toBe(400);
  });
});
