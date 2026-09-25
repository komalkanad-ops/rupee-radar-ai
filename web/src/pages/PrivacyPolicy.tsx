import { useSeo } from "../lib/useSeo";

const SUPPORT_EMAIL = "support@rupeeradarai.com";
const LAST_UPDATED = "25 September 2026";

interface Section {
  heading: string;
  body: string[];
}

const sections: Section[] = [
  {
    heading: "What we collect from SMS, and what we don't",
    body: [
      "In short: reading and analyzing your bank/card SMS and notifications happens entirely on your phone, using on-device logic — the raw message text never leaves your device or reaches our servers. What does sync to your account (so it's available across your devices and after a reinstall) is the small set of details described below: the parsed transaction amount, merchant, category and payment method (plus any tags you choose to add to a transaction), plus your account info, and — only if you turn them on — a push-notification token and crash diagnostics. The one narrow exception, covered in the next paragraph, is a PRO-only fallback for the rare SMS our on-device rules can't read.",
      "Rupee Radar AI's core feature is reading bank and card transaction SMS on your device to automatically detect your expenses. On-device rule-based parsing extracts the amount, merchant name, category, and payment method (card, UPI, bank transfer, or wallet) from a message — that's what syncs to your account. The raw text of your SMS messages is never uploaded or stored on our servers.",
      "The one exception: if you're on Rupee Radar AI PRO and a message doesn't match our fast on-device rules (an unusual bank SMS format, for example), the app can send that single message to our backend, which forwards it to a third-party AI service (currently meshapi.ai, which proxies to an underlying language model) to extract the same amount/merchant/category fields. That message's text is used only to parse it and is not stored by our backend afterward. This is the only case where message text is processed off your device, and it may involve processing outside India by that third-party provider. This only happens for messages that already look like bank/card transaction alerts — we don't scan or transmit your other SMS messages, personal conversations, or OTPs.",
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
    heading: "Optional profile details",
    body: [
      "From Profile you can optionally tell us your city, income bracket, gender, and a broad age group (a 10-year bucket like \"25-34\" — never your date of birth). These are entirely optional, editable and deletable at any time, and are used only to power features like peer spending comparisons and persona-aware guidance within the app. We never share these details with any third party, and they're erased immediately when you delete your account.",
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
    heading: "People you split expenses with (Splits)",
    body: [
      "If you use Splits to share an expense with friends, the names you type for the other people, the amount each of them owes, who paid, and any note you add are stored against your account so the list is available on a new phone and after a reinstall. We don't ask for access to your contacts for this, we never contact those people or invite them to the app, and they don't get an account. This information is only shown to you inside the app and is deleted when you delete your account.",
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
      "• Cashfree Payments Private Limited — if you buy a PRO voucher on rupeeradarai.com/pricing, to process that payment. We send Cashfree the phone number and/or email you enter at checkout so it can create the payment; we never see, receive, or store your card, UPI ID, netbanking, or bank account details — those are entered directly on Cashfree's own checkout page and held only by Cashfree, subject to its own privacy policy.",
      "• Google Play Billing — if you subscribe to Rupee Radar AI PRO, to process and verify that subscription.",
      "• Google — for sign-in, and for the Places API used by the Nearby feature.",
      "• Firebase (Google) — to deliver push notifications, if enabled.",
      "• Sentry (Functional Software, Inc.) — to receive scrubbed crash and diagnostic reports (see above).",
    ],
  },
  {
    heading: "How long we keep your data",
    body: [
      "Account information (name, email/phone, city, income bracket, gender, age group) and synced transaction details are kept for as long as your account is active, so the app keeps working across devices and reinstalls. Push-notification device tokens are kept only while notifications are enabled. Crash and diagnostic reports are retained for at most 90 days. Website PRO-purchase order records (needed for payment audit and support) are kept as required by applicable Indian tax and accounting law even after a purchase is complete.",
      "Deleting your account (Settings → Delete account, or rupeeradarai.com/delete-account) erases the data described above immediately, except: your bug reports and feedback, which are kept but disowned (no longer linked to you), and anything we're legally required to retain (e.g. payment records) for the period the law requires.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      "You can permanently delete your account and all associated data at any time from inside the app: Settings → Delete account. This erases everything immediately and signs you out.",
      `If you can't access the app, email ${SUPPORT_EMAIL} from the address (or with the phone number) associated with your account and we'll process the deletion — always within 30 days. Full details, including exactly what is deleted and what is retained, are at rupeeradarai.com/delete-account.`,
      "Under India's Digital Personal Data Protection Act, 2023, you also have the right to access a summary of the personal data we hold about you and how it's been processed, to correct or update inaccurate or incomplete data, and to withdraw any consent you've given (e.g. for optional profile details or notifications) at any time — withdrawing consent doesn't affect the legality of anything already done based on it. Reach us at the contact below for any of these requests.",
    ],
  },
  {
    heading: "Grievance officer",
    body: [
      "In accordance with the Digital Personal Data Protection Act, 2023 and applicable Indian IT rules, our Grievance Officer is Kanad Jadhav. You can reach the Grievance Officer at " +
        SUPPORT_EMAIL +
        " for any complaint or grievance about how your personal data is handled. We aim to acknowledge grievances within 48 hours and resolve them within 30 days.",
      "If you're not satisfied with our response, you have the right to file a complaint with the Data Protection Board of India under the DPDP Act, 2023.",
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
