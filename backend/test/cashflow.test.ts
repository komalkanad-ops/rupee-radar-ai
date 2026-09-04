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

describe("GET /cashflow/calendar", () => {
  const createdUserIds: string[] = [];
  const originalCode = process.env.PRO_TEST_REDEEM_CODE;

  beforeAll(() => {
    process.env.PRO_TEST_REDEEM_CODE = "TEST-CODE-CASHFLOW";
  });
  afterAll(async () => {
    process.env.PRO_TEST_REDEEM_CODE = originalCode;
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.recurringPayment.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.loan.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.netWorthSnapshot.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("PRO-gates the calendar", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app).get("/cashflow/calendar?month=2027-03").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(403);
  });

  it("projects starting balance (with a cash/bank breakdown), salary, a recurring bill, and an active loan EMI — every figure traceable to real stored data", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    await prisma.user.update({ where: { id: user.userId }, data: { salaryDayOfMonth: 1 } });
    await prisma.netWorthSnapshot.create({
      data: {
        userId: user.userId,
        month: new Date(Date.UTC(2027, 1, 1)),
        assets: { cash: 20000, bank: 80000 },
        liabilities: {},
        totalNetWorth: 100000,
        monthlyIncomeInr: 60000,
      },
    });
    await prisma.recurringPayment.create({
      data: {
        userId: user.userId,
        type: "SUBSCRIPTION",
        name: "Netflix",
        amount: 500,
        frequency: "monthly",
        nextDueDate: new Date(Date.UTC(2027, 2, 10)),
        active: true,
      },
    });
    await prisma.loan.create({
      data: {
        userId: user.userId,
        type: "CAR",
        bankName: "HDFC Bank",
        principal: 500000,
        roiAnnualPct: 9,
        startDate: new Date(Date.UTC(2027, 0, 15)), // well within tenure by March 2027
        tenureMonths: 60,
        emiAmount: 10380,
      },
    });

    const res = await request(app).get("/cashflow/calendar?month=2027-03").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.startingBalance).toBe(100000);
    expect(res.body.cashBalance).toBe(20000);
    expect(res.body.bankBalance).toBe(80000);
    expect(res.body.monthlyIncome).toBe(60000);
    expect(res.body.salaryDayOfMonth).toBe(1);
    expect(res.body.recurringBillCount).toBe(1);
    expect(res.body.loanEmiCount).toBe(1);

    const day1 = res.body.days.find((d: any) => d.day === 1);
    expect(day1.events).toContainEqual({ name: "Salary", amount: 60000, type: "income" });
    expect(day1.projectedBalance).toBe(160000);

    const day10 = res.body.days.find((d: any) => d.day === 10);
    expect(day10.events).toContainEqual({ name: "Netflix", amount: 500, type: "expense" });

    const day15 = res.body.days.find((d: any) => d.day === 15);
    expect(day15.events).toContainEqual({ name: "HDFC Bank CAR EMI", amount: 10380, type: "expense" });
  });

  it("excludes a loan that's already fully closed before the projected month", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    // 12-month tenure starting Jan 2020 closes Jan 2021 — long done by March 2027.
    await prisma.loan.create({
      data: {
        userId: user.userId,
        type: "PERSONAL",
        bankName: "ICICI Bank",
        principal: 100000,
        roiAnnualPct: 12,
        startDate: new Date(Date.UTC(2020, 0, 15)),
        tenureMonths: 12,
        emiAmount: 8885,
      },
    });

    const res = await request(app).get("/cashflow/calendar?month=2027-03").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.loanEmiCount).toBe(0);
    const day15 = res.body.days.find((d: any) => d.day === 15);
    expect(day15.events).toHaveLength(0);
  });
});
