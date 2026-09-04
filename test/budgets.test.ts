import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Budgets (/budgets) + budget-status integration", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.budget.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("requires a token", async () => {
    expect((await request(app).get("/budgets")).status).toBe(401);
  });

  it("upserts a budget, lists it, and 0 deletes it", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };

    const put = await request(app).put("/budgets/dining").set(auth).send({ monthlyLimitInr: 4000 });
    expect(put.status).toBe(200);
    expect(put.body.monthlyLimitInr).toBe(4000);

    // update
    await request(app).put("/budgets/dining").set(auth).send({ monthlyLimitInr: 5000 });
    const list = await request(app).get("/budgets").set(auth);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].monthlyLimitInr).toBe(5000);

    const zero = await request(app).put("/budgets/dining").set(auth).send({ monthlyLimitInr: 0 });
    expect(zero.body.deleted).toBe(true);
    expect((await request(app).get("/budgets").set(auth)).body).toHaveLength(0);
  });

  it("budget-status uses the user's budget when set, else the 3-month average", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    await prisma.smsTransaction.create({
      data: {
        userId: user.userId, rawSmsHash: `b-${Date.now()}`, amount: 3000, category: "dining",
        merchant: "Test", txnDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5)),
      },
    });
    await request(app).put("/budgets/dining").set(auth).send({ monthlyLimitInr: 2000 });

    const res = await request(app).get("/insights/budget-status").query({ month }).set(auth);
    expect(res.status).toBe(200);
    const dining = res.body.find((r: any) => r.category === "dining");
    expect(dining.budget).toBe(2000);
    expect(dining.source).toBe("user");
    expect(dining.overBudget).toBe(true);
  });

  it("budget-status excludes income / transfer / savings (not spend you budget)", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const day = (d: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d));

    await prisma.smsTransaction.createMany({
      data: [
        { userId: user.userId, rawSmsHash: `ns-g-${Date.now()}`, amount: 2000, category: "groceries", txnDate: day(3) },
        { userId: user.userId, rawSmsHash: `ns-i-${Date.now()}`, amount: 80000, category: "income", txnDate: day(1) },
        { userId: user.userId, rawSmsHash: `ns-t-${Date.now()}`, amount: 15000, category: "transfer", txnDate: day(2) },
        { userId: user.userId, rawSmsHash: `ns-s-${Date.now()}`, amount: 10000, category: "savings", txnDate: day(4) },
      ],
    });

    const res = await request(app).get("/insights/budget-status").query({ month }).set(auth);
    expect(res.status).toBe(200);
    const categories = res.body.map((r: any) => r.category);
    expect(categories).toContain("groceries");
    expect(categories).not.toContain("income");
    expect(categories).not.toContain("transfer");
    expect(categories).not.toContain("savings");
  });
});
