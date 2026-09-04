import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import {
  createOrder,
  getPublicKeyId,
  isRazorpayConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpayClient.js";

export const billPaymentRouter = Router();

// Deliberately NOT requirePro-gated — unlike Phases 2/4's new features, bill payment is a core
// engagement/data hook (same as CRED/PhonePe keep it free), not a paywalled convenience. It earns
// its own payoff via the existing coins economy (BILL_PAYMENT_BONUS) instead of a subscription gate.
const BILL_PAYMENT_BONUS_COINS = 20;
const NOT_CONFIGURED_ERROR = { error: "In-app bill payment is not configured yet — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET" };

// Shared by both POST /verify (app-triggered) and POST /webhook (Razorpay-triggered) — idempotent,
// so it's safe to call from whichever path resolves first.
async function markPaid(billPaymentId: string, razorpayPaymentId: string) {
  const payment = await prisma.billPayment.findUniqueOrThrow({ where: { id: billPaymentId } });
  if (payment.status === "PAID") return payment;

  const [updated] = await prisma.$transaction([
    prisma.billPayment.update({
      where: { id: billPaymentId },
      data: { status: "PAID", razorpayPaymentId, paidAt: new Date() },
    }),
    prisma.coinLedgerEntry.create({
      data: { userId: payment.userId, delta: BILL_PAYMENT_BONUS_COINS, reason: "BILL_PAYMENT_BONUS", relatedId: billPaymentId },
    }),
  ]);

  // Credit-card billing cycles are near-universally monthly — a deliberately narrow default, not a
  // general recurrence-rule engine (see plan doc).
  if (payment.recurringPaymentId) {
    const recurring = await prisma.recurringPayment.findUnique({ where: { id: payment.recurringPaymentId } });
    if (recurring?.type === "CREDIT_CARD_BILL" && recurring.nextDueDate) {
      const next = new Date(recurring.nextDueDate);
      next.setMonth(next.getMonth() + 1);
      await prisma.recurringPayment.update({ where: { id: recurring.id }, data: { nextDueDate: next } });
    }
  }

  return updated;
}

// POST /bill-payment/orders — { amount, recurringPaymentId? } — amount in rupees (converted to
// paise for Razorpay). 501s if unconfigured, same shape as every prior phase's unconfigured-vendor
// response.
billPaymentRouter.post("/orders", requireUser, async (req: UserRequest, res) => {
  if (!isRazorpayConfigured()) return res.status(501).json(NOT_CONFIGURED_ERROR);
  const userId = req.userId!;
  const { amount, recurringPaymentId } = req.body ?? {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "amount must be a positive number" });

  if (recurringPaymentId) {
    const owned = await prisma.recurringPayment.findFirst({ where: { id: recurringPaymentId, userId } });
    if (!owned) return res.status(404).json({ error: "recurringPaymentId not found" });
  }

  const amountPaise = Math.round(Number(amount) * 100);
  const order = await createOrder(amountPaise, `bill_${userId}_${Date.now()}`);

  await prisma.billPayment.create({
    data: {
      userId,
      recurringPaymentId: recurringPaymentId ?? null,
      amount: Number(amount),
      razorpayOrderId: order.id,
      status: "CREATED",
    },
  });

  res.status(201).json({ orderId: order.id, amount: order.amount, keyId: getPublicKeyId() });
});

// POST /bill-payment/verify — { razorpayOrderId, razorpayPaymentId, razorpaySignature } — called
// by the app right after Checkout completes. Never trusts the client's "it succeeded" claim; only
// a valid server-recomputed signature marks the payment PAID.
billPaymentRouter.post("/verify", requireUser, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body ?? {};
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return res.status(400).json({ error: "razorpayOrderId, razorpayPaymentId, razorpaySignature are required" });
  }

  const payment = await prisma.billPayment.findUnique({ where: { razorpayOrderId } });
  if (!payment || payment.userId !== userId) return res.status(404).json({ error: "Unknown order" });

  if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return res.status(400).json({ error: "Invalid payment signature" });
  }

  const updated = await markPaid(payment.id, razorpayPaymentId);
  res.json(updated);
});

// POST /bill-payment/webhook — Razorpay's payment.captured/payment.failed events. No requireUser
// (called by Razorpay, not the app) — trust comes from the HMAC signature, not the caller's
// identity. Requires the RAW request body for HMAC verification; see app.ts for why this route is
// registered before the global express.json() middleware.
billPaymentRouter.post("/webhook", async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const rawBody = (req as any).rawBody as string | undefined;
  if (typeof signature !== "string" || !rawBody) {
    return res.status(400).json({ error: "Missing signature or raw body" });
  }

  let valid: boolean;
  try {
    valid = verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    return res.status(501).json({ error: (err as Error).message });
  }
  if (!valid) return res.status(400).json({ error: "Invalid webhook signature" });

  const body = JSON.parse(rawBody);
  const orderId = body?.payload?.payment?.entity?.order_id;
  const paymentId = body?.payload?.payment?.entity?.id;
  if (!orderId) return res.status(400).json({ error: "Missing order_id in webhook payload" });

  const payment = await prisma.billPayment.findUnique({ where: { razorpayOrderId: orderId } });
  if (!payment) return res.status(404).json({ error: "Unknown order" });

  if (body.event === "payment.captured" && paymentId) {
    await markPaid(payment.id, paymentId);
  } else if (body.event === "payment.failed") {
    await prisma.billPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
  }

  res.status(200).json({ ok: true });
});
