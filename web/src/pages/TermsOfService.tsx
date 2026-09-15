import { useSeo } from "../lib/useSeo";

const SUPPORT_EMAIL = "support@rupeeradarai.com";
const LAST_UPDATED = "14 September 2026";

interface Section {
  heading: string;
  body: string[];
}

// Standard terms for a personal-finance / expense-tracking app, written to match what this app
// actually does (SMS-based tracking, optional sign-in, Play Billing PRO subscription, no real
// investment/financial advice) rather than generic boilerplate — cross-references the real Privacy
// Policy instead of duplicating its data-handling detail.
const sections: Section[] = [
  {
    heading: "Agreement to these terms",
    body: [
      "These Terms of Service (\"Terms\") govern your use of the Rupee Radar AI mobile app and website (together, the \"Service\"), operated by Rupee Radar AI. By creating an account, using the app without signing in, or otherwise accessing the Service, you agree to these Terms. If you don't agree, please don't use the Service.",
      "You must be at least 18 years old, or the age of legal majority in your jurisdiction, to use the Service.",
    ],
  },
  {
    heading: "What Rupee Radar AI is — and isn't",
    body: [
      "Rupee Radar AI is a personal-finance and expense-tracking tool. It reads bank and card transaction SMS on your device to automatically detect expenses, tells you which of your saved credit cards earns the most at a given merchant based on publicly available card terms, and shows analytics like net worth, spending trends, and a financial health score.",
      "Rupee Radar AI is not a bank, a lender, a broker, a registered investment adviser, or a chartered accountant. Nothing in the app — including card recommendations, the financial health score, the job-loss runway calculator, tax-saving nudges, or the savings tracker — is financial, investment, tax, or legal advice. Card reward-rate estimates are calculated from publicly stated terms and are estimates, not guarantees; always confirm current terms with your card issuer before relying on them for a purchase decision. Consult a qualified professional before making financial decisions.",
    ],
  },
  {
    heading: "Your account",
    body: [
      "You can use the core features of Rupee Radar AI without creating an account, via a private, on-device profile. If you choose to sign in (with Google or your phone number), you're responsible for keeping your credentials secure and for all activity under your account. Tell us right away at " +
        SUPPORT_EMAIL +
        " if you suspect unauthorized access.",
      "You're responsible for the accuracy of information you manually enter (transactions, loans, lending records, savings instruments, and similar). Rupee Radar AI can't verify data you enter yourself.",
    ],
  },
  {
    heading: "SMS access and your data",
    body: [
      "Core features depend on reading transaction-related SMS on your device to detect expenses automatically. What we collect, how it's processed (including the limited, opt-in case where a PRO user's unparsed message is sent to a third-party AI service for parsing), and your rights over it are all covered in full in our Privacy Policy, which forms part of these Terms. By using the Service you also agree to the Privacy Policy.",
    ],
  },
  {
    heading: "Rupee Radar AI PRO (subscriptions and vouchers)",
    body: [
      "PRO unlocks features like the job-loss runway calculator, the predictive cash-flow calendar, tax-saving nudges, Family Vault, AI-assisted SMS parsing, and quarterly narrative summaries. You can get PRO two ways: (1) an in-app subscription billed and processed entirely through Google Play Billing, or (2) a one-time Weekly/Monthly/Yearly voucher purchased on rupeeradarai.com/pricing and redeemed in the app. In neither case do we ever see, receive, or store your card, UPI, or bank account details.",
      "Website voucher purchases are processed entirely by Cashfree Payments Private Limited (\"Cashfree\"), an RBI-authorised, independent third-party payment gateway — not by Rupee Radar AI. We only receive confirmation that a payment succeeded (and the phone/email you provided at checkout) from Cashfree; your card, UPI ID, netbanking credentials, and any other payment-instrument details are entered directly on Cashfree's own checkout page and are never transmitted to or stored by Rupee Radar AI. Rupee Radar AI is not responsible for, and disclaims all liability arising from, any loss, unauthorised transaction, fraud, or security incident involving your payment instrument, bank account, or card — for any such issue, or any dispute about a specific payment (a failed charge, a duplicate charge, an unauthorised transaction, or a refund), contact Cashfree directly using the details on your payment receipt or at cashfree.com, in addition to reaching us at " +
        SUPPORT_EMAIL +
        " if you also need help on our side (e.g. a voucher that didn't redeem correctly).",
      "A website voucher is a one-time code tied to the phone number and/or email you provide at checkout, redeemable exactly once for the purchased duration of PRO access. It has no cash value, isn't transferable once redeemed, and isn't refundable except where required by law or at our discretion for a demonstrable technical failure on our side.",
      "Subscription pricing is shown before purchase and may change; we'll give reasonable notice of price changes for existing subscribers where required by law. Play Store subscriptions renew automatically until cancelled from Google Play's subscription settings — cancelling stops future renewals but doesn't refund the current billing period, and Play Store refunds follow Google Play's own refund policy, not ours.",
    ],
  },
  {
    heading: "Rewards, coins, and vouchers",
    body: [
      "Coins earned through challenges, referrals, or feedback submissions have no cash value and can only be redeemed for vouchers within the app, subject to availability. We reserve the right to adjust the coin economy (earning rates, available vouchers) at any time, and to withhold or reverse coins earned through fraud, abuse, or violation of these Terms.",
      "From time to time we may offer a single, shared promotional code redeemable once per account for a short (currently one day) trial of PRO. It has no cash value, can't be combined with other offers, doesn't apply if you already have active PRO access, and may be changed, paused, or withdrawn at any time without notice.",
      "Referrals: both the referrer and the new sign-up must be real (non-anonymous) accounts. When a new sign-up redeems a valid code, the referrer currently earns 500 coins and 1 day of PRO access per unique referral, credited on top of any existing PRO time, up to 30 credited referrals per referrer per day — there's no overall limit to how many times you can earn this by referring genuinely new users over time, which is what lets continued referring extend PRO access indefinitely; the daily figure is an anti-abuse safeguard, not a target most real referring ever reaches. To keep this fair, a single device can complete at most one referral redemption ever, regardless of how many accounts are used on it, and self-referral is not allowed. We may withhold, reverse, or reclaim coins or PRO time granted through fake accounts, device manipulation, or any other attempt to abuse the referral system, and may change the referral reward amounts, caps, or rules at any time without notice.",
    ],
  },
  {
    heading: "Acceptable use",
    body: [
      "Don't use the Service to: violate any law; attempt to gain unauthorized access to our systems or another user's account; reverse-engineer, scrape, or resell the Service; upload malicious code; or manipulate the rewards/referral system through fake accounts or fraudulent activity. We may suspend or terminate accounts that violate this section.",
    ],
  },
  {
    heading: "Third-party services",
    body: [
      "The Service integrates with third-party providers to deliver specific features — Google (sign-in, Play Billing, Places API), Setu (optional bank account linking), Razorpay (in-app bill payments), Cashfree Payments (website PRO-voucher purchases — see the section above), meshapi.ai (PRO SMS parsing), and Firebase (push notifications). Your use of features backed by these providers is also subject to their own terms, including Cashfree's own terms of service and privacy policy at cashfree.com. We aren't responsible for the availability, accuracy, or security of third-party services, including any payment gateway.",
      "Card details, bank names, fees, and reward terms shown in the credit card catalog are sourced from publicly available information and kept reasonably up to date, but issuers can change terms at any time without notice to us — always verify current terms directly with your card issuer before relying on them.",
    ],
  },
  {
    heading: "Disclaimers and limitation of liability",
    body: [
      "The Service is provided \"as is\" and \"as available,\" without warranties of any kind, express or implied, including accuracy, reliability, or fitness for a particular purpose. SMS parsing is heuristic and can occasionally misread an amount, merchant, or category — always cross-check important figures against your actual bank statement.",
      "To the fullest extent permitted by law, Rupee Radar AI and its operator won't be liable for any indirect, incidental, or consequential damages arising from your use of the Service, including financial decisions made based on information the app shows you, or any loss, unauthorised transaction, or fraud connected to a payment made through a third-party gateway (see \"Rupee Radar AI PRO\" above — Cashfree and Google Play Billing are independent, regulated payment processors, and payment-instrument security is between you and them). Our total liability for any claim relating to the Service is limited to the amount you paid us (if any) in the 12 months before the claim arose.",
    ],
  },
  {
    heading: "Termination",
    body: [
      "You can stop using the Service and delete your account at any time by emailing " +
        SUPPORT_EMAIL +
        ". We may suspend or terminate your access if you violate these Terms, or discontinue the Service (or any feature) at any time — we'll try to give reasonable notice for anything that isn't an emergency security or legal issue.",
    ],
  },
  {
    heading: "Changes to these terms",
    body: [
      "We may update these Terms from time to time. We'll update the \"Last updated\" date below, and for material changes we'll make a reasonable effort to notify you in-app. Continuing to use the Service after changes take effect means you accept the updated Terms.",
    ],
  },
  {
    heading: "Governing law",
    body: [
      "These Terms are governed by the laws of India, without regard to conflict-of-law principles. Any dispute arising from these Terms or the Service will be subject to the exclusive jurisdiction of the courts of India.",
    ],
  },
  {
    heading: "Contact us",
    body: [`Questions about these Terms? Email us at ${SUPPORT_EMAIL}.`],
  },
];

export default function TermsOfService() {
  useSeo({
    title: "Terms of Service — Rupee Radar AI",
    description: "The terms governing your use of Rupee Radar AI's app and website.",
    canonical: "https://rupeeradarai.com/terms",
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold mb-2">Terms of Service</h1>
      <p className="text-sm text-app-muted mb-8">Last updated {LAST_UPDATED}</p>

      <div className="space-y-8">
        {sections.map((section) => (
          <div key={section.heading}>
            <h2 className="text-lg font-semibold mb-2">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="text-app-muted mb-2 last:mb-0">
                {paragraph}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
