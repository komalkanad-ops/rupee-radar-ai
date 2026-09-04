import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import { useSeo } from "../lib/useSeo";
import { Gauge } from "../components/charts/Gauge";
import WhyRupeeRadarAI from "../components/WhyRupeeRadarAI";
import FeatureTeasers from "../components/FeatureTeasers";
import AppShowcase from "../components/AppShowcase";
import Reveal from "../components/Reveal";

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Rupee Radar AI",
  url: "https://rupeeradarai.com/",
  description:
    "Rupee Radar AI tracks your expenses from SMS, tells you which credit card to use where, and shows your true net worth.",
};

interface AppLink {
  key: string;
  label: string;
  url: string;
}

const features = [
  { title: "SMS expense manager", desc: "Auto-tracks spends from bank SMS — search, filter by category, and a smart nudge to categorize anything auto-parsing couldn't handle. Correct a merchant once and it learns that category for good." },
  { title: "Credit card optimizer", desc: "See exactly which card earns the most, wherever you shop — with utilization alerts before any card gets maxed out." },
  { title: "Budgets & Goals", desc: "Set a monthly limit per category and watch the bar fill. Save towards a house, a car, an emergency fund — and get told exactly how much per month keeps you on track." },
  { title: "Financial Review & Money Leaks", desc: "A month / quarter / year report card with an A–F grade and a plain-English summary, plus an audit of forgotten subscriptions, bank fees and duplicate charges (PRO)." },
  { title: "Subscriptions, EMIs & SIPs", desc: "One place for every recurring payment you're committed to — auto-detected from your SMS." },
  { title: "Net worth, projection & job-loss runway", desc: "Your true net worth today, where it's headed in 1/3/5/10 years, and how long your savings would last if income stopped (PRO)." },
];

const proFeatures = [
  "Unlimited AI finance chat",
  "Financial Review — monthly/quarterly/yearly report card with an AI narrative",
  "Safety Net, Money Leaks & Spending Habits deep-dives",
  "Debt Freedom payoff planner + Net Worth projection",
  "Job-loss runway, Cash Flow Calendar, Tax-Saving Nudges & Family Vault",
  "Smarter SMS parsing for tricky bank formats",
];

// Sample data only — these two teasers are marketing previews of app-only features, not live
// figures. Real scores/challenges require an account and live in the Android app.
const sampleChallenges = [
  { title: "No-spend weekend", detail: "₹0 non-essential spend, Sat–Sun", progress: 0.7, badge: "🏆" },
  { title: "Save ₹5,000 this month", detail: "₹3,250 saved so far", progress: 0.65, badge: "💰" },
  { title: "3-month EMI streak", detail: "Every EMI paid on time", progress: 1, badge: "🔥" },
];

export default function Home() {
  const [playStoreUrl, setPlayStoreUrl] = useState("https://play.google.com/store/apps");

  useSeo({
    title: "Rupee Radar AI — Track spends, maximise credit card rewards",
    description:
      "Rupee Radar AI tracks your expenses from SMS, tells you which credit card to use where, and shows your true net worth. Free to browse online, full experience on Android.",
    canonical: "https://rupeeradarai.com/",
    jsonLd: organizationJsonLd,
  });

  useEffect(() => {
    api<AppLink[]>("/config/links")
      .then((links) => {
        const playStore = links.find((l) => l.key === "play_store");
        if (playStore) setPlayStoreUrl(playStore.url);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <section className="max-w-5xl mx-auto px-6 py-20 text-center relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-br from-purple/20 via-blue/10 to-transparent blur-3xl -z-10 animate-float-slow" />
        <h1
          className="text-4xl md:text-5xl font-bold mb-4 animate-fade-in-up"
          style={{ animationDelay: "0ms" }}
        >
          Every rupee, <span className="bg-gradient-to-r from-brand to-blue bg-clip-text text-transparent">radar-tracked.</span>
        </h1>
        <p
          className="text-lg text-app-muted max-w-2xl mx-auto mb-8 animate-fade-in-up"
          style={{ animationDelay: "120ms" }}
        >
          Rupee Radar AI tracks your spends from SMS, tells you the best credit card to use for
          every purchase, and shows your real net worth — all in one Android app.
        </p>
        <div
          className="flex items-center justify-center gap-4 flex-wrap animate-fade-in-up"
          style={{ animationDelay: "240ms" }}
          id="download"
        >
          <a
            href={playStoreUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("download_app_click", { location: "home_hero" })}
            className="bg-brand text-black px-6 py-3 rounded-full font-semibold hover:bg-brand-dark transition hover:scale-105 active:scale-95"
          >
            Download on Google Play
          </a>
          <Link to="/cards" className="text-app-text font-medium hover:text-brand transition-colors">
            Browse credit cards →
          </Link>
        </div>
      </section>

      <AppShowcase />

      <section className="max-w-5xl mx-auto px-6 py-12">
        <Reveal className="text-center mb-10">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">
            Turn good money habits into a game.
          </h2>
          <p className="text-app-muted max-w-xl mx-auto">
            A preview of what's waiting in the app — your own financial health score, streaks, and
            challenges with real rewards.
          </p>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <Reveal className="glass-card p-6 flex flex-col items-center text-center">
            <Gauge score={78} label="sample score" />
            <h3 className="font-semibold mt-3 mb-1">Financial Health Score</h3>
            <p className="text-sm text-app-muted">
              Weighted mostly on how much you save vs. spend — plus on-time EMIs and a diversified
              portfolio. Like a credit score, but for your whole financial life.
            </p>
          </Reveal>
          <Reveal delay={120} className="glass-card p-6">
            <h3 className="font-semibold mb-3">Challenges &amp; badges</h3>
            <div className="space-y-3">
              {sampleChallenges.map((c) => (
                <div key={c.title} className="bg-app-bg/60 rounded-lg p-3 border border-app-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">
                      <span className="mr-1.5">{c.badge}</span>{c.title}
                    </span>
                    <span className="text-xs text-app-muted">{c.detail}</span>
                  </div>
                  <div className="h-1.5 bg-app-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${Math.round(c.progress * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
        <p className="text-center mt-6">
          <a href="#download" className="text-brand font-medium hover:underline">
            Start your streak — download the app →
          </a>
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((f, i) => (
          <Reveal key={f.title} delay={(i % 2) * 100} className="glass-card p-6">
            <h3 className="font-semibold mb-1">{f.title}</h3>
            <p className="text-sm text-app-muted">{f.desc}</p>
          </Reveal>
        ))}
      </section>

      <FeatureTeasers />

      {/* PRO teaser — gold accent, matching the Android app's paywall redesign
          (ui/pro/ProPaywallScreen.kt), a distinct look from the rest of the site on purpose. */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <Reveal className="glass-card p-8 text-center shadow-[0_0_60px_-15px_#D4AF37]">
          <div className="w-16 h-16 rounded-full bg-gold mx-auto mb-4 flex items-center justify-center text-2xl">
            👑
          </div>
          <h2 className="text-2xl font-bold mb-1">Rupee Radar AI PRO</h2>
          <p className="text-gold font-bold text-lg mb-4">₹149/month or ₹999/year</p>
          <ul className="text-sm text-app-muted space-y-1.5 mb-6 max-w-sm mx-auto text-left">
            {proFeatures.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-gold">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <a
            href={playStoreUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block bg-gold text-black px-6 py-3 rounded-full font-semibold hover:opacity-90 transition hover:scale-105 active:scale-95"
          >
            Get PRO in the app →
          </a>
        </Reveal>
      </section>

      <WhyRupeeRadarAI />
    </div>
  );
}
