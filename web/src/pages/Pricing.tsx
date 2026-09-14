import { useEffect, useState } from "react";
import { load } from "@cashfreepayments/cashfree-js";
import { api, apiPost } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import { useSeo } from "../lib/useSeo";

type PlanKey = "WEEKLY" | "MONTHLY" | "YEARLY";

interface Plan {
  key: PlanKey;
  label: string;
  priceInr: number;
  // What it would cost at the weekly rate for the same span — shown crossed out next to the
  // discounted price, per the owner's ask ("actual amount based on calculation of 200 per week").
  actualInr: number | null;
  per: string;
  badge?: string;
}

const PLANS: Plan[] = [
  { key: "WEEKLY", label: "Weekly", priceInr: 200, actualInr: null, per: "/ week" },
  { key: "MONTHLY", label: "Monthly", priceInr: 500, actualInr: 200 * 4, per: "/ month", badge: "Most popular" },
  { key: "YEARLY", label: "Yearly", priceInr: 3000, actualInr: 200 * 52, per: "/ year", badge: "Best value" },
];

// The 16 PRO-only screens as of 2026-09-14 (grepped from every ProLockedCard(title=...) call in
// the Android app), grouped for readability. Keep this in sync when a new PRO screen ships.
const PRO_FEATURES: { title: string; blurb: string }[] = [
  { title: "Fix Your Finance", blurb: "One action plan pulling every insight together" },
  { title: "Financial Review", blurb: "Monthly/quarterly/yearly grade with an AI-written summary" },
  { title: "Money Leaks", blurb: "Finds forgotten subscriptions, fee creep, and duplicate charges" },
  { title: "Safety Net", blurb: "Emergency-fund months + debt-to-income vs healthy benchmarks" },
  { title: "Debt Freedom", blurb: "Snowball vs avalanche payoff planner, with a debt-free date" },
  { title: "Net Worth Projection", blurb: "Where your net worth is heading, 1/3/5/10 years out" },
  { title: "Spending Habits", blurb: "When and how you actually spend, by day and time" },
  { title: "Cash Flow Calendar", blurb: "Day-by-day balance projection so you never get caught short" },
  { title: "Income-Loss Runway", blurb: "How long your savings would last if income stopped" },
  { title: "Credit Score Insights", blurb: "Score tracking with what's actually moving it" },
  { title: "Tax-Saving Nudges", blurb: "Personalised tips to cut your tax bill" },
  { title: "Quick Capture", blurb: "Speak an expense out loud, it's logged" },
  { title: "Coupon Vault", blurb: "Save and reuse coupon codes across stores" },
  { title: "Live Offers", blurb: "Merchant offers matched to your cards" },
  { title: "Family Vault", blurb: "Shared household net worth and spend" },
  { title: "Unlimited AI Assistant", blurb: "No 3-message cap — ask anything, anytime" },
];

const FREE_FEATURES = [
  "SMS-based expense tracking",
  "Credit card catalog & recommendations",
  "Budgets & spending goals",
  "Net worth tracker",
  "Loan & EMI tracker",
  "Recurring bills & reminders",
  "Basic spending insights",
];

type Step = "form" | "paying";

