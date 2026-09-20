import { useEffect, useState } from "react";
import { Trash2, Copy } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";

interface BetaTesterRequest {
  id: string;
  email: string;
  createdAt: string;
}

export default function BetaTesterRequests() {
  const [items, setItems] = useState<BetaTesterRequest[] | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    api<BetaTesterRequest[]>("/beta-tester-requests").then(setItems);
  }

  useEffect(reload, []);

  async function remove(item: BetaTesterRequest) {
    const ok = await confirm({
      title: "Remove this request?",
      message: `"${item.email}" will be removed from the queue — do this once you've added them in Play Console, or if it's spam/a typo.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await api(`/beta-tester-requests/${item.id}`, { method: "DELETE" });
    toast.show("Removed");
    reload();
  }

  async function copyEmail(email: string) {
    await navigator.clipboard.writeText(email);
    toast.show("Email copied");
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Google Play Beta Testers</h1>
      <p className="text-sm text-slate-500 mb-6">
        Submitted via the "join the Google Play beta" form on rupeeradarai.com/download. Add each
        email to the Internal Testing tester list in Play Console, then remove it here — this queue
        is meant to stay short, not double as permanent tester records.
      </p>

      {items === null && <p className="text-sm text-slate-400">Loading…</p>}
      {items !== null && items.length === 0 && <p className="text-sm text-slate-400">No requests yet.</p>}

      {items !== null && items.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm divide-y divide-slate-100">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p className="text-sm font-medium text-slate-800">{item.email}</p>
                <p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString("en-IN")}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => copyEmail(item.email)}
                  className="text-xs bg-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-300 flex items-center gap-1"
                >
                  <Copy size={12} /> Copy
                </button>
                <button
                  onClick={() => remove(item)}
                  className="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-md hover:bg-red-200 flex items-center gap-1"
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
