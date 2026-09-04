import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface Portal {
  id: string;
  name: string;
  url: string;
  notes: string | null;
  applicableBankNames: string[] | null;
}

export default function Portals() {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [banksText, setBanksText] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<Portal[]>("/redemption-portals").then(setPortals).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/redemption-portals", {
        method: "POST",
        body: JSON.stringify({
          name,
          url,
          notes: notes || null,
          applicableBankNames: banksText.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      toast.show("Portal added");
      setName("");
      setUrl("");
      setNotes("");
      setBanksText("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to add portal", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(portal: Portal) {
    const ok = await confirm({ title: "Delete this portal?", message: `"${portal.name}" will be removed.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await api(`/redemption-portals/${portal.id}`, { method: "DELETE" });
    toast.show("Portal deleted");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Redemption Portals</h1>
      <p className="text-sm text-slate-500 mb-6">
        Airline transfer partners, hotel partners, brand catalogs, statement-credit portals — the
        reward-point maximization links surfaced per card/issuer.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-2 gap-3">
        <input placeholder="Portal name" value={name} onChange={(e) => setName(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input
          placeholder="Applicable banks (comma-separated)"
          value={banksText}
          onChange={(e) => setBanksText(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm col-span-2"
        />
        <textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm col-span-2" rows={2} />
        <button type="submit" disabled={saving} className="col-span-2 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50">
          <Plus size={15} /> {saving ? "Adding..." : "Add portal"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">URL</th>
              <th className="px-4 py-3">Applicable banks</th>
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
              {portals.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-brand truncate max-w-xs">{p.url}</td>
                  <td className="px-4 py-3 text-slate-500">{(p.applicableBankNames ?? []).join(", ") || "—"}</td>
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
