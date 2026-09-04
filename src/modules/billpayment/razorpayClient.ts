// Wraps Razorpay's Orders API. Unlike Setu's AA webhook (Phase 3, unverified) or the credit-score
// vendor (Phase 4, undecided), every shape here — order creation, payment-signature verification,
// webhook-signature verification — is built against Razorpay's public docs, confirmed directly:
// https://razorpay.com/docs/payments/payment-gateway/quick-integration/integration-steps/
// https://razorpay.com/docs/webhooks/validate-test/
//
// Env vars are read per-call rather than cached at module scope (unlike setuClient.ts/
// creditBureauClient.ts) — deliberately, so the signature-verification functions (pure, no network
// call) stay genuinely unit-testable via env mutation in tests, the same way billingRouter.ts's
// PRO_TEST_REDEEM_CODE already does.
import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";

const BASE_URL = "https://api.razorpay.com/v1";

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function requireConfig() {
  if (!isRazorpayConfigured()) {
    throw new Error(
      "Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET " +
        "(free, self-serve test-mode keys from your Razorpay dashboard, no KYC required) in backend/.env",
    );
  }
}

export function getPublicKeyId(): string {
  requireConfig();
  return process.env.RAZORPAY_KEY_ID!;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

// amountPaise: amount in the smallest currency unit (paise for INR) — Razorpay's own convention.
export async function createOrder(amountPaise: number, receipt: string): Promise<RazorpayOrder> {
  requireConfig();
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt }),
  });

  let data: any;
  try {
    data = await res.json();
  } catch (err: any) {
    throw new Error(`Invalid JSON response from Razorpay: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(data?.error?.description || JSON.stringify(data));
  }
  return data as RazorpayOrder;
}

// Checkout returns {razorpay_order_id, razorpay_payment_id, razorpay_signature} after a successful
// payment — never trust that trio's mere presence as proof of payment. Recompute the signature
// server-side (HMAC-SHA256 of "orderId|paymentId" keyed by key_secret) and compare with a
// constant-time comparison to avoid a timing side-channel.
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  requireConfig();
  const expected = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest("hex");
  return safeCompare(expected, signature);
}

// Webhook signature: HMAC-SHA256 of the RAW request body (not the parsed/re-serialized object)
// keyed by the separate webhook secret configured in the Razorpay dashboard.
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET is not set — add it to backend/.env");
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeCompare(expected, signature);
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
