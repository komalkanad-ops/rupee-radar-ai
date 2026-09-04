import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";
import { verifyPaymentSignature, verifyWebhookSignature } from "../src/modules/billpayment/razorpayClient.js";

describe("razorpayClient signature verification (deterministic, no live sandbox needed)", () => {
  const originalKeyId = process.env.RAZORPAY_KEY_ID;
  const originalKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const originalWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  beforeAll(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
    process.env.RAZORPAY_KEY_SECRET = "test_key_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
  });
  afterAll(() => {
    process.env.RAZORPAY_KEY_ID = originalKeyId;
    process.env.RAZORPAY_KEY_SECRET = originalKeySecret;
    process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
  });

  it("accepts a correctly-computed payment signature", () => {
    const orderId = "order_test123";
    const paymentId = "pay_test456";
    const validSignature = createHmac("sha256", "test_key_secret").update(`${orderId}|${paymentId}`).digest("hex");
    expect(verifyPaymentSignature(orderId, paymentId, validSignature)).toBe(true);
  });

  it("rejects a tampered payment signature", () => {
    expect(verifyPaymentSignature("order_test123", "pay_test456", "0".repeat(64))).toBe(false);
  });

  it("accepts a correctly-computed webhook signature over the raw body", () => {
    const rawBody = JSON.stringify({ event: "payment.captured" });
    const validSignature = createHmac("sha256", "test_webhook_secret").update(rawBody).digest("hex");
    expect(verifyWebhookSignature(rawBody, validSignature)).toBe(true);
  });

  it("rejects a webhook signature computed over a different body", () => {
    const validSignature = createHmac("sha256", "test_webhook_secret").update(JSON.stringify({ event: "payment.captured" })).digest("hex");
    expect(verifyWebhookSignature(JSON.stringify({ event: "payment.failed" }), validSignature)).toBe(false);
  });
});

describe("bill payment routes", () => {
  const createdUserIds: string[] = [];

  // Explicit, not relying on the previous describe's afterAll cleanup — this block specifically
  // needs Razorpay to read as unconfigured.
  beforeAll(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  afterAll(async () => {
    await prisma.billPayment.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("POST /bill-payment/orders 501s cleanly when Razorpay isn't configured", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/bill-payment/orders")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 500 });
    expect(res.status).toBe(501);
  });

  it("POST /bill-payment/verify rejects an unknown order", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/bill-payment/verify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ razorpayOrderId: "order_doesnotexist", razorpayPaymentId: "pay_x", razorpaySignature: "sig_x" });
    expect(res.status).toBe(404);
  });
});
