import { useSeo } from "../lib/useSeo";

const SUPPORT_EMAIL = "support@rupeeradarai.com";

const deleted = [
  "Your profile (name, email, phone, gender, city, persona)",
  "All synced transactions and the categories/merchants derived from your SMS",
  "Net worth snapshots, savings, loans, EMIs, recurring payments and bill history",
  "Lending/borrowing records, to-dos, parking tickets, products & warranties, wishlist items",
  "Household membership, referral code and coin balance",
  "Your PRO entitlement and device push-notification tokens",
];

const retained = [
  "Bug reports and feedback you submitted are kept but permanently disassociated from you (no name, email or phone) so we can still act on them",
  "Aggregate, non-identifying analytics counts that never contained your personal data",
  "Backend logs and crash/diagnostic reports (which never contain your name, email or phone, and are scrubbed of financial data) are purged on our normal rolling retention schedule — at most 90 days",
];

export default function DeleteAccount() {
  useSeo({
    title: "Delete your account & data — Rupee Radar AI",
    description:
      "How to delete your Rupee Radar AI account and all associated data, from inside the app or by contacting us.",
    canonical: "https://rupeeradarai.com/delete-account",
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold mb-4">Delete your account and data</h1>
      <p className="text-app-muted mb-8">
        Rupee Radar AI lets you permanently delete your account and everything stored under it. SMS
        parsing happens on your device and the raw text of your messages is never uploaded, so there
        is nothing to delete on our side beyond what is listed below.
      </p>

      <h2 className="text-lg font-semibold mb-2">Option 1 — from inside the app (immediate)</h2>
      <ol className="list-decimal list-inside text-app-muted space-y-1 mb-8">
        <li>Open Rupee Radar AI and sign in to the account you want to delete.</li>
        <li>
          Go to <span className="text-app-text font-medium">Settings</span> &rarr;{" "}
          <span className="text-app-text font-medium">Delete account</span>.
        </li>
        <li>Confirm in the dialog. Your account and data are erased right away and you are signed out.</li>
      </ol>

      <h2 className="text-lg font-semibold mb-2">Option 2 — by email</h2>
      <p className="text-app-muted mb-8">
        If you can&rsquo;t access the app, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=Account%20deletion%20request`} className="text-brand hover:underline">
          {SUPPORT_EMAIL}
        </a>{" "}
        from the email address (or mention the phone number) associated with your account and ask us
        to delete it. We verify ownership, process the deletion, and confirm once it&rsquo;s done —
        typically within a few business days and always within 30 days.
      </p>

      <h2 className="text-lg font-semibold mb-2">What gets deleted</h2>
      <ul className="list-disc list-inside text-app-muted space-y-1 mb-8">
        {deleted.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 className="text-lg font-semibold mb-2">What is retained, and why</h2>
      <ul className="list-disc list-inside text-app-muted space-y-1 mb-4">
        {retained.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="text-app-muted">
        Anything kept is either fully anonymised or never identified you in the first place. See our{" "}
        <a href="/privacy" className="text-brand hover:underline">
          Privacy Policy
        </a>{" "}
        for the complete picture.
      </p>
    </div>
  );
}
