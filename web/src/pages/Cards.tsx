import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useSeo } from "../lib/useSeo";
import DownloadBanner from "../components/DownloadBanner";

interface Card {
  id: string;
  name: string;
  network: string;
  category: string;
  isCashbackCard: boolean;
  joiningFeeInr: number;
  annualFeeInr: number;
  bank: { name: string };
}

const CATEGORIES = ["", "REWARDS", "CASHBACK", "TRAVEL", "FUEL", "LIFESTYLE", "PREMIUM", "BUSINESS", "CO_BRAND"];

export default function Cards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);

  useSeo({
    title: "Compare Indian Credit Cards — Rupee Radar AI",
    description:
      "Compare credit cards from every major Indian bank — fees, rewards, cashback, and lounge access, sourced and kept current by Rupee Radar AI.",
    canonical: "https://rupeeradarai.com/cards",
  });

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    setLoading(true);
    api<Card[]>(`/cards?${params}`)
      .then(setCards)
      .finally(() => setLoading(false));
  }, [search, category]);

  return (
    <div>
      <DownloadBanner />
      <div className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-2">Compare Indian Credit Cards</h1>
        <p className="text-app-muted mb-6">Fees, rewards, and cashback — sourced and kept current by our team.</p>

        <div className="flex gap-3 mb-6">
          <input
            placeholder="Search by bank or card..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm flex-1 max-w-sm text-app-text placeholder:text-app-muted"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c || "All categories"}</option>
            ))}
          </select>
        </div>

        {loading && <p className="text-app-muted">Loading...</p>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((c) => (
            <Link
              key={c.id}
              to={`/cards/${c.id}`}
              className="glass-card p-5 hover:border-brand transition"
            >
              <p className="text-xs text-app-muted">{c.bank.name}</p>
              <h3 className="font-semibold">{c.name}</h3>
              <p className="text-sm text-app-muted mt-1">
                Joining ₹{c.joiningFeeInr.toLocaleString("en-IN")} · Annual ₹{c.annualFeeInr.toLocaleString("en-IN")}
                {c.isCashbackCard && " · Cashback"}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
