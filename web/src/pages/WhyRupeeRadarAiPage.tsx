import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useSeo } from "../lib/useSeo";
import WhyRupeeRadarAI from "../components/WhyRupeeRadarAI";

interface AppLink {
  key: string;
  label: string;
  url: string;
}

const comparisons = [
  { manual: "Manually copy every transaction into a spreadsheet", app: "Bank SMS auto-tracked, on-device" },
  { manual: "Guess which card earns the most at each store", app: "Told which card to use, every time" },
  { manual: "Forget which subscriptions you're still paying for", app: "Every recurring payment in one list" },
  { manual: "No idea what your actual net worth is", app: "Real net worth, updated as you go" },
];

export default function WhyRupeeRadarAiPage() {
  const [playStoreUrl, setPlayStoreUrl] = useState("https://play.google.com/store/apps");

  useEffect(() => {
    api<AppLink[]>("/config/links")
      .then((links) => {
        const playStore = links.find((l) => l.key === "play_store");
        if (playStore) setPlayStoreUrl(playStore.url);
      })
      .catch(() => {});
  }, []);

  useSeo({
    title: "Credit Card & Expense Tracker App — Rupee Radar AI vs Manual Tracking",
    description:
      "See how Rupee Radar AI compares to manually tracking credit card spending and expenses in a spreadsheet — automatic SMS parsing, card recommendations, and real net worth.",
    canonical: "https://rupeeradarai.com/why-rupee-radar-ai",
  });

  return (
    <div>
      <section className="max-w-5xl mx-auto px-6 py-16 text-center">
        <h1 className="text-3xl md:text-4xl font-bold mb-4">
          Stop tracking expenses by hand.
        </h1>
        <p className="text-lg text-app-muted max-w-2xl mx-auto mb-8">
          Rupee Radar AI replaces the spreadsheet — expenses, credit card recommendations, and net
          worth, tracked automatically from your bank SMS.
        </p>
        <a
          href={playStoreUrl}
          target="_blank"
          rel="noreferrer"
          className="bg-brand text-black px-6 py-3 rounded-full font-semibold hover:bg-brand-dark"
        >
          Download on Google Play
        </a>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <div className="glass-card overflow-hidden">
          <div className="grid grid-cols-2 bg-app-bg/60 text-sm font-medium text-app-muted">
            <div className="px-5 py-3 border-r border-app-border">Manual tracking</div>
            <div className="px-5 py-3 text-brand">Rupee Radar AI</div>
          </div>
          {comparisons.map((c) => (
            <div key={c.manual} className="grid grid-cols-2 border-t border-app-border text-sm">
              <div className="px-5 py-4 text-app-muted border-r border-app-border">{c.manual}</div>
              <div className="px-5 py-4 text-app-text font-medium">{c.app}</div>
            </div>
          ))}
        </div>
      </section>

      <WhyRupeeRadarAI />
    </div>
  );
}
