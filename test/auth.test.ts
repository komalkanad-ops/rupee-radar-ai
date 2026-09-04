import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

describe("POST /auth/session", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("creates a User row for a brand-new anonymous device and returns a usable token", async () => {
    const deviceId = `auth-test-${Date.now()}`;
    const res = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(deviceId);
    expect(typeof res.body.token).toBe("string");
    createdUserIds.push(deviceId);

    const user = await prisma.user.findUnique({ where: { id: deviceId } });
    expect(user).not.toBeNull();
    expect(user?.authProvider).toBe("anonymous");
  });

  it("re-using the same deviceId returns the same userId (idempotent upsert, not a duplicate)", async () => {
    const deviceId = `auth-test-repeat-${Date.now()}`;
    const first = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    const second = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    createdUserIds.push(deviceId);

    expect(first.body.userId).toBe(second.body.userId);
    const count = await prisma.user.count({ where: { id: deviceId } });
    expect(count).toBe(1);
  });

  it("rejects an unrecognized provider", async () => {
    const res = await request(app).post("/auth/session").send({ provider: "bogus" });
    expect(res.status).toBe(400);
  });

  it("rejects an anonymous session request with no deviceId", async () => {
    const res = await request(app).post("/auth/session").send({ provider: "anonymous" });
    expect(res.status).toBe(400);
  });

  it("GET /auth/me requires a token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /auth/me returns the profile for a valid anonymous token", async () => {
    const deviceId = `auth-test-me-${Date.now()}`;
    const session = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    createdUserIds.push(deviceId);

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${session.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(deviceId);
    expect(res.body.authProvider).toBe("anonymous");
  });

  it("PATCH /auth/me sets name/email/gender — the phone-login profile-completion fields", async () => {
    const deviceId = `auth-test-patch-${Date.now()}`;
    const session = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    createdUserIds.push(deviceId);

    const res = await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${session.body.token}`)
      .send({ name: "Priya Sharma", email: `priya-${deviceId}@example.com`, gender: "FEMALE" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Priya Sharma");
    expect(res.body.email).toBe(`priya-${deviceId}@example.com`);
    expect(res.body.gender).toBe("FEMALE");

    const getRes = await request(app).get("/auth/me").set("Authorization", `Bearer ${session.body.token}`);
    expect(getRes.body.gender).toBe("FEMALE");
  });

  it("PATCH /auth/me rejects an email already linked to a different account", async () => {
    const deviceIdA = `auth-test-conflict-a-${Date.now()}`;
    const deviceIdB = `auth-test-conflict-b-${Date.now()}`;
    const sessionA = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId: deviceIdA });
    const sessionB = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId: deviceIdB });
    createdUserIds.push(deviceIdA, deviceIdB);

    const sharedEmail = `shared-${deviceIdA}@example.com`;
    await request(app).patch("/auth/me").set("Authorization", `Bearer ${sessionA.body.token}`).send({ email: sharedEmail });
    const res = await request(app).patch("/auth/me").set("Authorization", `Bearer ${sessionB.body.token}`).send({ email: sharedEmail });
    expect(res.status).toBe(409);
  });

  it("PATCH /auth/me round-trips serviceOrder and quickActionRoutes as real arrays", async () => {
    const deviceId = `auth-test-arrange-${Date.now()}`;
    const session = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    createdUserIds.push(deviceId);

    const order = ["cards", "expenses", "loans", "insights"];
    const quickActions = ["expenses", "loans"];
    const patched = await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${session.body.token}`)
      .send({ serviceOrder: order, quickActionRoutes: quickActions });
    expect(patched.status).toBe(200);
    expect(patched.body.serviceOrder).toEqual(order);
    expect(patched.body.quickActionRoutes).toEqual(quickActions);

    const getRes = await request(app).get("/auth/me").set("Authorization", `Bearer ${session.body.token}`);
    expect(getRes.body.serviceOrder).toEqual(order);
    expect(getRes.body.quickActionRoutes).toEqual(quickActions);
  });

  it("GET /auth/me returns null serviceOrder/quickActionRoutes before either is ever set", async () => {
    const deviceId = `auth-test-arrange-unset-${Date.now()}`;
    const session = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    createdUserIds.push(deviceId);

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${session.body.token}`);
    expect(res.body.serviceOrder).toBeNull();
    expect(res.body.quickActionRoutes).toBeNull();
  });

  it("PATCH /auth/me rejects more than 4 quickActionRoutes", async () => {
    const deviceId = `auth-test-arrange-toomany-${Date.now()}`;
    const session = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    createdUserIds.push(deviceId);

    const res = await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${session.body.token}`)
      .send({ quickActionRoutes: ["a", "b", "c", "d", "e"] });
    expect(res.status).toBe(400);
  });
});
