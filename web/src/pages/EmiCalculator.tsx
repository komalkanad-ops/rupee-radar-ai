import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSeo } from "../lib/useSeo";
import { buildAmortizationSchedule, calculateEmi, fullTenureSummary, withExtraMonthlyPayment } from "../lib/emiCalculator";

const FAQ = [
  {
    q: "How is EMI calculated?",
    a: "EMI = P x r x (1+r)^n / ((1+r)^n - 1), where P is the loan amount, r is the monthly interest rate (annual rate / 12 / 100), and n is the tenure in months. This is the same reducing-balance formula every Indian bank uses.",
  },
  {
    q: "Why is my last EMI installment sometimes a different amount?",
    a: "A real loan's final installment pays off exactly whatever principal is left, which is usually smaller than a regular EMI — this calculator's amortization schedule reflects that real-world behavior instead of assuming every installment is identical.",
  },
  {
    q: "Does paying extra every month actually save money?",
    a: "Yes — an extra monthly payment increases your effective EMI, which shortens the tenure and reduces total interest paid, since interest is charged only on the outstanding balance each month. Enter an extra amount above to see the exact months and interest saved.",
  },
];

export default function EmiCalculator() {
  const [principalText, setPrincipalText] = useState("2500000");
  const [rateText, setRateText] = useState("9");
  const [tenureYears, setTenureYears] = useState("20");
  const [extraMonthlyText, setExtraMonthlyText] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);

  const principal = Number(principalText) || 0;
  const rate = Number(rateText) || 0;
  const tenureMonths = Math.round((Number(tenureYears) || 0) * 12);
  const extraMonthly = Number(extraMonthlyText) || 0;

  const emi = useMemo(() => calculateEmi(principal, rate, tenureMonths), [principal, rate, tenureMonths]);
  const summary = useMemo(() => fullTenureSummary(principal, rate, tenureMonths, emi), [principal, rate, tenureMonths, emi]);
  const schedule = useMemo(() => buildAmortizationSchedule(principal, rate, tenureMonths, emi), [principal, rate, tenureMonths, emi]);
  const prepayment = useMemo(
    () => (extraMonthly > 0 ? withExtraMonthlyPayment(principal, rate, emi, extraMonthly) : null),
    [principal, rate, emi, extraMonthly],
  );

  const isValid = principal > 0 && tenureMonths > 0 && rate >= 0;

  useSeo({
    title: "Free EMI Calculator — Loan EMI, Interest & Amortization Schedule | Rupee Radar AI",
    description:
      "Calculate your home, car, or personal loan EMI instantly — see the exact monthly installment, total interest, a full month-by-month amortization schedule, and how much an extra monthly payment saves you.",
    canonical: "https://rupeeradarai.com/emi-calculator",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebApplication",
          name: "EMI Calculator",
          applicationCategory: "FinanceApplication",
          operatingSystem: "Any",
          offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
          description: "Free online EMI calculator for home, car, and personal loans with a full amortization schedule and prepayment savings.",
        },
        {
          "@type": "FAQPage",
          mainEntity: FAQ.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        },
      ],
    },
  });

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-2">EMI Calculator</h1>
      <p className="text-app-muted mb-8">
        Calculate your loan's monthly EMI, total interest, and full repayment schedule — free, instant, no signup.
        This is the exact same reducing-balance formula (and prepayment math) that powers the{" "}
        <Link to="/why-rupee-radar-ai" className="text-brand hover:underline">Rupee Radar AI app's</Link> Loan & EMI tracker.
      </p>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="glass-card p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-app-text mb-1">Loan amount (₹)</label>
            <input
              type="number"
              value={principalText}
              onChange={(e) => setPrincipalText(e.target.value)}
              className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-app-text mb-1">Interest rate (% per annum)</label>
            <input
              type="number"
              step="0.1"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-app-text mb-1">Tenure (years)</label>
            <input
              type="number"
              step="0.5"
              value={tenureYears}
              onChange={(e) => setTenureYears(e.target.value)}
              className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-app-text mb-1">
              Extra monthly payment (₹) <span className="text-app-muted font-normal">(optional — see prepayment savings)</span>
            </label>
            <input
              type="number"
              value={extraMonthlyText}
              onChange={(e) => setExtraMonthlyText(e.target.value)}
              className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text"
            />
          </div>
        </div>

        <div className="glass-card p-6">
          {isValid ? (
            <>
              <div className="mb-4">
                <div className="text-sm text-app-muted">Monthly EMI</div>
                <div className="text-3xl font-bold text-brand">₹{emi.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-app-muted">Principal amount</span>
                  <span className="font-medium">₹{principal.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-muted">Total interest payable</span>
                  <span className="font-medium">₹{summary.interestPaid.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex justify-between border-t border-app-border pt-2">
                  <span className="text-app-muted">Total payment (principal + interest)</span>
                  <span className="font-bold">₹{summary.totalPaid.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                </div>
              </div>

              {prepayment && (
                <div className="mt-5 pt-4 border-t border-app-border">
                  <h3 className="font-medium text-brand mb-2">With ₹{extraMonthly.toLocaleString("en-IN")} extra every month</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-app-muted">Loan closes in</span>
                      <span className="font-medium">{prepayment.monthsToClose} months ({prepayment.monthsSaved} months sooner)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-app-muted">Interest saved</span>
                      <span className="font-medium">₹{prepayment.interestSaved.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-app-muted text-sm">Enter a loan amount, rate, and tenure to see your EMI.</p>
          )}
        </div>
      </div>

      {isValid && schedule.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowSchedule((v) => !v)}
            className="text-sm font-medium text-brand hover:underline"
          >
            {showSchedule ? "Hide" : "Show"} month-by-month amortization schedule ({schedule.length} months)
          </button>
          {showSchedule && (
            <div className="glass-card mt-3 overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-app-surface">
                  <tr className="text-left text-app-muted">
                    <th className="px-3 py-2">Month</th>
                    <th className="px-3 py-2 text-right">Opening balance</th>
                    <th className="px-3 py-2 text-right">Interest</th>
                    <th className="px-3 py-2 text-right">Principal</th>
                    <th className="px-3 py-2 text-right">Payment</th>
                    <th className="px-3 py-2 text-right">Closing balance</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((row) => (
                    <tr key={row.monthIndex} className="border-t border-app-border">
                      <td className="px-3 py-1.5">{row.monthIndex}</td>
                      <td className="px-3 py-1.5 text-right">₹{row.openingBalance.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-1.5 text-right">₹{row.interestComponent.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-1.5 text-right">₹{row.principalComponent.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-1.5 text-right">₹{row.paymentAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-1.5 text-right">₹{row.closingBalance.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="mt-12">
        <h2 className="text-xl font-bold mb-4">Frequently asked questions</h2>
        <div className="space-y-4">
          {FAQ.map((item) => (
            <div key={item.q} className="glass-card p-5">
              <h3 className="font-medium mb-1">{item.q}</h3>
              <p className="text-sm text-app-muted">{item.a}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center mt-10">
        <a
          href="#download"
          className="inline-block bg-gradient-to-r from-purple to-blue text-white px-6 py-3 rounded-full font-semibold hover:opacity-90 transition-opacity"
        >
          Track this loan automatically in the app →
        </a>
      </p>
    </div>
  );
}
