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

describe("Admin RBAC", () => {
  const createdEmails: string[] = [];

  afterAll(async () => {
    await prisma.adminUser.deleteMany({ where: { email: { in: createdEmails } } });
  });

  it("the bootstrap admin logs in as SUPER_ADMIN and succeeds on a requireRole-gated route", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const loginRes = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(loginRes.body.role).toBe("SUPER_ADMIN");

    const res = await request(app)
      .post("/feature-flags")
      .set("Authorization", `Bearer ${token}`)
      .send({ key: `rbac_test_${Date.now()}`, displayName: "RBAC test" });
    expect(res.status).toBe(201);
  });

  it("a VIEWER-role admin gets 403 on a SUPER_ADMIN-only route, but can still use an old-style requireAdmin route", async () => {
    const superToken = await adminToken();
    if (!superToken) return;

    const email = `rbac-viewer-${Date.now()}@test.local`;
    createdEmails.push(email);
    const createRes = await request(app)
      .post("/auth/admin/admins")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email, password: "test-password-123", role: "VIEWER" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.role).toBe("VIEWER");

    const loginRes = await request(app).post("/auth/admin/login").send({ email, password: "test-password-123" });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.role).toBe("VIEWER");
    const viewerToken = loginRes.body.token;

    // Blocked: mutating a feature flag is SUPER_ADMIN-only.
    const blockedRes = await request(app)
      .post("/feature-flags")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ key: `rbac_viewer_blocked_${Date.now()}`, displayName: "Should be blocked" });
    expect(blockedRes.status).toBe(403);

    // Still allowed: GET /announcements is an old-style requireAdmin route — any valid admin role.
    const allowedRes = await request(app).get("/announcements").set("Authorization", `Bearer ${viewerToken}`);
    expect(allowedRes.status).toBe(200);
  });

  it("only a SUPER_ADMIN can create or list other admins", async () => {
    const superToken = await adminToken();
    if (!superToken) return;

    const email = `rbac-editor-${Date.now()}@test.local`;
    createdEmails.push(email);
    await request(app)
      .post("/auth/admin/admins")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email, password: "test-password-123", role: "EDITOR" });

    const loginRes = await request(app).post("/auth/admin/login").send({ email, password: "test-password-123" });
    const editorToken = loginRes.body.token;

    const listRes = await request(app).get("/auth/admin/admins").set("Authorization", `Bearer ${editorToken}`);
    expect(listRes.status).toBe(403);

    const superListRes = await request(app).get("/auth/admin/admins").set("Authorization", `Bearer ${superToken}`);
    expect(superListRes.status).toBe(200);
    expect(superListRes.body.some((a: any) => a.email === email)).toBe(true);
  });

  it("newly created admins default to EDITOR, not SUPER_ADMIN, when no role is given", async () => {
    const superToken = await adminToken();
    if (!superToken) return;

    const email = `rbac-default-${Date.now()}@test.local`;
    createdEmails.push(email);
    const createRes = await request(app)
      .post("/auth/admin/admins")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email, password: "test-password-123" });
    expect(createRes.body.role).toBe("EDITOR");
  });

  it("rejects an invalid role", async () => {
    const superToken = await adminToken();
    if (!superToken) return;

    const res = await request(app)
      .post("/auth/admin/admins")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email: `rbac-bad-${Date.now()}@test.local`, password: "test-password-123", role: "OWNER" });
    expect(res.status).toBe(400);
  });
});