export default function Pricing() {
  useSeo({
    title: "Rupee Radar AI PRO — Pricing",
    description: "Unlock every PRO insight in Rupee Radar AI — weekly, monthly, or yearly. See exactly what's included.",
    canonical: "https://rupeeradarai.com/pricing",
  });

  const [selected, setSelected] = useState<PlanKey>("MONTHLY");
  const [step, setStep] = useState<Step>("form");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Defaults true (sandbox) until /pro-purchase/config actually answers — same "unsure? assume
  // sandbox" safe default the backend itself uses. Defaulting false here would mean a buyer who
  // clicks fast enough (or a slow network) could initialize the Cashfree SDK in production mode
  // before this ever resolves, even while the backend is genuinely still in sandbox.
  const [sandbox, setSandbox] = useState(true);

  useEffect(() => {
    api<{ sandbox: boolean; configured: boolean }>("/pro-purchase/config")
      .then((c) => setSandbox(c.sandbox))
      .catch(() => {});
  }, []);

  const plan = PLANS.find((p) => p.key === selected)!;

  async function startCheckout() {
    setError(null);
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) {
      setError("Enter a valid 10-digit mobile number");
      return;
    }
    setStep("paying");
    trackEvent("pro_checkout_started", { plan: selected });
    try {
      const order = await apiPost<{ orderId: string; paymentSessionId: string; amountInr: number }>(
        "/pro-purchase/orders",
        { plan: selected, phone: digits, email: email.trim() || undefined },
      );
      // Derived from the SAME /pro-purchase/config call that drives the "test mode" banner above —
      // never a separate client-side build flag. A previous version read import.meta.env.
      // VITE_CASHFREE_MODE, which was never actually set anywhere (no .env.production entry, no
      // Hostinger build config), so it silently defaulted to "sandbox" always. If the backend were
      // ever flipped to CASHFREE_ENV=production without someone remembering to also configure that
      // separate, undocumented client var, the SDK would still init in sandbox mode against a
      // payment_session_id created by a production order — checkout would fail outright. Reading
      // the same boolean the backend already exposes makes that drift impossible by construction.
      const cashfree = await load({ mode: sandbox ? "sandbox" : "production" });
      // redirectTarget: "_self" means checkout() itself navigates the page to Cashfree's hosted
      // checkout — the return_url set at order-creation time (order_meta.return_url, server-side)
      // is what brings the buyer back to /pro/success once they actually pay. Confirmed via a real
      // browser run: checkout()'s promise resolves as soon as the navigation is *triggered*, not
      // once it completes — an unconditional redirect placed after the await here raced Cashfree's
      // own in-flight navigation and won, bouncing every buyer straight to "Confirming your
      // payment…" before they ever saw a payment form. Only redirect ourselves on a genuine
      // failure (result.error) — a real redirect never reaches this line at all.
      const result = await cashfree.checkout({
        paymentSessionId: order.paymentSessionId,
        returnUrl: `${window.location.origin}/pro/success?order_id={order_id}`,
        redirectTarget: "_self",
      });
      if (result?.error) {
        setError(result.error.message || "Payment was cancelled or failed — try again");
        setStep("form");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout — try again");
      setStep("form");
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      {sandbox && (
        <div className="mb-8 rounded-xl border border-danger/40 bg-danger/10 text-danger text-sm text-center px-4 py-3">
          Payments are running in <strong>test mode</strong> right now — no real money is charged.
          Use Cashfree's test card to try the flow.
        </div>
      )}
      <div className="text-center mb-12">
        <span className="inline-block text-xs font-bold uppercase tracking-wider text-gold bg-gold/10 border border-gold/30 rounded-full px-3 py-1 mb-4">
          Rupee Radar AI PRO
        </span>
        <h1 className="text-3xl md:text-4xl font-bold mb-3">Get the full picture of your money</h1>
        <p className="text-app-muted max-w-xl mx-auto">
          Free tracks your spend. PRO tells you what to do about it — money leaks, a debt-free
          date, where your net worth is heading, and more.
        </p>
      </div>

      {/* 3 plan cards */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {PLANS.map((p) => (
          <button
            key={p.key}
            onClick={() => setSelected(p.key)}
            className={`relative text-left rounded-2xl border p-6 transition-colors ${
              selected === p.key
                ? "border-gold bg-gold/10"
                : "border-app-border bg-app-surface hover:border-gold/50"
            }`}
          >
            {p.badge && (
              <span className="absolute -top-3 right-4 text-[10px] font-bold uppercase tracking-wide bg-gold text-black rounded-full px-2 py-1">
                {p.badge}
              </span>
            )}
            <div className="text-sm font-semibold text-app-muted mb-2">{p.label}</div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl font-bold text-app-text">₹{p.priceInr.toLocaleString("en-IN")}</span>
              <span className="text-sm text-app-muted">{p.per}</span>
            </div>
            {p.actualInr && p.actualInr > p.priceInr && (
              <div className="mt-1 text-sm">
                <span className="line-through text-app-muted/70">₹{p.actualInr.toLocaleString("en-IN")}</span>
                <span className="ml-2 text-brand font-semibold">
                  {Math.round((1 - p.priceInr / p.actualInr) * 100)}% off
                </span>
              </div>
            )}
            <div
              className={`mt-4 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                selected === p.key ? "border-gold bg-gold" : "border-app-border"
              }`}
            >
              {selected === p.key && <span className="w-2 h-2 rounded-full bg-black" />}
            </div>
          </button>
        ))}
      </div>
      <p className="text-xs text-app-muted text-center mb-10">
        Priced off ₹200/week — Monthly and Yearly are discounted against that baseline.
      </p>

      {/* Checkout box */}
      <div className="rounded-2xl border border-app-border bg-app-surface p-6 max-w-md mx-auto mb-16">
        {step === "form" ? (
          <>
            <h2 className="font-semibold text-app-text mb-4">
              {plan.label} plan — ₹{plan.priceInr.toLocaleString("en-IN")}
            </h2>
            <label className="block text-sm text-app-muted mb-1">Mobile number *</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98765 43210"
              className="w-full rounded-lg border border-app-border bg-app-bg text-app-text px-3 py-2.5 mb-3"
            />
            <label className="block text-sm text-app-muted mb-1">Email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-app-border bg-app-bg text-app-text px-3 py-2.5 mb-2"
            />
            <p className="text-xs text-app-muted mb-4">
              You'll redeem your PRO code in the app using this phone number (or email).
            </p>
            {error && <p className="text-sm text-danger mb-3">{error}</p>}
            <button
              onClick={startCheckout}
              className="w-full rounded-xl bg-gold text-black font-bold py-3 hover:opacity-90 transition-opacity"
            >
              Continue to payment
            </button>
          </>
        ) : (
          <div className="text-center py-6">
            <p className="text-app-text font-semibold mb-1">Opening secure checkout…</p>
            <p className="text-sm text-app-muted">Powered by Cashfree Payments</p>
          </div>
        )}
      </div>

      {/* Feature comparison */}
      <h2 className="text-2xl font-bold text-center mb-2">What you get with PRO</h2>
      <p className="text-app-muted text-center mb-8">Everything in Free, plus:</p>

      <div className="grid md:grid-cols-2 gap-8 mb-12">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-app-muted mb-4">Free</h3>
          <ul className="space-y-3">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-app-muted">
                <span className="text-brand mt-0.5">✓</span> {f}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-gold mb-4">PRO — everything above, plus</h3>
          <ul className="space-y-3">
            {PRO_FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-2">
                <span className="text-gold mt-0.5">★</span>
                <span>
                  <span className="text-app-text font-medium">{f.title}</span>{" "}
                  <span className="text-app-muted">— {f.blurb}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-center text-xs text-app-muted">
        After payment you'll get a one-time PRO code — enter it in the app (PRO → Bought PRO on the
        website?) with the same phone number or email to activate.
      </p>
    </div>
  );
}
