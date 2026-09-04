import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("GET /sms/balances", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("returns the most recent balance per bank, ignoring rows without one", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await prisma.smsTransaction.createMany({
      data: [
        {
          userId: user.userId,
          rawSmsHash: "bal-test-1",
          bankSender: "JM-HDFCBK-S",
          amount: 100,
          txnDate: new Date(Date.UTC(2026, 0, 1)),
          balanceAfterTxn: 48320.26,
        },
        {
          userId: user.userId,
          rawSmsHash: "bal-test-2",
          bankSender: "JM-HDFCBK-S",
          amount: 200,
          txnDate: new Date(Date.UTC(2026, 0, 5)), // more recent — should win
          balanceAfterTxn: 40000,
        },
        {
          userId: user.userId,
          rawSmsHash: "bal-test-3",
          bankSender: "AD-KOTAKB-S",
          amount: 50,
          txnDate: new Date(Date.UTC(2026, 0, 3)),
          balanceAfterTxn: 1000,
        },
        {
          userId: user.userId,
          rawSmsHash: "bal-test-4",
          bankSender: "AD-CBSSBI-S",
          amount: 75,
          txnDate: new Date(Date.UTC(2026, 0, 4)),
          balanceAfterTxn: null, // no balance captured for this one — must be excluded
        },
      ],
    });

    const res = await request(app).get("/sms/balances").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const hdfc = res.body.find((b: any) => b.bankSender === "JM-HDFCBK-S");
    expect(hdfc.balanceAfterTxn).toBe(40000); // the more recent of the two HDFC rows

    const kotak = res.body.find((b: any) => b.bankSender === "AD-KOTAKB-S");
    expect(kotak.balanceAfterTxn).toBe(1000);

    expect(res.body.find((b: any) => b.bankSender === "AD-CBSSBI-S")).toBeUndefined();
  });
});
