import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useSeo } from "../lib/useSeo";
import DownloadBanner from "../components/DownloadBanner";

interface Card {
  id: string;
  name: string;
  bank: { name: string };
  network: string;
  category: string;
  isCashbackCard: boolean;
  joiningFeeInr: number;
  annualFeeInr: number;
  feeWaiverCondition: string | null;
  rewardSpendPerPoint: string | null;
  loungeAccess: string | null;
  fuelSurchargeWaiver: string | null;
  welcomeBenefits: string[];
  milestoneBenefits: string[];
  applyUrl: string | null;
}

export default function CardDetail() {
  const { id } = useParams();
  const [card, setCard] = useState<Card | null>(null);

  useEffect(() => {
    api<Card>(`/cards/${id}`).then(setCard);
  }, [id]);

  const title = card
    ? `${card.name} (${card.bank.name}) — Fees, Rewards & Benefits | Rupee Radar AI`
    : "Credit Card Details — Rupee Radar AI";
  const description = card
    ? `${card.name} from ${card.bank.name}: joining fee ₹${card.joiningFeeInr.toLocaleString("en-IN")}, annual fee ₹${card.annualFeeInr.toLocaleString("en-IN")}. Compare rewards, lounge access, and benefits.`
    : "Credit card fees, rewards, and benefits — Rupee Radar AI.";

  useSeo({
    title,
    description,
    canonical: `https://rupeeradarai.com/cards/${id}`,
    jsonLd: card
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          name: card.name,
          brand: { "@type": "Organization", name: card.bank.name },
          category: card.category,
          description,
        }
      : undefined,
  });

  if (!card) return <p className="max-w-5xl mx-auto px-6 py-10 text-app-muted">Loading...</p>;

  const row = (label: string, value: string | number | null) => (
    <div className="flex justify-between py-2 border-b border-app-border text-sm">
      <span className="text-app-muted">{label}</span>
      <span className="font-medium text-right">{value ?? "—"}</span>
    </div>
  );

  return (
    <div>
      <DownloadBanner />
      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link to="/cards" className="text-sm text-brand hover:underline">← All cards</Link>
        <p className="text-sm text-app-muted mt-3">{card.bank.name}</p>
        <h1 className="text-3xl font-bold mb-6">{card.name}</h1>

        {card.applyUrl && (
          <a
            href={card.applyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block bg-brand text-black px-5 py-2.5 rounded-full font-semibold hover:bg-brand-dark mb-6"
          >
            Apply now →
          </a>
        )}

        <div className="glass-card p-5 mb-6">
          {row("Network", card.network)}
          {row("Category", card.category)}
          {row("Cashback card", card.isCashbackCard ? "Yes" : "No")}
          {row("Joining fee", `₹${card.joiningFeeInr.toLocaleString("en-IN")}`)}
          {row("Annual fee", `₹${card.annualFeeInr.toLocaleString("en-IN")}`)}
          {row("Fee waiver", card.feeWaiverCondition)}
          {row("Reward rate", card.rewardSpendPerPoint)}
          {row("Lounge access", card.loungeAccess)}
          {row("Fuel surcharge waiver", card.fuelSurchargeWaiver)}
        </div>

        <div className="glass-card p-5">
          <h2 className="font-medium mb-2">Welcome benefits</h2>
          <ul className="text-sm list-disc list-inside mb-4 text-app-muted">
            {card.welcomeBenefits?.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          <h2 className="font-medium mb-2">Milestone benefits</h2>
          <ul className="text-sm list-disc list-inside text-app-muted">
            {card.milestoneBenefits?.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>

        <p className="text-xs text-app-muted mt-6">
          Track spends against this card, get reminders, and compare live against your other cards
          in the Rupee Radar AI Android app.
        </p>
      </div>
    </div>
  );
}
