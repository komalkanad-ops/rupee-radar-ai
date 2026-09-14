// Wraps Cashfree's Payment Gateway Orders API for the website PRO-voucher purchase flow. Same
// convention as razorpayClient.ts: plain fetch() (no SDK — the official Node SDK's docs show two
// incompatible API generations, ambiguous enough to skip), env vars read per-call so the pure
// signature-verification function stays unit-testable via env mutation, HMAC + timingSafeEqual for
// the webhook signature (never plain === comparison).
// Confirmed against Cashfree's public docs + a live sandbox order-creation call, 2026-09-14:
// https://docs.cashfree.com/docs/orders — order_currency/order_amount/customer_details
//   (customer_phone is MANDATORY; customer_email is optional — verified empirically, an
//   email-only order 400s with "customer_details.customer_phone : is missing").
// https://docs.cashfree.com/docs/webhooks — signature = Base64(HMACSHA256(timestamp + rawBody, secret))
import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";

const API_VERSION = "2023-08-01";

function baseUrl(): string {
  // CASHFREE_ENV unset or anything other than "production" defaults to sandbox — safer default
  // than accidentally going live on an unconfigured env.
  return process.env.CASHFREE_ENV === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

export function isCashfreeConfigured(): boolean {
  return Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}

function requireConfig() {
  if (!isCashfreeConfigured()) {
    throw new Error(
      "Cashfree is not configured — set CASHFREE_APP_ID and CASHFREE_SECRET_KEY in backend/.env " +
        "(sandbox keys are free/self-serve from the Cashfree dashboard)",
    );
  }
}

function headers() {
  return {
    "x-client-id": process.env.CASHFREE_APP_ID!,
    "x-client-secret": process.env.CASHFREE_SECRET_KEY!,
    "x-api-version": API_VERSION,
    "Content-Type": "application/json",
  };
}

export interface CashfreeOrder {
  order_id: string;
  cf_order_id: string;
  order_status: string;
  order_amount: number;
  payment_session_id: string;
}

export async function createOrder(params: {
  orderId: string;
  amountInr: number;
  customerId: string;
  customerPhone: string;
  customerEmail?: string;
  returnUrl: string;
}): Promise<CashfreeOrder> {
  requireConfig();
  const res = await fetch(`${baseUrl()}/orders`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      order_id: params.orderId,
      order_amount: params.amountInr,
      order_currency: "INR",
      customer_details: {
        customer_id: params.customerId,
        customer_phone: params.customerPhone,
        ...(params.customerEmail ? { customer_email: params.customerEmail } : {}),
      },
      order_meta: { return_url: params.returnUrl },
    }),
  });

  let data: any;
  try {
    data = await res.json();
  } catch (err: any) {
    throw new Error(`Invalid JSON response from Cashfree: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(data?.message || JSON.stringify(data));
  }
  return data as CashfreeOrder;
}

export async function fetchOrder(orderId: string): Promise<CashfreeOrder> {
  requireConfig();
  const res = await fetch(`${baseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: headers(),
  });
  let data: any;
  try {
    data = await res.json();
  } catch (err: any) {
    throw new Error(`Invalid JSON response from Cashfree: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(data?.message || JSON.stringify(data));
  }
  return data as CashfreeOrder;
}

// Webhook signature: Base64(HMACSHA256(timestamp + rawBody, secretKey)), compared against the
// x-webhook-signature header. Uses CASHFREE_SECRET_KEY — Cashfree's PG webhooks are signed with the
// same client secret (no separate webhook secret, unlike Razorpay).
export function verifyWebhookSignature(timestamp: string, rawBody: string, signature: string): boolean {
  requireConfig();
  const expected = createHmac("sha256", process.env.CASHFREE_SECRET_KEY!)
    .update(timestamp + rawBody)
    .digest("base64");
  return safeCompare(expected, signature);
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
