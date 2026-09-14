import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import { useSeo } from "../lib/useSeo";

const SUPPORT_EMAIL = "support@rupeeradarai.com";

interface OrderStatus {
  status: string;
  plan: string;
  amountInr: number;
  voucherCode: string | null;
}

// Cashfree order_status values that will never turn into a voucher — stop polling on these.
const TERMINAL_UNPAID = new Set(["EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"]);
// The backend prefixes a genuinely-failed payment ATTEMPT with "PAYMENT_" (e.g. "PAYMENT_FAILED",
// "PAYMENT_USER_DROPPED") — distinct from the order's own order_status, which stays ACTIVE/retriable
// even after a declined card. Without this, a failed/abandoned payment looked identical to "buyer
// is still filling the form" and this page just kept spinning "Confirming your payment…" for the
// full ~100s poll window before giving up with a vague message.
const FAILED_STATUS_PREFIX = "PAYMENT_";
const POLL_MS = 2500;
const MAX_POLLS = 40; // ~100s — generous for a redirect-based checkout that already completed

function friendlyFailureReason(status: string): string {
  const reason = status.slice(FAILED_STATUS_PREFIX.length);
  switch (reason) {
    case "USER_DROPPED":
      return "the checkout was closed before completing";
    case "VOID":
    case "CANCELLED":
      return "it was cancelled";
    default:
      return "it didn't go through";
  }
}

export default function ProSuccess() {
  useSeo({
    title: "Payment successful — Rupee Radar AI PRO",
    description: "Your Rupee Radar AI PRO voucher code.",
    robots: "noindex",
  });

  const [params] = useSearchParams();
  const orderId = params.get("order_id");
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedStatus, setFailedStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const pollsRef = useRef(0);
  const trackedRef = useRef(false);

  useEffect(() => {
    api<{ sandbox: boolean }>("/pro-purchase/config").then((c) => setSandbox(c.sandbox)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!orderId) {
      setError("Missing order — if you just paid, check your browser's back button.");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const result = await api<OrderStatus>(`/pro-purchase/orders/${encodeURIComponent(orderId!)}`);
        if (cancelled) return;
        setOrder(result);
        if (result.voucherCode) {
          if (!trackedRef.current) {
            trackedRef.current = true;
            trackEvent("pro_purchase_completed", { plan: result.plan, amountInr: result.amountInr });
          }
          return; // done, stop polling
        }
        if (result.status.startsWith(FAILED_STATUS_PREFIX)) {
          trackEvent("pro_purchase_failed", { status: result.status });
          setFailedStatus(result.status);
          return; // done, this attempt genuinely failed — stop polling immediately
        }
        if (TERMINAL_UNPAID.has(result.status)) return; // done, payment won't complete
        pollsRef.current += 1;
        if (pollsRef.current < MAX_POLLS) {
          timer = setTimeout(poll, POLL_MS);
        } else {
          setError("Still waiting on your payment to confirm — this can take a minute. Refresh this page shortly.");
        }
      } catch {
        if (cancelled) return;
        pollsRef.current += 1;
        if (pollsRef.current < MAX_POLLS) {
          timer = setTimeout(poll, POLL_MS);
        } else {
          setError("Could not check your payment status — refresh this page, or contact support with your order id.");
        }
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId]);

  function copyCode() {
    if (!order?.voucherCode) return;
    navigator.clipboard.writeText(order.voucherCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-20 text-center">
      {sandbox && (
        <div className="mb-8 rounded-xl border border-danger/40 bg-danger/10 text-danger text-sm text-center px-4 py-3">
          Test mode — no real money was charged for this purchase.
        </div>
      )}
      {order?.voucherCode ? (
        <>
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold mb-2">Payment successful</h1>
          <p className="text-app-muted mb-8">
            Here's your one-time PRO code. Save it — it's shown only here.
          </p>
          <div className="rounded-2xl border border-gold bg-gold/10 p-6 mb-4">
            <div className="text-3xl font-mono font-bold text-app-text tracking-wider mb-3">
              {order.voucherCode}
            </div>
            <button
              onClick={copyCode}
              className="rounded-lg bg-gold text-black font-semibold px-4 py-2 text-sm hover:opacity-90 transition-opacity"
            >
              {copied ? "Copied!" : "Copy code"}
            </button>
          </div>
          <p className="text-sm text-app-muted mb-8">
            Open Rupee Radar AI → PRO → <strong className="text-app-text">Bought PRO on the website?</strong> →
            enter this code with the same phone number or email you paid with.
          </p>
          <Link to="/download" className="text-brand hover:underline text-sm">
            Don't have the app yet? Download it →
          </Link>
        </>
      ) : failedStatus ? (
        <>
          <div className="text-5xl mb-4">😕</div>
          <h1 className="text-2xl font-bold mb-2">Payment didn't go through</h1>
          <p className="text-app-muted mb-8">
            Your payment attempt failed — {friendlyFailureReason(failedStatus)}. You haven't been charged.
          </p>
          <Link
            to="/pricing"
            className="inline-block rounded-xl bg-gold text-black font-bold px-6 py-3 hover:opacity-90 transition-opacity"
          >
            Try again
          </Link>
        </>
      ) : error ? (
        <>
          <h1 className="text-2xl font-bold mb-2">Hang tight</h1>
          <p className="text-app-muted mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-app-border px-4 py-2 text-sm hover:border-gold/50"
          >
            Check again
          </button>
        </>
      ) : (
        <>
          <div className="animate-spin w-8 h-8 border-2 border-gold border-t-transparent rounded-full mx-auto mb-6" />
          <h1 className="text-xl font-semibold mb-2">Confirming your payment…</h1>
          <p className="text-app-muted text-sm">This usually takes a few seconds.</p>
        </>
      )}

      <p className="text-xs text-app-muted/80 mt-12 pt-6 border-t border-app-border leading-relaxed">
        Having trouble with a payment? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-app-muted">
          {SUPPORT_EMAIL}
        </a>
        . Payments are processed entirely by Cashfree Payments, an independent third-party gateway
        — Rupee Radar AI never sees your card, UPI, or bank details and isn't responsible for loss
        or fraud involving your payment instrument; for a specific transaction issue, also contact
        Cashfree directly via your payment receipt.
      </p>
    </div>
  );
}
