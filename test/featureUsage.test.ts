import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

describe("Feature usage (/feature-usage)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.featureUsageEvent.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("rejects an unauthenticated event post", async () => {
    const res = await request(app).post("/feature-usage").send({ screen: "dashboard" });
    expect(res.status).toBe(401);
  });

  it("rejects a missing screen", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app).post("/feature-usage").set("Authorization", `Bearer ${user.token}`).send({});
    expect(res.status).toBe(400);
  });

  it("records a screen visit, scoped to the caller's own userId", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/feature-usage")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ screen: "insights", action: "export_csv" });
    expect(res.status).toBe(201);
  });

  it("GET /summary requires admin", async () => {
    const res = await request(app).get("/feature-usage/summary");
    expect(res.status).toBe(401);
  });

  it("admin summary ranks screens by event count and counts distinct users", async () => {
    const token = await adminToken();
    if (!token) return;

    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    // insights visited twice by userA, once by userB -> 3 events, 2 distinct users
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${userA.token}`).send({ screen: "insights" });
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${userA.token}`).send({ screen: "insights" });
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${userB.token}`).send({ screen: "insights" });
    // wallet visited once
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${userA.token}`).send({ screen: "wallet" });

    const summary = await request(app).get("/feature-usage/summary").set("Authorization", `Bearer ${token}`);
    expect(summary.status).toBe(200);
    const insightsRow = summary.body.screens.find((s: any) => s.screen === "insights");
    const walletRow = summary.body.screens.find((s: any) => s.screen === "wallet");
    expect(insightsRow.events).toBeGreaterThanOrEqual(3);
    expect(insightsRow.distinctUsers).toBeGreaterThanOrEqual(2);
    expect(walletRow.events).toBeGreaterThanOrEqual(1);
    // ranked most-to-least used
    expect(summary.body.screens[0].events).toBeGreaterThanOrEqual(summary.body.screens[summary.body.screens.length - 1].events);
    expect(Array.isArray(summary.body.daily)).toBe(true);
  });

  it("admin summary respects since/until filters", async () => {
    const token = await adminToken();
    if (!token) return;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .get("/feature-usage/summary")
      .query({ since: future })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalEvents).toBe(0);
  });

  it("GET /by-user requires admin", async () => {
    const res = await request(app).get("/feature-usage/by-user");
    expect(res.status).toBe(401);
  });

  it("admin by-user returns the real userId enriched with sign-in method + counts", async () => {
    const token = await adminToken();
    if (!token) return;

    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${user.token}`).send({ screen: "insights" });
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${user.token}`).send({ screen: "insights" });
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${user.token}`).send({ screen: "wallet" });

    const res = await request(app).get("/feature-usage/by-user").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const row = res.body.users.find((u: any) => u.userId === user.userId);
    expect(row).toBeTruthy();
    expect(row.totalEvents).toBeGreaterThanOrEqual(3);
    expect(row.distinctScreens).toBeGreaterThanOrEqual(2);
    expect(row.topScreen).toBe("insights");
    expect(row.signInMethod).toBe("Anonymous");
    expect(row).toHaveProperty("primaryDevice");
    expect(row).toHaveProperty("isPro", false);
  });

  it("admin by-user honours sort + provider filter", async () => {
    const token = await adminToken();
    if (!token) return;
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${user.token}`).send({ screen: "dashboard" });

    const asc = await request(app)
      .get("/feature-usage/by-user")
      .query({ sort: "events", order: "asc", provider: "anonymous" })
      .set("Authorization", `Bearer ${token}`);
    expect(asc.status).toBe(200);
    expect(asc.body.users.every((u: any) => u.authProvider === "anonymous")).toBe(true);
    const counts = asc.body.users.map((u: any) => u.totalEvents);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it("GET /events requires admin, paginates, and joins the user", async () => {
    const unauth = await request(app).get("/feature-usage/events");
    expect(unauth.status).toBe(401);

    const token = await adminToken();
    if (!token) return;
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${user.token}`).send({ screen: "cards", action: "open" });

    const res = await request(app)
      .get("/feature-usage/events")
      .query({ userId: user.userId, limit: 5 })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.events[0]).toHaveProperty("screen", "cards");
    expect(res.body.events[0]).toHaveProperty("signInMethod", "Anonymous");
  });

  it("GET /user/:userId returns profile, devices, breakdown and timeline", async () => {
    const token = await adminToken();
    if (!token) return;
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${user.token}`).send({ screen: "networth" });
    await request(app).post("/feature-usage").set("Authorization", `Bearer ${user.token}`).send({ screen: "networth" });

    const res = await request(app).get(`/feature-usage/user/${user.userId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.userId);
    expect(Array.isArray(res.body.devices)).toBe(true);
    expect(res.body.totalEvents).toBeGreaterThanOrEqual(2);
    expect(res.body.screenBreakdown.find((s: any) => s.screen === "networth").count).toBeGreaterThanOrEqual(2);
    expect(res.body.timeline.length).toBeGreaterThanOrEqual(2);

    const missing = await request(app).get("/feature-usage/user/nope-not-real").set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });

  it("GET /auth-funnel requires admin and degrades cleanly", async () => {
    const unauth = await request(app).get("/feature-usage/auth-funnel");
    expect(unauth.status).toBe(401);

    const token = await adminToken();
    if (!token) return;
    const res = await request(app).get("/feature-usage/auth-funnel").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.byProvider)).toBe(true);
    expect(Array.isArray(res.body.byMethod)).toBe(true);
    expect(Array.isArray(res.body.loginActions)).toBe(true);

    // Future-only window -> no signups, no login actions, still 200 + arrays.
    const future = new Date(Date.now() + 86400_000).toISOString();
    const empty = await request(app).get("/feature-usage/auth-funnel").query({ since: future }).set("Authorization", `Bearer ${token}`);
    expect(empty.status).toBe(200);
    expect(empty.body.signupsByDay).toEqual([]);
    expect(empty.body.loginActions).toEqual([]);
  });
});
