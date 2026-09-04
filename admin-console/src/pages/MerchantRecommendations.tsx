import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface Mapping {
  id: string;
  merchantNamePattern: string;
  category: string;
  notes: string | null;
}

export default function MerchantRecommendations() {
  const [items, setItems] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<Mapping[]>("/merchant-recommendations").then(setItems).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/merchant-recommendations", {
        method: "POST",
        body: JSON.stringify({ merchantNamePattern: pattern, category, notes: notes || null }),
      });
      toast.show("Mapping added");
      setPattern("");
      setCategory("");
      setNotes("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to add mapping", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: Mapping) {
    const ok = await confirm({
      title: "Delete this mapping?",
      message: `"${item.merchantNamePattern}" → ${item.category} will be removed.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api(`/merchant-recommendations/${item.id}`, { method: "DELETE" });
    toast.show("Mapping deleted");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Merchant → Category Mapping</h1>
      <p className="text-sm text-slate-500 mb-6">
        Ties a merchant name pattern (matched against Places API results, e.g. "Croma", "Reliance
        Digital") to a spend category (electronics, fuel, grocery, dining, travel) so the nearby
        card-recommendation engine can rank saved cards accurately instead of guessing from raw text.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-2 gap-3">
        <input
          placeholder="Merchant name pattern (e.g. Croma)"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Category (e.g. electronics)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm col-span-2"
        />
        <button
          type="submit"
          disabled={saving}
          className="col-span-2 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} /> {saving ? "Adding..." : "Add mapping"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Merchant pattern</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Notes</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={4}>
                  <SkeletonRows rows={4} cols={4} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    No mappings yet — nearby recommendations fall back to raw text matching until you add some.
                  </td>
                </tr>
              )}
              {items.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{m.merchantNamePattern}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-brand-light text-brand-dark px-2 py-0.5 rounded-full">{m.category}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{m.notes ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(m)} className="text-xs text-red-600 hover:underline flex items-center gap-1 ml-auto">
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
