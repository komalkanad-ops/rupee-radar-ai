import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";

interface FeedbackItem {
  id: string;
  source: "APP" | "WEB";
  message: string;
  email: string | null;
  rating: number | null;
  status: "NEW" | "REVIEWED" | "RESOLVED";
  coinsAwarded: number | null;
  createdAt: string;
  user: { id: string; name: string | null; phone: string | null } | null;
}

const STATUS_OPTIONS = ["ALL", "NEW", "REVIEWED", "RESOLVED"] as const;

export default function Feedback() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("ALL");
  const toast = useToast();

  function reload() {
    const query = status === "ALL" ? "" : `?status=${status}`;
    api<FeedbackItem[]>(`/feedback${query}`).then(setItems);
  }

  useEffect(reload, [status]);

  async function updateStatus(id: string, next: FeedbackItem["status"]) {
    await api(`/feedback/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    toast.show(`Marked ${next.toLowerCase()}`);
    reload();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold text-brand-dark">Feedback</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Submitted from the app (authenticated, always awarded 100 coins) or the public website
        (no login there, so never coin-eligible).
      </p>

      <div className="space-y-3">
        {items.length === 0 && <p className="text-sm text-slate-400">Nothing here.</p>}
        {items.map((f) => (
          <div key={f.id} className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      f.source === "APP" ? "bg-brand/10 text-brand-dark" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {f.source === "APP" ? "App" : "Website"}
                  </span>
                  {f.rating != null && <span className="text-xs text-amber-600">{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}</span>}
                  {f.coinsAwarded != null && <span className="text-xs text-emerald-600">+{f.coinsAwarded} coins</span>}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      f.status === "NEW" ? "bg-amber-100 text-amber-700" : f.status === "REVIEWED" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {f.status}
                  </span>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{f.message}</p>
                <p className="text-xs text-slate-500 mt-2">
                  {f.user?.name || f.user?.phone || f.email || (f.source === "WEB" ? "Anonymous" : f.user?.id) || "Unknown"}
                  {" · "}
                  {new Date(f.createdAt).toLocaleString("en-IN")}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {f.status !== "REVIEWED" && (
                  <button
                    onClick={() => updateStatus(f.id, "REVIEWED")}
                    className="text-xs bg-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-300"
                  >
                    Mark reviewed
                  </button>
                )}
                {f.status !== "RESOLVED" && (
                  <button
                    onClick={() => updateStatus(f.id, "RESOLVED")}
                    className="text-xs bg-brand text-white px-3 py-1.5 rounded-md hover:bg-brand-dark"
                  >
                    Mark resolved
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
