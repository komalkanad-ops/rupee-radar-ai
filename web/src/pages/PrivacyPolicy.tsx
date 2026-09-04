import { useSeo } from "../lib/useSeo";

const SUPPORT_EMAIL = "support@rupeeradarai.com";
const LAST_UPDATED = "3 September 2026";

interface Section {
  heading: string;
  body: string[];
}

const sections: Section[] = [
  {
    heading: "What we collect from SMS, and what we don't",
    body: [
      "Rupee Radar AI's core feature is reading bank and card transaction SMS on your device to automatically detect your expenses. On-device rule-based parsing extracts the amount, merchant name, category, and payment method (card, UPI, bank transfer, or wallet) from a message — that's what syncs to your account. The raw text of your SMS messages is never uploaded or stored on our servers.",
      "The one exception: if you're on Rupee Radar AI PRO and a message doesn't match our fast on-device rules (an unusual bank SMS format, for example), the app can send that single message to our backend, which forwards it to a third-party AI service (currently meshapi.ai, which proxies to an underlying language model) to extract the same amount/merchant/category fields. That message's text is used only to parse it and is not stored by our backend afterward. This only happens for messages that already look like bank/card transaction alerts — we don't scan or transmit your other SMS messages, personal conversations, or OTPs.",
      "We only ever request SMS access to detect financial transactions — this is core to the app's purpose as an SMS-based budgeting and expense tracker.",
    ],
  },
  {
    heading: "Notification access (optional alternative to SMS)",
    body: [
      "Instead of, or in addition to, SMS access, you can let Rupee Radar AI read notifications to detect transactions. If you turn this on, the app only reads notifications posted by a fixed built-in list of banking, UPI and card apps — notifications from messaging, email, social or any other app are never read. As with SMS, parsing happens on your device and only the amount, merchant and category are synced to your account; the notification text itself is never uploaded. You grant this in Android's notification-access settings and can revoke it there or in the app at any time.",
    ],
  },
  {
    heading: "Account information",
    body: [
      "Rupee Radar AI requires an account so your data is protected and can sync across your devices and reinstalls. When you sign in with Google or your phone number, we store your name, email or phone number, and a unique account ID. SMS and notification parsing still happens on your device regardless.",
    ],
  },
  {
    heading: "Location",
    body: [
      "If you use the \"Nearby\" feature to find stores that earn extra rewards on your cards, we request your device location (only while you're using that feature) and send your coordinates to Google's Places API to find nearby merchants. Location is not stored against your account beyond that request.",
    ],
  },
  {
    heading: "Contacts (Lending Tracker)",
    body: [
      "If you use the Lending Tracker to record money you've lent to someone, you can optionally pick a contact from your device to attach their name and phone number to that record. We only access the single contact you explicitly pick — we never request broad access to your contacts list, and no contacts permission is requested by the app. The name and phone number you attach are stored against that lending record so you can keep track of who owes you money; they're only used for display within the app and any reminder notifications you set.",
    ],
  },
  {
    heading: "Push notifications",
    body: [
      "If you enable notifications (for reminders like an upcoming bill or an expected loan repayment), we store a device token used only to deliver those notifications to you.",
    ],
  },
  {
    heading: "Crash and diagnostic data",
    body: [
      "When the app crashes or hits an error, we collect a diagnostic report — the error type and stack trace, the app version, your device model and Android version, a random per-install identifier and your account ID (never your name, email or phone number) — so we can find and fix the problem. This is used only for app stability and support, and is never used for advertising or sold.",
      "Before any report leaves your device it is automatically scrubbed of amounts, phone numbers, card and account numbers, and email addresses. We do not attach screenshots, screen recordings or the contents of your SMS or notifications to crash reports.",
      "These reports are processed for us by Sentry (Functional Software, Inc.), a third-party error-monitoring service, and are also stored in our own backend. You can also trigger a diagnostic report yourself from Settings → Send diagnostics when contacting support. Reports are retained for at most 90 days.",
    ],
  },
  {
    heading: "Who we share data with",
    body: [
      "We don't sell your data. We share the minimum necessary data with the following service providers, only for the purpose of providing the feature you're using:",
      "• meshapi.ai — PRO-tier AI-assisted SMS parsing (see above).",
      "• Setu — if you choose to link a bank account, to securely fetch your account-level transaction data with your consent.",
      "• Razorpay — if you make an in-app bill payment, to process that payment.",
      "• Google Play Billing — if you subscribe to Rupee Radar AI PRO, to process and verify that subscription.",
      "• Google — for sign-in, and for the Places API used by the Nearby feature.",
      "• Firebase (Google) — to deliver push notifications, if enabled.",
      "• Sentry (Functional Software, Inc.) — to receive scrubbed crash and diagnostic reports (see above).",
    ],
  },
  {
    heading: "Your rights",
    body: [
      "You can permanently delete your account and all associated data at any time from inside the app: Settings → Delete account. This erases everything immediately and signs you out.",
      `If you can't access the app, email ${SUPPORT_EMAIL} from the address (or with the phone number) associated with your account and we'll process the deletion — always within 30 days. Full details, including exactly what is deleted and what is retained, are at rupeeradarai.com/delete-account.`,
    ],
  },
  {
    heading: "Contact us",
    body: [`Questions about this policy or your data? Email us at ${SUPPORT_EMAIL}.`],
  },
];

export default function PrivacyPolicy() {
  useSeo({
    title: "Privacy Policy — Rupee Radar AI",
    description: "How Rupee Radar AI collects, uses, and protects your data, including SMS-based expense tracking.",
    canonical: "https://rupeeradarai.com/privacy",
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
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
