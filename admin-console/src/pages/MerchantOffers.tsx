import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface Offer {
  id: string;
  merchantNamePattern: string;
  bankName: string | null;
  title: string;
  description: string | null;
  discountPct: number | null;
  validFrom: string;
  validUntil: string;
  sourceUrl: string | null;
}

export default function MerchantOffers() {
  const [items, setItems] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchantNamePattern, setMerchantNamePattern] = useState("");
  const [bankName, setBankName] = useState("");
  const [title, setTitle] = useState("");
  const [discountPct, setDiscountPct] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<Offer[]>("/offers").then(setItems).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/offers", {
        method: "POST",
        body: JSON.stringify({
          merchantNamePattern,
          bankName: bankName || null,
          title,
          discountPct: discountPct ? Number(discountPct) : null,
          validFrom: new Date(validFrom).toISOString(),
          validUntil: new Date(validUntil).toISOString(),
        }),
      });
      toast.show("Offer added");
      setMerchantNamePattern("");
      setBankName("");
      setTitle("");
      setDiscountPct("");
      setValidFrom("");
      setValidUntil("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to add offer", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: Offer) {
    const ok = await confirm({ title: "Delete this offer?", message: `"${item.title}" will be removed.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await api(`/offers/${item.id}`, { method: "DELETE" });
    toast.show("Offer deleted");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Merchant Offers</h1>
      <p className="text-sm text-slate-500 mb-6">
        Time-bound bank/card offers at specific merchants ("10% off at Croma with an HDFC card").
        No live bank-offer data feed exists, so these are manually curated and surfaced on the
        Nearby Recommendation screen and a browsable Offers list in the app.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-2 gap-3">
        <input placeholder="Merchant pattern (e.g. Croma)" value={merchantNamePattern} onChange={(e) => setMerchantNamePattern(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input placeholder="Bank (optional)" value={bankName} onChange={(e) => setBankName(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input placeholder="Title (e.g. 10% off on HDFC cards)" value={title} onChange={(e) => setTitle(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm col-span-2" />
        <input type="number" placeholder="Discount %" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <div />
        <label className="text-xs text-slate-500">Valid from<input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-xs text-slate-500">Valid until<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
        <button type="submit" disabled={saving} className="col-span-2 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50">
          <Plus size={15} /> {saving ? "Adding..." : "Add offer"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Merchant</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Valid until</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody><tr><td colSpan={5}><SkeletonRows rows={4} cols={5} /></td></tr></tbody>
          ) : (
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">No offers yet.</td>
                </tr>
              )}
              {items.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{o.merchantNamePattern}</td>
                  <td className="px-4 py-3">{o.title}</td>
                  <td className="px-4 py-3 text-slate-500">{o.discountPct ? `${o.discountPct}%` : "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(o.validUntil).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(o)} className="text-xs text-red-600 hover:underline flex items-center gap-1 ml-auto">
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
