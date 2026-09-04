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

describe("Tax nudges (/tax)", () => {
  const createdUserIds: string[] = [];
  const originalCode = process.env.PRO_TEST_REDEEM_CODE;

  beforeAll(() => {
    process.env.PRO_TEST_REDEEM_CODE = "TEST-CODE-TAX";
  });

  afterAll(async () => {
    process.env.PRO_TEST_REDEEM_CODE = originalCode;
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("auto-tags a hospital spend as 80D_MEDICAL, distinct from an insurance premium's 80D", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const fy = "2026-27";
    const txnDate = new Date(Date.UTC(2026, 6, 15)); // July 2026, within FY 2026-27

    await prisma.smsTransaction.create({
      data: { userId: user.userId, rawSmsHash: `hosp-${Date.now()}`, amount: 25500, merchant: "Apollo Hospital", txnDate, category: "medical" },
    });
    await prisma.smsTransaction.create({
      data: { userId: user.userId, rawSmsHash: `ins-${Date.now()}`, amount: 18000, merchant: "Star Health Insurance", txnDate, category: "insurance" },
    });

    const res = await request(app).get(`/tax/status?financialYear=${fy}`).set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.section80D.spent).toBe(18000);
    expect(res.body.section80DMedical.spent).toBe(25500);
    expect(res.body.section80DMedical.caveat).toBeTruthy();
    expect(res.body.section80DMedical.limit).toBe(5000); // the narrow preventive-checkup sub-limit, not the main 25000 cap

    const hospitalRow = res.body.matchedTransactions.find((t: any) => t.merchant === "Apollo Hospital");
    expect(hospitalRow.section).toBe("80D_MEDICAL");
  });

  it("GET /export returns a CSV with the matched transactions", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const fy = "2026-27";
    const txnDate = new Date(Date.UTC(2026, 6, 15));
    await prisma.smsTransaction.create({
      data: { userId: user.userId, rawSmsHash: `elss-${Date.now()}`, amount: 5000, merchant: "HDFC ELSS SIP", txnDate, category: "investment" },
    });

    const res = await request(app).get(`/tax/export?financialYear=${fy}`).set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("HDFC ELSS SIP");
    expect(res.text.split("\n")[0]).toBe("Date,Merchant,Amount (INR),Section,Auto-matched");
  });

  it("a user manually overriding a transaction to 80D_MEDICAL is accepted and reflected as not auto-matched", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const txn = await prisma.smsTransaction.create({
      data: {
        userId: user.userId,
        rawSmsHash: `override-${Date.now()}`,
        amount: 2000,
        merchant: "Local Pharmacy",
        category: "medical",
        txnDate: new Date(Date.UTC(2026, 6, 1)),
      },
    });

    const patchRes = await request(app)
      .patch(`/sms/transactions/${txn.id}/tax-section`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ taxSection: "80D_MEDICAL" });
    expect(patchRes.status).toBe(200);

    const res = await request(app).get("/tax/status?financialYear=2026-27").set("Authorization", `Bearer ${user.token}`);
    const row = res.body.matchedTransactions.find((t: any) => t.id === txn.id);
    expect(row.section).toBe("80D_MEDICAL");
    expect(row.autoMatched).toBe(false);
  });
});
