import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

async function grantPro(userId: string) {
  await prisma.proEntitlement.upsert({
    where: { userId },
    create: { userId, productId: "test", status: "active", expiryAt: new Date(Date.now() + 86400_000) },
    update: { status: "active", expiryAt: new Date(Date.now() + 86400_000) },
  });
}

describe("Safety Net + Money Leaks (/insights)", () => {
  const uids: string[] = [];
  afterAll(async () => {
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: uids } } });
    await prisma.recurringPayment.deleteMany({ where: { userId: { in: uids } } });
    await prisma.netWorthSnapshot.deleteMany({ where: { userId: { in: uids } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: uids } } });
    await prisma.user.deleteMany({ where: { id: { in: uids } } });
  });

  it("both endpoints are PRO-gated", async () => {
    const user = await createAnonymousUser();
    uids.push(user.userId);
    const h = { Authorization: `Bearer ${user.token}` };
    expect((await request(app).get("/insights/safety-net").set(h)).status).toBe(403);
    expect((await request(app).get("/insights/leaks").set(h)).status).toBe(403);
  });

  it("safety-net computes savings rate, emergency-fund months and DTI", async () => {
    const user = await createAnonymousUser();
    uids.push(user.userId);
    await grantPro(user.userId);
    const h = { Authorization: `Bearer ${user.token}` };
    const now = new Date();
    const mk = (amount: number, category: string, monthsAgo: number) =>
      prisma.smsTransaction.create({
        data: {
          userId: user.userId, rawSmsHash: `sn-${category}-${monthsAgo}-${Math.random()}`, amount, category, merchant: "M",
          txnDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 10)),
        },
      });
    await Promise.all([
      mk(90000, "income", 0), mk(90000, "income", 1), mk(90000, "income", 2),
      mk(20000, "rent", 0), mk(20000, "rent", 1), mk(20000, "rent", 2),
      mk(10000, "groceries", 0), mk(10000, "groceries", 1), mk(10000, "groceries", 2),
      mk(15000, "shopping", 0),
    ]);
    await prisma.netWorthSnapshot.create({
      data: {
        userId: user.userId, month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        assets: { cash: 50000, bank: 130000, liquidInvestments: 0 }, liabilities: {}, totalNetWorth: 180000,
      },
    });
    await prisma.recurringPayment.create({
      data: { userId: user.userId, type: "EMI", name: "Car loan", amount: 12000, frequency: "monthly", active: true },
    });

    const res = await request(app).get("/insights/safety-net").set(h);
    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(true);
    // avg monthly income 90k, avg spend (20k+10k rent/groc *3 + 15k shopping)/3 = 35k -> saved 55k -> ~61%
    expect(res.body.savings.ratePct).toBeGreaterThan(50);
    // liquid 180k / avg essential 30k = 6 months
    expect(res.body.emergencyFund.months).toBeCloseTo(6, 0);
    // 12k EMI / 90k income ~= 13%
    expect(res.body.debtToIncome.pct).toBe(13);
  });

  it("leaks: no 500 on an empty account, flags a rarely-used subscription", async () => {
    const user = await createAnonymousUser();
    uids.push(user.userId);
    await grantPro(user.userId);
    const h = { Authorization: `Bearer ${user.token}` };

    const empty = await request(app).get("/insights/leaks").set(h);
    expect(empty.status).toBe(200);
    expect(empty.body.hasData).toBe(false);
    expect(empty.body.recoverableMonthlyInr).toBe(0);

    await prisma.recurringPayment.create({
      data: { userId: user.userId, type: "SUBSCRIPTION", name: "Streaming Plus", amount: 499, frequency: "monthly", active: true, usageTag: "NEVER" },
    });
    const res = await request(app).get("/insights/leaks").set(h);
    expect(res.body.subscriptions.items.some((s: any) => s.name === "Streaming Plus" && s.flagged)).toBe(true);
    expect(res.body.subscriptions.recoverableMonthlyInr).toBe(499);
    expect(res.body.recoverableMonthlyInr).toBeGreaterThanOrEqual(499);
  });
});
