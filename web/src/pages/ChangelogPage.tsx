import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useSeo } from "../lib/useSeo";

type HighlightType = "FEATURE" | "FIX" | "IMPROVEMENT";

interface Highlight {
  type: HighlightType;
  platform?: string;
  text: string;
}

interface ChangelogEntry {
  id: string;
  version: string;
  releaseDate: string;
  platforms: string[];
  summary: string | null;
  highlights: Highlight[];
}

const TYPE_LABEL: Record<HighlightType, string> = {
  FEATURE: "New",
  FIX: "Fixed",
  IMPROVEMENT: "Improved",
};

const TYPE_CLASS: Record<HighlightType, string> = {
  FEATURE: "bg-brand/20 text-brand",
  FIX: "bg-red-500/20 text-red-400",
  IMPROVEMENT: "bg-sky-500/20 text-sky-400",
};

export default function ChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useSeo({
    title: "What's New — Rupee Radar AI Changelog",
    description: "Every feature, fix, and improvement shipped to Rupee Radar AI's app, website, and admin console, in order.",
    canonical: "https://rupeeradarai.com/changelog",
  });

  useEffect(() => {
    api<ChangelogEntry[]>("/changelog")
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold mb-2">What's New</h1>
      <p className="text-app-muted mb-10">
        Everything we've shipped to Rupee Radar AI — the app, this website, and the tools behind
        them — in one place.
      </p>

      {loading ? (
        <p className="text-app-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-app-muted">Nothing published yet — check back soon.</p>
      ) : (
        <div className="space-y-8">
          {entries.map((entry) => (
            <div key={entry.id} className="glass-card p-6">
              <div className="flex items-baseline justify-between gap-4 mb-1">
                <h2 className="text-lg font-semibold">v{entry.version}</h2>
                <span className="text-sm text-app-muted whitespace-nowrap">
                  {new Date(entry.releaseDate).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
                </span>
              </div>
              <div className="flex gap-1.5 mb-3">
                {entry.platforms.map((p) => (
                  <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-app-border text-app-muted capitalize">
                    {p}
                  </span>
                ))}
              </div>
              {entry.summary && <p className="text-app-text mb-3">{entry.summary}</p>}
              <ul className="space-y-1.5">
                {entry.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={`shrink-0 mt-0.5 text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_CLASS[h.type]}`}>
                      {TYPE_LABEL[h.type]}
                    </span>
                    <span className="text-app-text">{h.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
