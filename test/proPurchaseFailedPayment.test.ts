import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Mocks the actual Cashfree network calls so this test can exercise the "order still ACTIVE but the
// latest payment ATTEMPT failed" branch deterministically — order_status alone never reaches a
// terminal state on a declined card, so this path can only be exercised by controlling
// fetchOrderPayments() directly, not by waiting on real sandbox flakiness.
vi.mock("../src/modules/billing/cashfreeClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/billing/cashfreeClient.js")>();
  return {
    ...actual,
    isCashfreeConfigured: () => true,
    fetchOrder: vi.fn(async (orderId: string) => ({
      order_id: orderId,
      cf_order_id: "cf_test",
      order_status: "ACTIVE",
      order_amount: 500,
      payment_session_id: "session_test",
    })),
    fetchOrderPayments: vi.fn(async () => [
      { cf_payment_id: "1", payment_status: "FAILED", payment_time: "2026-09-14T10:00:00+05:30" },
    ]),
  };
});

const { app } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");

describe("GET /pro-purchase/orders/:orderId surfaces a failed payment attempt distinctly", () => {
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    await prisma.proPurchase.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  });

  it("returns a PAYMENT_-prefixed status instead of leaving the client to poll forever", async () => {
    const orderId = `pro_test_failed_${Date.now()}`;
    createdOrderIds.push(orderId);
    await prisma.proPurchase.create({
      data: { orderId, plan: "MONTHLY", amountInr: 500, phone: "9876543210", status: "CREATED" },
    });

    const res = await request(app).get(`/pro-purchase/orders/${orderId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PAYMENT_FAILED");
    expect(res.body.voucherCode).toBeNull();
  });
});
