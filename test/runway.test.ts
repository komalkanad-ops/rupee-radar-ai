import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

async function grantPro(token: string) {
  await request(app)
    .post("/billing/redeem-test-code")
    .set("Authorization", `Bearer ${token}`)
    .send({ code: process.env.PRO_TEST_REDEEM_CODE ?? "" });
}

describe("GET /networth/runway", () => {
  const createdUserIds: string[] = [];
  const originalCode = process.env.PRO_TEST_REDEEM_CODE;

  beforeAll(() => {
    process.env.PRO_TEST_REDEEM_CODE = "TEST-CODE-RUNWAY";
  });

  afterAll(async () => {
    process.env.PRO_TEST_REDEEM_CODE = originalCode;
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.netWorthSnapshot.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("includes a real trailing-3-month avgMonthlyIncomeInr for the Dynamic Shock Simulator", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    await prisma.netWorthSnapshot.create({
      data: {
        userId: user.userId,
        month: new Date(Date.UTC(2026, 7, 1)),
        assets: { cash: 100000, bank: 200000 },
        liabilities: {},
        totalNetWorth: 300000,
      },
    });

    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    await prisma.smsTransaction.create({
      data: { userId: user.userId, rawSmsHash: `income-${Date.now()}`, amount: 90000, category: "income", txnDate: twoMonthsAgo },
    });

    const res = await request(app).get("/networth/runway").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.avgMonthlyIncomeInr).toBe(30000); // 90000 spread over the 3-month trailing window
  });
});
