import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";
import { verifyWebhookSignature } from "../src/modules/billing/cashfreeClient.js";
import { normalizeEmail, normalizePhone } from "../src/lib/identityMatch.js";

describe("identityMatch normalization", () => {
  it("normalizes email casing/whitespace", () => {
    expect(normalizeEmail(" Test@Example.com ")).toBe("test@example.com");
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it("normalizes phone regardless of country-code/formatting", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("09876543210")).toBe("9876543210");
    expect(normalizePhone("9876543210")).toBe("9876543210");
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("cashfreeClient webhook signature verification (deterministic, no live sandbox needed)", () => {
  const original = { appId: process.env.CASHFREE_APP_ID, secret: process.env.CASHFREE_SECRET_KEY };

  beforeAll(() => {
    process.env.CASHFREE_APP_ID = "TEST_APP_ID";
    process.env.CASHFREE_SECRET_KEY = "test_secret";
  });
  afterAll(() => {
    process.env.CASHFREE_APP_ID = original.appId;
    process.env.CASHFREE_SECRET_KEY = original.secret;
  });

  it("accepts a correctly-computed signature", () => {
    const timestamp = "1700000000";
    const rawBody = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK" });
    const valid = createHmac("sha256", "test_secret").update(timestamp + rawBody).digest("base64");
    expect(verifyWebhookSignature(timestamp, rawBody, valid)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    expect(verifyWebhookSignature("1700000000", JSON.stringify({ a: 1 }), "not-a-real-signature")).toBe(false);
  });
});

describe("pro-purchase routes", () => {
  const createdOrderIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(() => {
    delete process.env.CASHFREE_APP_ID;
    delete process.env.CASHFREE_SECRET_KEY;
  });

  afterAll(async () => {
    await prisma.proPurchase.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("POST /pro-purchase/orders 501s cleanly when Cashfree isn't configured", async () => {
    const res = await request(app).post("/pro-purchase/orders").send({ plan: "MONTHLY", phone: "9876543210" });
    expect(res.status).toBe(501);
  });

  it("POST /pro-purchase/orders rejects an unknown plan and a missing phone (validated before any Cashfree call)", async () => {
    process.env.CASHFREE_APP_ID = "TEST_APP_ID";
    process.env.CASHFREE_SECRET_KEY = "test_secret";
    try {
      const badPlan = await request(app).post("/pro-purchase/orders").send({ plan: "DAILY", phone: "9876543210" });
      expect(badPlan.status).toBe(400);

      const noPhone = await request(app).post("/pro-purchase/orders").send({ plan: "WEEKLY" });
      expect(noPhone.status).toBe(400);
    } finally {
      delete process.env.CASHFREE_APP_ID;
      delete process.env.CASHFREE_SECRET_KEY;
    }
  });

  it("GET /pro-purchase/orders/:orderId 404s for an unknown order", async () => {
    const res = await request(app).get("/pro-purchase/orders/does-not-exist");
    expect(res.status).toBe(404);
  });

  describe("redemption", () => {
    let purchase: { id: string; orderId: string; voucherCode: string };

    beforeEach(async () => {
      const orderId = `pro_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      createdOrderIds.push(orderId);
      const created = await prisma.proPurchase.create({
        data: {
          orderId,
          plan: "MONTHLY",
          amountInr: 500,
          email: "buyer@example.com",
          phone: "9876543210",
          status: "PAID",
          voucherCode: `RRPRO-TEST${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        },
      });
      purchase = { id: created.id, orderId, voucherCode: created.voucherCode! };
    });

    it("rejects redeeming a sandbox-origin voucher once the backend runs in production mode", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);
      const original = process.env.CASHFREE_ENV;
      process.env.CASHFREE_ENV = "production";
      try {
        const res = await request(app)
          .post("/pro-purchase/redeem")
          .set("Authorization", `Bearer ${user.token}`)
          .send({ voucherCode: purchase.voucherCode, phone: "9876543210" });
        expect(res.status).toBe(403);
      } finally {
        process.env.CASHFREE_ENV = original;
      }
    });

    it("rejects redemption with a non-matching email/phone", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);
      const res = await request(app)
        .post("/pro-purchase/redeem")
        .set("Authorization", `Bearer ${user.token}`)
        .send({ voucherCode: purchase.voucherCode, email: "someone-else@example.com" });
      expect(res.status).toBe(403);
    });

    it("rejects an unknown voucher code", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);
      const res = await request(app)
        .post("/pro-purchase/redeem")
        .set("Authorization", `Bearer ${user.token}`)
        .send({ voucherCode: "RRPRO-NOTREAL", email: "buyer@example.com" });
      expect(res.status).toBe(404);
    });

    it("redeems successfully by phone match alone (email omitted)", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);
      const res = await request(app)
        .post("/pro-purchase/redeem")
        .set("Authorization", `Bearer ${user.token}`)
        .send({ voucherCode: purchase.voucherCode, phone: "+91 98765 43210" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("active");
      expect(new Date(res.body.expiryAt).getTime()).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000);

      const updated = await prisma.proPurchase.findUnique({ where: { id: purchase.id } });
      expect(updated?.voucherRedeemed).toBe(true);
      expect(updated?.redeemedByUserId).toBe(user.userId);
    });

    it("redeems successfully by email match alone (phone omitted)", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);
      const res = await request(app)
        .post("/pro-purchase/redeem")
        .set("Authorization", `Bearer ${user.token}`)
        .send({ voucherCode: purchase.voucherCode, email: "Buyer@Example.com" });
      expect(res.status).toBe(200);
    });

    it("rejects redeeming the same voucher twice", async () => {
      const user1 = await createAnonymousUser();
      const user2 = await createAnonymousUser();
      createdUserIds.push(user1.userId, user2.userId);

      const first = await request(app)
        .post("/pro-purchase/redeem")
        .set("Authorization", `Bearer ${user1.token}`)
        .send({ voucherCode: purchase.voucherCode, phone: "9876543210" });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post("/pro-purchase/redeem")
        .set("Authorization", `Bearer ${user2.token}`)
        .send({ voucherCode: purchase.voucherCode, phone: "9876543210" });
      expect(second.status).toBe(409);
    });

    it("only lets ONE of two concurrent redeem requests for the same voucher succeed (TOCTOU regression)", async () => {
      const user1 = await createAnonymousUser();
      const user2 = await createAnonymousUser();
      createdUserIds.push(user1.userId, user2.userId);

      // Fired concurrently, not sequentially — this is what the plain findUnique-then-update
      // version got wrong: both requests could read voucherRedeemed:false before either write
      // landed. The fix claims the voucher via a conditional updateMany inside the transaction,
      // so exactly one of these two must win regardless of request ordering.
      const [res1, res2] = await Promise.all([
        request(app)
          .post("/pro-purchase/redeem")
          .set("Authorization", `Bearer ${user1.token}`)
          .send({ voucherCode: purchase.voucherCode, phone: "9876543210" }),
        request(app)
          .post("/pro-purchase/redeem")
          .set("Authorization", `Bearer ${user2.token}`)
          .send({ voucherCode: purchase.voucherCode, phone: "9876543210" }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const updated = await prisma.proPurchase.findUnique({ where: { id: purchase.id } });
      expect(updated?.voucherRedeemed).toBe(true);
      // redeemedByUserId must be whichever of the two actually got the 200, not left ambiguous.
      const winnerId = res1.status === 200 ? user1.userId : user2.userId;
      expect(updated?.redeemedByUserId).toBe(winnerId);

      const winnerEntitlement = await prisma.proEntitlement.findUnique({ where: { userId: winnerId } });
      expect(winnerEntitlement?.status).toBe("active");
      const loserId = winnerId === user1.userId ? user2.userId : user1.userId;
      const loserEntitlement = await prisma.proEntitlement.findUnique({ where: { userId: loserId } });
      expect(loserEntitlement).toBeNull();
    });

    it("extends from the later of (existing entitlement expiry, now) instead of shortening it", async () => {
      const user = await createAnonymousUser();
      createdUserIds.push(user.userId);
      const farFuture = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);
      await prisma.proEntitlement.create({
        data: { userId: user.userId, productId: "voucher_yearly", expiryAt: farFuture, verifiedAt: new Date(), status: "active" },
      });

      const res = await request(app)
        .post("/pro-purchase/redeem")
        .set("Authorization", `Bearer ${user.token}`)
        .send({ voucherCode: purchase.voucherCode, phone: "9876543210" });
      expect(res.status).toBe(200);
      // MONTHLY (30 days) redeemed on top of a ~300-day-out expiry should extend past that
      // existing expiry, not reset down to ~30 days from now.
      expect(new Date(res.body.expiryAt).getTime()).toBeGreaterThan(farFuture.getTime());
    });
  });
});
