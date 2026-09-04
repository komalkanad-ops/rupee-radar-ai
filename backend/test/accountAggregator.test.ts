import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { ingestAccountAggregatorTransactions } from "../src/modules/accountAggregator/accountAggregatorRouter.js";
import { createAnonymousUser } from "./helpers.js";
import type { SetuTransaction } from "../src/modules/accountAggregator/setuClient.js";

describe("account aggregator", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.bankLink.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  describe("ingestAccountAggregatorTransactions", () => {
    it("maps Setu transactions into SmsTransaction rows with correct categorization and dedupe key", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);

      const fixture: SetuTransaction[] = [
        { txnId: "txn-1", amount: "1250.00", type: "DEBIT", transactionTimestamp: "2026-08-01T10:00:00Z", narration: "SWIGGY BANGALORE" },
        { txnId: "txn-2", amount: "50000.00", type: "CREDIT", transactionTimestamp: "2026-08-05T09:00:00Z", narration: "SALARY CREDIT" },
      ];

      const count = await ingestAccountAggregatorTransactions(user.userId, fixture);
      expect(count).toBe(2);

      const rows = await prisma.smsTransaction.findMany({ where: { userId: user.userId }, orderBy: { txnDate: "asc" } });
      expect(rows).toHaveLength(2);
      expect(rows[0].rawSmsHash).toBe("aa:txn-1");
      expect(rows[0].parsedVia).toBe("account_aggregator");
      expect(rows[0].amount).toBe(1250);
      expect(rows[0].category).not.toBe("income");
      expect(rows[1].category).toBe("income");
    });

    it("re-ingesting the same transactions upserts instead of duplicating", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);
      const fixture: SetuTransaction[] = [
        { txnId: "txn-dup", amount: "100.00", type: "DEBIT", transactionTimestamp: "2026-08-01T10:00:00Z", narration: "TEST" },
      ];

      await ingestAccountAggregatorTransactions(user.userId, fixture);
      await ingestAccountAggregatorTransactions(user.userId, fixture);

      const rows = await prisma.smsTransaction.findMany({ where: { userId: user.userId, rawSmsHash: "aa:txn-dup" } });
      expect(rows).toHaveLength(1);
    });
  });

  describe("POST /account-aggregator/link", () => {
    it("501s cleanly when Setu credentials aren't configured", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);
      const res = await request(app)
        .post("/account-aggregator/link")
        .set("Authorization", `Bearer ${user.token}`)
        .send({});
      expect(res.status).toBe(501);
    });
  });

  describe("GET /account-aggregator/status", () => {
    it("returns null for a user with no bank link", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);
      const res = await request(app)
        .get("/account-aggregator/status")
        .set("Authorization", `Bearer ${user.token}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });
});
