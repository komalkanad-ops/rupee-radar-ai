import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("billing / PRO entitlement", () => {
  const createdUserIds: string[] = [];
  const originalCode = process.env.PRO_TEST_REDEEM_CODE;

  beforeAll(() => {
    process.env.PRO_TEST_REDEEM_CODE = "TEST-CODE-123";
  });
  afterAll(async () => {
    process.env.PRO_TEST_REDEEM_CODE = originalCode;
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("a fresh user is not PRO", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app).get("/billing/status").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.isPro).toBe(false);
  });

  it("rejects an incorrect redeem code", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/billing/redeem-test-code")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "wrong-code" });
    expect(res.status).toBe(403);
  });

  it("grants PRO on the correct redeem code, reflected immediately in /status", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const redeemRes = await request(app)
      .post("/billing/redeem-test-code")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "TEST-CODE-123" });
    expect(redeemRes.status).toBe(200);
    expect(redeemRes.body.status).toBe("active");

    const statusRes = await request(app).get("/billing/status").set("Authorization", `Bearer ${user.token}`);
    expect(statusRes.body.isPro).toBe(true);
  });

  it("one user redeeming a code never grants PRO to another user", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    await request(app)
      .post("/billing/redeem-test-code")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ code: "TEST-CODE-123" });

    const statusB = await request(app).get("/billing/status").set("Authorization", `Bearer ${userB.token}`);
    expect(statusB.body.isPro).toBe(false);
  });

  it("PRO-gated endpoints reject a non-PRO user with proRequired", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/insights/narrative")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ prompt: "test" });
    expect(res.status).toBe(403);
    expect(res.body.proRequired).toBe(true);
  });

  it.each([
    ["GET", "/cashflow/calendar?month=2026-09"],
    ["GET", "/tax/status"],
    ["GET", "/household"],
    ["GET", "/offers"],
  ])("newly-gated Phase 2 route %s %s rejects a non-PRO user", async (method, path) => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      [method.toLowerCase() as "get"](path)
      .set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(403);
    expect(res.body.proRequired).toBe(true);
  });

  it("/billing/verify rejects an unknown productId before touching Google Play", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/billing/verify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ purchaseToken: "tok", productId: "not_a_real_product" });
    expect(res.status).toBe(400);
  });

  it("/billing/verify 501s when Play Console credentials aren't configured", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/billing/verify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ purchaseToken: "tok", productId: "pro_monthly" });
    expect(res.status).toBe(501);
  });
});

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

describe("shared trial promo code", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.trialPromoCode.deleteMany({ where: { id: "singleton" } });
  });

  it("status reports unavailable before any code is configured", async () => {
    await prisma.trialPromoCode.deleteMany({ where: { id: "singleton" } });
    const res = await request(app).get("/billing/trial-code/status");
    expect(res.body.available).toBe(false);
  });

  it("admin can set the code (normalized) and turn it on", async () => {
    const token = await adminToken();
    const res = await request(app)
      .put("/billing/admin/trial-code")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "  rradar-trial  ", active: true });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe("RRADAR-TRIAL");
    expect(res.body.active).toBe(true);

    const status = await request(app).get("/billing/trial-code/status");
    expect(status.body.available).toBe(true);
  });

  it("rejects a wrong code without touching entitlement", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/billing/redeem-trial-code")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "wrong" });
    expect(res.status).toBe(403);
  });

  it("redeems the code (case/whitespace-insensitive), grants ~1 day of PRO, then blocks a second redemption by the same account", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const first = await request(app)
      .post("/billing/redeem-trial-code")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: " rradar-trial " });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("active");
    const expiryMs = new Date(first.body.expiryAt).getTime() - Date.now();
    expect(expiryMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(expiryMs).toBeLessThan(25 * 60 * 60 * 1000);

    const statusRes = await request(app).get("/billing/status").set("Authorization", `Bearer ${user.token}`);
    expect(statusRes.body.isPro).toBe(true);

    const second = await request(app)
      .post("/billing/redeem-trial-code")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "RRADAR-TRIAL" });
    expect(second.status).toBe(409);
  });

  it("rejects concurrent double-redemption from the same fresh account (only one succeeds)", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const [a, b] = await Promise.all([
      request(app).post("/billing/redeem-trial-code").set("Authorization", `Bearer ${user.token}`).send({ code: "RRADAR-TRIAL" }),
      request(app).post("/billing/redeem-trial-code").set("Authorization", `Bearer ${user.token}`).send({ code: "RRADAR-TRIAL" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("does not let the trial shorten an already-active subscription", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await prisma.proEntitlement.create({
      data: { userId: user.userId, productId: "pro_yearly", status: "active", expiryAt: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000) },
    });

    const res = await request(app)
      .post("/billing/redeem-trial-code")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "RRADAR-TRIAL" });
    expect(res.status).toBe(409);

    const entitlement = await prisma.proEntitlement.findUnique({ where: { userId: user.userId } });
    expect(entitlement!.productId).toBe("pro_yearly");
  });

  it("admin can turn the code off, and redemption then 501s", async () => {
    const token = await adminToken();
    await request(app).put("/billing/admin/trial-code").set("Authorization", `Bearer ${token}`).send({ active: false });

    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/billing/redeem-trial-code")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "RRADAR-TRIAL" });
    expect(res.status).toBe(501);
  });
});

describe("Profile ageGroup", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("accepts a valid bucket and rejects a free-text value", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const bad = await request(app).patch("/auth/me").set("Authorization", `Bearer ${user.token}`).send({ ageGroup: "25" });
    expect(bad.status).toBe(400);

    const good = await request(app).patch("/auth/me").set("Authorization", `Bearer ${user.token}`).send({ ageGroup: "25-34" });
    expect(good.status).toBe(200);
    expect(good.body.ageGroup).toBe("25-34");

    const cleared = await request(app).patch("/auth/me").set("Authorization", `Bearer ${user.token}`).send({ ageGroup: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.ageGroup).toBeNull();
  });
});
