import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("POST /sms/transactions — txnType", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  const base = { bankSender: "AD-KOTAKB-S", amount: 450, merchant: "test.user@okaxis", category: "income", parsedVia: "regex", txnDate: "2026-08-12T10:00:00.000Z" };

  it("stores a valid direction, ignores junk, and an older client's re-upload keeps it", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const post = (transactions: any[]) =>
      request(app).post("/sms/transactions").set("Authorization", `Bearer ${user.token}`).send({ userId: user.userId, transactions });

    expect((await post([{ ...base, rawSmsHash: "txn-type-1", txnType: "credit" }, { ...base, rawSmsHash: "txn-type-2", txnType: "sideways" }])).status).toBe(201);

    // Older app build: no txnType at all on an edit re-upload.
    expect((await post([{ ...base, rawSmsHash: "txn-type-1", category: "transfer" }])).status).toBe(201);

    const res = await request(app).get("/sms/transactions").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    const byHash = Object.fromEntries(res.body.map((t: any) => [t.rawSmsHash, t]));
    expect(byHash["txn-type-1"].txnType).toBe("credit");
    expect(byHash["txn-type-1"].category).toBe("transfer");
    expect(byHash["txn-type-2"].txnType).toBeNull();
  });
});
