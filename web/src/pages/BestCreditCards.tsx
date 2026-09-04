import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useSeo } from "../lib/useSeo";
import DownloadBanner from "../components/DownloadBanner";

interface Card {
  id: string;
  name: string;
  network: string;
  isCashbackCard: boolean;
  joiningFeeInr: number;
  annualFeeInr: number;
  bank: { name: string };
}

// Slug -> real backend CardCategory enum value (backend/prisma/schema.prisma). Slugs are
// hyphenated/lowercase for readable URLs; CO_BRAND is the one that needs remapping.
const CATEGORY_SLUGS: Record<string, string> = {
  rewards: "REWARDS",
  cashback: "CASHBACK",
  travel: "TRAVEL",
  fuel: "FUEL",
  lifestyle: "LIFESTYLE",
  premium: "PREMIUM",
  business: "BUSINESS",
  "co-brand": "CO_BRAND",
};

const CATEGORY_LABELS: Record<string, string> = {
  rewards: "Rewards",
  cashback: "Cashback",
  travel: "Travel",
  fuel: "Fuel",
  lifestyle: "Lifestyle",
  premium: "Premium",
  business: "Business",
  "co-brand": "Co-Brand",
};

export default function BestCreditCards() {
  const { category } = useParams();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  const enumValue = category ? CATEGORY_SLUGS[category] : undefined;
  const label = category ? CATEGORY_LABELS[category] ?? category : "";

  const title = enumValue
    ? `Best ${label} Credit Cards in India — Rupee Radar AI`
    : "Best Credit Cards in India — Rupee Radar AI";
  const description = enumValue
    ? `Compare the best ${label.toLowerCase()} credit cards in India — fees, rewards, and lounge access, sourced and kept current by Rupee Radar AI.`
    : "Compare the best credit cards in India by category — Rupee Radar AI.";

  useSeo({
    title,
    description,
    canonical: `https://rupeeradarai.com/best-credit-cards/${category ?? ""}`,
  });

  useEffect(() => {
    if (!enumValue) return;
    setLoading(true);
    api<Card[]>(`/cards?category=${enumValue}`)
      .then(setCards)
      .finally(() => setLoading(false));
  }, [enumValue]);

  if (!enumValue) {
    return <p className="max-w-5xl mx-auto px-6 py-10 text-app-muted">Unknown category.</p>;
  }

  return (
    <div>
      <DownloadBanner />
      <div className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-2">Best {label} Credit Cards in India</h1>
        <p className="text-app-muted mb-6">
          Fees, rewards, and cashback for every {label.toLowerCase()} card we track — sourced and
          kept current by our team.
        </p>

        {loading && <p className="text-app-muted">Loading...</p>}
        {!loading && cards.length === 0 && (
          <p className="text-app-muted">No {label.toLowerCase()} cards in the catalog yet.</p>
        )}

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

        <p className="text-sm mt-8">
          <Link to="/cards" className="text-brand hover:underline">See every category →</Link>
        </p>
      </div>
    </div>
  );
}
