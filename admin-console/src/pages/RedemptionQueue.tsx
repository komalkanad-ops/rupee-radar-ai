import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";

interface Redemption {
  id: string;
  coinsCost: number;
  status: string;
  fulfillmentNote: string | null;
  createdAt: string;
  voucher: { title: string };
  user: { id: string; name: string | null; email: string | null; phone: string | null };
}

export default function RedemptionQueue() {
  const [items, setItems] = useState<Redemption[]>([]);
  const [status, setStatus] = useState("PENDING_FULFILLMENT");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const toast = useToast();

  function reload() {
    api<Redemption[]>(`/rewards/admin/redemptions?status=${status}`).then(setItems);
  }

  useEffect(reload, [status]);

  async function decide(id: string, action: "FULFILLED" | "CANCELLED") {
    await api(`/rewards/admin/redemptions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: action, fulfillmentNote: notes[id] || null }),
    });
    toast.show(action === "FULFILLED" ? "Marked fulfilled" : "Cancelled — coins refunded");
    reload();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold text-brand-dark">Redemption Queue</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="PENDING_FULFILLMENT">Pending</option>
          <option value="FULFILLED">Fulfilled</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        No live voucher-issuing API integration exists — fulfill manually (e.g. purchase and send a
        real gift-card code) and record the reference below. Cancelling refunds the user's coins.
      </p>

      <div className="space-y-3">
        {items.length === 0 && <p className="text-sm text-slate-400">Nothing here.</p>}
        {items.map((r) => (
          <div key={r.id} className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <p className="font-medium">{r.voucher.title} — {r.coinsCost} coins</p>
                <p className="text-sm text-slate-500 mt-1">
                  {r.user.name || r.user.email || r.user.phone || r.user.id} · {new Date(r.createdAt).toLocaleString("en-IN")}
                </p>
                {r.status === "PENDING_FULFILLMENT" ? (
                  <input
                    placeholder="Fulfillment note / gift-card code"
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                ) : (
                  r.fulfillmentNote && <p className="text-sm text-slate-500 italic mt-1">Note: {r.fulfillmentNote}</p>
                )}
              </div>
              {r.status === "PENDING_FULFILLMENT" && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => decide(r.id, "FULFILLED")}
                    className="text-xs bg-brand text-white px-3 py-1.5 rounded-md hover:bg-brand-dark"
                  >
                    Mark fulfilled
                  </button>
                  <button
                    onClick={() => decide(r.id, "CANCELLED")}
                    className="text-xs bg-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-300"
                  >
                    Cancel & refund
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
