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

describe("Financial Review (/insights/review)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("requires a token", async () => {
    expect((await request(app).get("/insights/review")).status).toBe(401);
  });

  it("is PRO-gated (403 for a non-PRO account)", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app).get("/insights/review").query({ period: "month" }).set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(403);
  });

  it("returns hasData:false and no 500 for a PRO account with no transactions", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.userId);
    const res = await request(app).get("/insights/review").query({ period: "month" }).set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(false);
    expect(res.body.income).toBe(0);
    expect(res.body.savingsRatePct).toBeNull();
  });

  it("computes income / spend / saved / savings-rate and a grade for a seeded month", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.userId);
    const anchor = new Date(Date.UTC(2026, 6, 15)); // July 2026
    const mk = (amount: number, category: string, day: number, merchant = "M") =>
      prisma.smsTransaction.create({
        data: { userId: user.userId, rawSmsHash: `r-${category}-${day}-${Math.random()}`, amount, category, merchant, txnDate: new Date(Date.UTC(2026, 6, day)) },
      });
    await Promise.all([
      mk(100000, "income", 1),
      mk(20000, "rent", 2),
      mk(8000, "groceries", 3),
      mk(12000, "dining", 4, "Restaurant"),
      mk(5000, "shopping", 5),
    ]);

    const res = await request(app)
      .get("/insights/review")
      .query({ period: "month", anchor: anchor.toISOString() })
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.income).toBe(100000);
    expect(res.body.spend).toBe(45000);
    expect(res.body.saved).toBe(55000);
    expect(res.body.savingsRatePct).toBe(55);
    expect(res.body.topCategories[0].category).toBe("rent");
    expect(res.body.biggestExpenses[0].amount).toBe(20000);
    expect(["A", "B", "C", "D", "F"]).toContain(res.body.grade);
    expect(res.body.label).toContain("2026");
  });

  it("narrative endpoint is PRO-gated", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/insights/review/narrative")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ review: { label: "July 2026", income: 1, spend: 1, saved: 0, grade: "C" } });
    expect(res.status).toBe(403);
  });
});
