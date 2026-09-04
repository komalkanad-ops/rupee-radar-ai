import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X, Check } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface Voucher {
  id: string;
  title: string;
  description: string | null;
  coinCost: number;
  imageUrl: string | null;
  stockRemaining: number | null;
  active: boolean;
  code: string | null;
  pin: string | null;
  _count?: { redemptions: number };
}

const inputCls = "rounded-md border border-slate-300 px-3 py-2 text-sm";

export default function Vouchers() {
  const [items, setItems] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", description: "", coinCost: "", stockRemaining: "", code: "", pin: "" });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ title: "", coinCost: "", stockRemaining: "", code: "", pin: "", active: true });
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<Voucher[]>("/rewards/admin/vouchers").then(setItems).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/rewards/admin/vouchers", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          coinCost: Number(form.coinCost),
          stockRemaining: form.stockRemaining ? Number(form.stockRemaining) : null,
          code: form.code || null,
          pin: form.pin || null,
        }),
      });
      toast.show("Voucher added");
      setForm({ title: "", description: "", coinCost: "", stockRemaining: "", code: "", pin: "" });
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to add voucher", "error");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(v: Voucher) {
    setEditingId(v.id);
    setEdit({
      title: v.title,
      coinCost: String(v.coinCost),
      stockRemaining: v.stockRemaining === null ? "" : String(v.stockRemaining),
      code: v.code ?? "",
      pin: v.pin ?? "",
      active: v.active,
    });
  }

  async function saveEdit(id: string) {
    try {
      await api(`/rewards/admin/vouchers/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: edit.title,
          coinCost: Number(edit.coinCost),
          stockRemaining: edit.stockRemaining ? Number(edit.stockRemaining) : null,
          code: edit.code || null,
          pin: edit.pin || null,
          active: edit.active,
        }),
      });
      toast.show("Voucher updated");
      setEditingId(null);
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to update", "error");
    }
  }

  async function remove(item: Voucher) {
    const ok = await confirm({ title: "Delete this voucher?", message: `"${item.title}" will be removed from the catalog.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await api(`/rewards/admin/vouchers/${item.id}`, { method: "DELETE" });
    toast.show("Voucher deleted");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Vouchers</h1>
      <p className="text-sm text-slate-500 mb-6">
        The coin-redeemable voucher catalog — users earn coins via referrals and spend them here.
        <strong className="text-slate-700"> Add a code + PIN</strong> and redeeming is instant: the
        user sees the code in the app right away. Leave the code blank and it goes to the manual
        Redemption Queue instead.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-2 gap-3">
        <input placeholder="Name (e.g. ₹100 Amazon voucher)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required className={`${inputCls} col-span-2`} />
        <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${inputCls} col-span-2`} />
        <input type="number" placeholder="Coins to redeem" value={form.coinCost} onChange={(e) => setForm({ ...form, coinCost: e.target.value })} required className={inputCls} />
        <input type="number" placeholder="Stock (blank = unlimited)" value={form.stockRemaining} onChange={(e) => setForm({ ...form, stockRemaining: e.target.value })} className={inputCls} />
        <input placeholder="Voucher code (blank = manual fulfilment)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputCls} />
        <input placeholder="PIN (optional)" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} className={inputCls} />
        <button type="submit" disabled={saving} className="col-span-2 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50">
          <Plus size={15} /> {saving ? "Adding..." : "Add voucher"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Coins</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Code / PIN</th>
              <th className="px-4 py-3">Redeemed</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody><tr><td colSpan={6}><SkeletonRows rows={4} cols={6} /></td></tr></tbody>
          ) : (
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No vouchers yet.</td></tr>
              )}
              {items.map((v) => editingId === v.id ? (
                <tr key={v.id} className="border-t border-slate-100 bg-amber-50">
                  <td className="px-4 py-2"><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className={`${inputCls} w-full`} /></td>
                  <td className="px-4 py-2"><input type="number" value={edit.coinCost} onChange={(e) => setEdit({ ...edit, coinCost: e.target.value })} className={`${inputCls} w-20`} /></td>
                  <td className="px-4 py-2"><input type="number" placeholder="∞" value={edit.stockRemaining} onChange={(e) => setEdit({ ...edit, stockRemaining: e.target.value })} className={`${inputCls} w-20`} /></td>
                  <td className="px-4 py-2">
                    <input placeholder="code" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} className={`${inputCls} w-32 mb-1`} />
                    <input placeholder="pin" value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value })} className={`${inputCls} w-20`} />
                  </td>
                  <td className="px-4 py-2">
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> active</label>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => saveEdit(v.id)} className="text-emerald-600 hover:text-emerald-800 mr-3"><Check size={16} /></button>
                    <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                  </td>
                </tr>
              ) : (
                <tr key={v.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">
                    {v.title}
                    {!v.active && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{v.coinCost}</td>
                  <td className="px-4 py-3 text-slate-500">{v.stockRemaining === null ? "∞" : v.stockRemaining}</td>
                  <td className="px-4 py-3">
                    {v.code ? (
                      <span className="inline-flex items-center gap-1">
                        <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">{v.code}</code>
                        {v.pin && <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">PIN {v.pin}</code>}
                        <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">INSTANT</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">manual fulfilment</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{v._count?.redemptions ?? 0}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(v)} className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1 mr-3"><Pencil size={12} /> Edit</button>
                    <button onClick={() => remove(v)} className="text-xs text-red-600 hover:underline inline-flex items-center gap-1"><Trash2 size={12} /> Delete</button>
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
