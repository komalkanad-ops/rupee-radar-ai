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
