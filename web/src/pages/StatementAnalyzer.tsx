import { useSeo } from "../lib/useSeo";

/**
 * Statement Analyzer is being spun out into its own dedicated app (owner's call, 2026-08-29). Until
 * then this page is a "Coming Soon" placeholder. The previous working upload + analysis UI lives in
 * git history and should seed the standalone app; the backend `/statements/analyze` route stays.
 */
export default function StatementAnalyzer() {
  useSeo({
    title: "Statement Analyzer — Coming Soon — Rupee Radar AI",
    description:
      "A dedicated Rupee Radar AI statement analyzer is on the way — it will read your full credit-card and bank statements and sync the transactions straight into the app.",
    canonical: "https://rupeeradarai.com/statement-analyzer",
  });

  return (
    <div className="max-w-2xl mx-auto px-6 py-20 text-center">
      <span className="inline-block rounded-full bg-brand/15 text-brand text-xs font-semibold px-3 py-1 mb-5">
        Coming soon
      </span>
      <h1 className="text-3xl font-bold mb-4">Statement Analyzer</h1>
      <p className="text-app-muted mb-6">
        We're building a dedicated app for statement analysis. It will read your full credit-card and
        bank statements and hand the transactions straight back to Rupee Radar AI — so your spending
        history stays complete without any manual entry.
      </p>
      <p className="text-app-muted">
        In the meantime, the app already tracks spending automatically from your transaction SMS.
      </p>
    </div>
  );
}
