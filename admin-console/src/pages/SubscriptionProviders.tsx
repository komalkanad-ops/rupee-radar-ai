import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface Provider {
  id: string;
  merchantPattern: string;
  providerName: string;
  cancelUrl: string | null;
  downgradeUrl: string | null;
}

export default function SubscriptionProviders() {
  const [items, setItems] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchantPattern, setMerchantPattern] = useState("");
  const [providerName, setProviderName] = useState("");
  const [cancelUrl, setCancelUrl] = useState("");
  const [downgradeUrl, setDowngradeUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<Provider[]>("/subscription-providers").then(setItems).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/subscription-providers", {
        method: "POST",
        body: JSON.stringify({
          merchantPattern,
          providerName,
          cancelUrl: cancelUrl || null,
          downgradeUrl: downgradeUrl || null,
        }),
      });
      toast.show("Provider added");
      setMerchantPattern("");
      setProviderName("");
      setCancelUrl("");
      setDowngradeUrl("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to add provider", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: Provider) {
    const ok = await confirm({
      title: "Delete this provider?",
      message: `"${item.providerName}" will be removed.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api(`/subscription-providers/${item.id}`, { method: "DELETE" });
    toast.show("Provider deleted");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Subscription Providers</h1>
      <p className="text-sm text-slate-500 mb-6">
        Ties a merchant name pattern (matched against detected recurring SMS charges, e.g. "Netflix",
        "Spotify") to a cancel/downgrade deep link, so the app's subscription cancel assistant can
        offer a one-tap action instead of just flagging the charge.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-2 gap-3">
        <input
          placeholder="Merchant pattern (e.g. Netflix)"
          value={merchantPattern}
          onChange={(e) => setMerchantPattern(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Provider name (e.g. Netflix)"
          value={providerName}
          onChange={(e) => setProviderName(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Cancel URL (optional)"
          value={cancelUrl}
          onChange={(e) => setCancelUrl(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Downgrade URL (optional)"
          value={downgradeUrl}
          onChange={(e) => setDowngradeUrl(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="col-span-2 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} /> {saving ? "Adding..." : "Add provider"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Merchant pattern</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Cancel URL</th>
              <th className="px-4 py-3">Downgrade URL</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={5}>
                  <SkeletonRows rows={4} cols={5} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No providers yet — detected subscriptions will show without a cancel/downgrade link
                    until you add some.
                  </td>
                </tr>
              )}
              {items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{p.merchantPattern}</td>
                  <td className="px-4 py-3">{p.providerName}</td>
                  <td className="px-4 py-3 text-brand truncate max-w-xs">{p.cancelUrl ?? "—"}</td>
                  <td className="px-4 py-3 text-brand truncate max-w-xs">{p.downgradeUrl ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(p)} className="text-xs text-red-600 hover:underline flex items-center gap-1 ml-auto">
                      <Trash2 size={12} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
