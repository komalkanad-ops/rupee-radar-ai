import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// Regression test for the admin-authentication bypass found in the 2026-09-03 audit.
//
// User session tokens and admin session tokens are signed with the SAME `JWT_SECRET`, so signature
// validity alone says nothing about which family a token belongs to. `requireAdmin` used to do
// nothing but `jwt.verify`, which meant ANY signed-in app user's token — including one from the
// anonymous device-id path, obtainable with no account at all — was accepted as an admin on every
// `requireAdmin` route. `requireRole` was worse: a user token carries no `role` claim, so its
// `payload.role ?? "SUPER_ADMIN"` fallback promoted it past every role gate.
//
// The whole 325-test suite stayed green through this because `adminRbac.test.ts` only ever presents
// *admin* tokens to admin routes — it asserted the positive direction and never the negative one.
// These tests assert the negative direction: a user token must be REJECTED everywhere an admin
// token is required.
describe("admin routes reject user session tokens", () => {
  const deviceId = `token-isolation-${Date.now()}`;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: deviceId } });
  });

  async function anonymousUserToken(): Promise<string> {
    const res = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    return res.body.token;
  }

  it("a user token is a valid user token (guards against the test passing for the wrong reason)", async () => {
    const token = await anonymousUserToken();
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("a user token cannot read the user roster via requireAdmin", async () => {
    const token = await anonymousUserToken();
    const res = await request(app).get("/users").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("a user token cannot reach a requireRole SUPER_ADMIN route via the missing-role fallback", async () => {
    const token = await anonymousUserToken();
    const res = await request(app).get("/auth/admin/admins").set("Authorization", `Bearer ${token}`);
    expect([401, 403]).toContain(res.status);
  });

  it("a user token cannot grant itself PRO through the admin billing route", async () => {
    const token = await anonymousUserToken();
    const res = await request(app)
      .post("/billing/admin/grant")
      .set("Authorization", `Bearer ${token}`)
      .send({ userId: deviceId, months: 12 });
    expect([401, 403]).toContain(res.status);

    const status = await request(app).get("/billing/status").set("Authorization", `Bearer ${token}`);
    expect(status.body?.isPro).not.toBe(true);
  });

  it("a user token cannot broadcast a push notification", async () => {
    const token = await anonymousUserToken();
    const res = await request(app)
      .post("/push/broadcast")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "should never send", body: "should never send" });
    expect([401, 403]).toContain(res.status);
  });

  it("the statement analyzer is no longer an unauthenticated 15MB upload", async () => {
    const res = await request(app)
      .post("/statements/analyze")
      .attach("file", Buffer.from("date,description,amount\n2026-01-01,Test,100"), "s.csv");
    expect(res.status).toBe(401);
  });
});
