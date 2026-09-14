import { useSeo } from "../lib/useSeo";

const SUPPORT_EMAIL = "support@rupeeradarai.com";

const faqs = [
  {
    q: "Does Rupee Radar AI read my bank SMS or transactions on a server?",
    a: "SMS parsing happens on your device first. Only the transaction details (amount, merchant, category) sync to your account — never the raw message. The one exception: PRO's AI-assisted parsing sends a message our fast on-device rules couldn't read to our secure parsing service, so it can still be tracked. See our Privacy Policy for the full details.",
  },
  {
    q: "Do I need to sign in to use the app?",
    a: "Yes — sign in with Google or your phone number so your data stays protected and syncs across your devices and reinstalls. SMS and notification parsing still happens entirely on your device.",
  },
  {
    q: "What's included in Rupee Radar AI PRO?",
    a: "PRO unlocks the job-loss runway calculator, smarter AI-assisted SMS parsing, insight narrative summaries, the predictive cash-flow calendar, tax-saving nudges, Family Vault, and Live Offers. Core expense tracking, budgets, and your health score are always free.",
  },
  {
    q: "I paid for PRO on the website but something went wrong — what do I do?",
    a: `Email us at ${SUPPORT_EMAIL} with your order id or the phone/email you paid with and we'll sort it out. Note that payments on rupeeradarai.com/pricing are processed entirely by Cashfree Payments, an independent, RBI-authorised third-party gateway — we never see or store your card, UPI, or bank details. For a specific transaction problem (a failed charge, a duplicate charge, an unauthorised transaction, or a refund), please also contact Cashfree directly via your payment receipt or their grievance redressal page at cashfree.com — Rupee Radar AI isn't able to see or act on the payment-instrument side of a transaction, only on whether your PRO voucher redeemed correctly.`,
  },
  {
    q: "How do referral coins and vouchers work?",
    a: "Share your referral code from the app's Rewards screen — when a friend signs up with it, you both get coins. Coins can be redeemed for vouchers in the same screen; redemptions are reviewed and fulfilled by our team, and you'll be notified once yours is ready.",
  },
  {
    q: "How do I delete my account or data?",
    a: `Open the app and go to Settings → Delete account to erase everything immediately, or see rupeeradarai.com/delete-account for the full details (including how to request deletion by email at ${SUPPORT_EMAIL} if you can't access the app).`,
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function Support() {
  useSeo({
    title: "Support & FAQ — Rupee Radar AI",
    description: "Answers to common questions about Rupee Radar AI — privacy, PRO features, referral coins, and account deletion.",
    canonical: "https://rupeeradarai.com/support",
    jsonLd: faqJsonLd,
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold mb-4">Support</h1>
      <p className="text-app-muted mb-8">
        Can't find what you're looking for below? Reach us directly at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
          {SUPPORT_EMAIL}
        </a>{" "}
        — we typically reply within a couple of business days.
      </p>

      <div className="space-y-6">
        {faqs.map((item) => (
          <div key={item.q}>
            <h2 className="text-lg font-semibold mb-1">{item.q}</h2>
            <p className="text-app-muted">{item.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
