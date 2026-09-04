import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

// Verifies the actual money-math in the health score formula (documented weights: 40% savings
// rate, 20% budget adherence, 20% bill diligence, 20% diversification), not just that the endpoint
// returns 200.
describe("GET /health-score", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.healthScoreSnapshot.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.recurringPayment.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.netWorthSnapshot.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("scores a brand-new user with no data as the documented neutral baseline", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app).get("/health-score").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    // No income/expense history -> savings score defaults to neutral 50, not a penalized 0.
    expect(res.body.breakdown.savingsScore).toBe(50);
    expect(res.body.breakdown.savingsHasData).toBe(false);
    // No transaction history -> budget adherence defaults to neutral 50, not a penalized 0.
    expect(res.body.breakdown.budgetAdherence).toBe(50);
    // No tracked bills -> nothing can be overdue, so this defaults to 100, not 0.
    expect(res.body.breakdown.billDiligence).toBe(100);
    // No net worth snapshot -> no asset categories to count.
    expect(res.body.breakdown.diversification).toBe(0);
    expect(res.body.score).toBe(50); // round(50*0.4 + 50*0.2 + 100*0.2 + 0*0.2)
  });

  it("earning comfortably more than you spend pulls the score above the neutral baseline", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    // Deliberately all in the current month only, so budget adherence's trailing-3-month baseline
    // stays empty (no data -> neutral 50, not evaluated) and the savings-rate math below is the only
    // thing moving the score — keeps this test's arithmetic hand-checkable end to end.
    const now = new Date();
    const inCurrentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
    await prisma.smsTransaction.createMany({
      data: [
        { userId: user.userId, rawSmsHash: "hs-income-1", amount: 90000, category: "income", txnDate: inCurrentMonth },
        { userId: user.userId, rawSmsHash: "hs-expense-1", amount: 45000, category: "shopping", txnDate: inCurrentMonth },
      ],
    });

    const res = await request(app).get("/health-score").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.breakdown.savingsHasData).toBe(true);
    expect(res.body.breakdown.avgMonthlyIncome).toBe(30000); // 90000 / 3 months
    expect(res.body.breakdown.avgMonthlyExpense).toBe(15000); // 45000 / 3 months
    expect(res.body.breakdown.savingsRatePct).toBe(50); // (90000-45000)/90000 * 100
    expect(res.body.breakdown.savingsScore).toBe(100); // clamp(50 + 50*2, 0, 100)
    // round(100*.35 + 50*.15 + 100*.15 + 0*.15 + 75*.2) — safety-net factor: EF neutral 50, DTI 0% -> 100.
    expect(res.body.score).toBe(73);
  });

  it("spending beyond your income pulls the score below the neutral baseline", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const now = new Date();
    const inCurrentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
    await prisma.smsTransaction.createMany({
      data: [
        { userId: user.userId, rawSmsHash: "hs-income-2", amount: 30000, category: "income", txnDate: inCurrentMonth },
        { userId: user.userId, rawSmsHash: "hs-expense-2", amount: 60000, category: "shopping", txnDate: inCurrentMonth },
      ],
    });

    const res = await request(app).get("/health-score").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.breakdown.avgMonthlyIncome).toBe(10000); // 30000 / 3 months
    expect(res.body.breakdown.avgMonthlyExpense).toBe(20000); // 60000 / 3 months
    expect(res.body.breakdown.savingsRatePct).toBe(-100); // (30000-60000)/30000 * 100
    expect(res.body.breakdown.savingsScore).toBe(0); // clamp(50 + -100*2, 0, 100)
    // round(0*.35 + 50*.15 + 100*.15 + 0*.15 + 75*.2) — safety-net: EF neutral 50, DTI 0% -> 100.
    expect(res.body.score).toBe(38);
  });

  it("diversification reflects distinct positive asset categories on the latest net worth snapshot", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await prisma.netWorthSnapshot.create({
      data: {
        userId: user.userId,
        month: new Date(Date.UTC(2026, 0, 1)),
        assets: { cash: 10000, bank: 50000, investments: 20000 }, // 3 distinct positive categories
        liabilities: {},
        totalNetWorth: 80000,
      },
    });

    const res = await request(app).get("/health-score").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.breakdown.diversification).toBe(60); // round(3 / 5 * 100)
  });

  it("a zero-value asset category doesn't count toward diversification", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await prisma.netWorthSnapshot.create({
      data: {
        userId: user.userId,
        month: new Date(Date.UTC(2026, 0, 1)),
        assets: { cash: 10000, bank: 0 }, // only 1 counts
        liabilities: {},
        totalNetWorth: 10000,
      },
    });

    const res = await request(app).get("/health-score").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.breakdown.diversification).toBe(20); // round(1 / 5 * 100)
  });

  it("bill diligence drops when a tracked EMI/loan is currently overdue", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await prisma.recurringPayment.create({
      data: {
        userId: user.userId,
        type: "EMI",
        name: "Overdue car loan",
        amount: 5000,
        frequency: "monthly",
        nextDueDate: new Date(Date.now() - 5 * 86400000),
        active: true,
      },
    });

    const res = await request(app).get("/health-score").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.breakdown.billDiligence).toBe(0); // 1 of 1 tracked bills overdue
  });

  it("bill diligence stays perfect when the only tracked bill isn't due yet", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await prisma.recurringPayment.create({
      data: {
        userId: user.userId,
        type: "CREDIT_CARD_BILL",
        name: "Not due yet",
        amount: 5000,
        frequency: "monthly",
        nextDueDate: new Date(Date.now() + 10 * 86400000),
        active: true,
      },
    });

    const res = await request(app).get("/health-score").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.breakdown.billDiligence).toBe(100);
  });
});
