import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Donut } from "../components/charts/Donut";
import { TrendChart } from "../components/charts/TrendChart";
import { SkeletonBlock } from "../components/Skeleton";
import { useToast } from "../components/Toast";

interface Card {
  id: string;
  isCashbackCard: boolean;
  category: string;
  bank: { name: string };
}
interface Correction {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}
interface AdminUser {
  id: string;
  isPro: boolean;
  deviceCount: number;
  smsTransactionCount: number;
}
interface PushStats {
  totalDevices: number;
  registeredTokens: number;
  optedIn: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  REWARDS: "#6366f1",
  CASHBACK: "#22c55e",
  TRAVEL: "#0ea5e9",
  FUEL: "#f97316",
  LIFESTYLE: "#ec4899",
  PREMIUM: "#a855f7",
  BUSINESS: "#64748b",
  CO_BRAND: "#eab308",
};

export default function Dashboard() {
  const toast = useToast();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [corrections, setCorrections] = useState<Correction[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [pushStats, setPushStats] = useState<PushStats | null>(null);
  const [recategorizing, setRecategorizing] = useState(false);

  // Backfills the `category` field on existing SmsTransaction rows that are still uncategorized,
  // using whatever the current merchantCategorizer.ts taxonomy knows — safe to re-run any time
  // that taxonomy is extended, since it only ever fills in nulls.
  async function recategorize() {
    setRecategorizing(true);
    try {
      const result = await api<{ scanned: number; updated: number }>("/sms/recategorize", { method: "POST" });
      toast.show(`Scanned ${result.scanned} uncategorized transactions, updated ${result.updated}.`);
    } catch {
      toast.show("Recategorize failed.", "error");
    } finally {
      setRecategorizing(false);
    }
  }

  useEffect(() => {
    api<Card[]>("/cards").then(setCards).catch(() => setCards([]));
    api<Correction[]>("/corrections").then(setCorrections).catch(() => setCorrections([]));
    api<AdminUser[]>("/users").then(setUsers).catch(() => setUsers([]));
    api<PushStats>("/push/stats").then(setPushStats).catch(() => setPushStats(null));
  }, []);

  const loading = !cards || !corrections || !users;

  const banks = new Set((cards ?? []).map((c) => c.bank?.name)).size;
  const pending = (corrections ?? []).filter((c) => c.status === "PENDING").length;
  const proUsers = (users ?? []).filter((u) => u.isPro).length;
  const totalSms = (users ?? []).reduce((sum, u) => sum + u.smsTransactionCount, 0);

  const stats = [
    { label: "Cards in catalog", value: cards?.length ?? 0 },
    { label: "Banks / issuers", value: banks },
    { label: "Pending corrections", value: pending },
    { label: "PRO users", value: proUsers },
    { label: "Registered devices", value: pushStats?.totalDevices ?? 0 },
    { label: "SMS transactions parsed", value: totalSms.toLocaleString("en-IN") },
  ];

  const byCategory = (cards ?? []).reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1;
    return acc;
  }, {});
  const donutData = Object.entries(byCategory).map(([label, value]) => ({
    label,
    value,
    color: CATEGORY_COLORS[label] ?? "#94a3b8",
  }));

  const correctionsByStatus = ["PENDING", "APPROVED", "REJECTED"].map((status) => ({
    label: status.slice(0, 4),
    value: (corrections ?? []).filter((c) => c.status === status).length,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-brand-dark">Overview</h1>
        <button
          onClick={recategorize}
          disabled={recategorizing}
          className="text-xs bg-brand text-white px-3 py-1.5 rounded-md hover:bg-brand-dark disabled:opacity-50"
        >
          {recategorizing ? "Recategorizing…" : "Recategorize transactions"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonBlock key={i} className="h-24 rounded-xl" />)
          : stats.map((s) => (
              <div key={s.label} className="bg-white rounded-xl shadow-sm p-5">
                <div className="text-2xl font-semibold text-brand-dark">{s.value}</div>
                <div className="text-xs text-slate-500 mt-1">{s.label}</div>
              </div>
            ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-medium mb-4">Cards by category</h2>
          {loading ? <SkeletonBlock className="h-40" /> : donutData.length === 0 ? (
            <p className="text-sm text-slate-400">No cards yet.</p>
          ) : (
            <Donut data={donutData} />
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-medium mb-4">Corrections by status</h2>
          {loading ? <SkeletonBlock className="h-40" /> : (
            <TrendChart data={correctionsByStatus} variant="bar" color="#6366f1" />
          )}
        </div>
      </div>
    </div>
  );
}
