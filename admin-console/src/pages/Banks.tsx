import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface Bank {
  id: string;
  name: string;
  type: string;
  logoUrl: string | null;
}

const BANK_TYPES = ["PRIVATE", "PSU", "FOREIGN", "NBFC", "FINTECH"];

export default function Banks() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [type, setType] = useState("PRIVATE");
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<Bank[]>("/banks").then(setBanks).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/banks", { method: "POST", body: JSON.stringify({ name, type, logoUrl: logoUrl || null }) });
      toast.show("Bank added");
      setName("");
      setLogoUrl("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to add bank", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(bank: Bank) {
    const ok = await confirm({
      title: "Delete this bank?",
      message: `"${bank.name}" will be removed. Cards must be reassigned or deleted first if any reference it.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/banks/${bank.id}`, { method: "DELETE" });
      toast.show("Bank deleted");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to delete bank", "error");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-6">Banks & Issuers</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-3 gap-3">
        <input
          placeholder="Bank / issuer name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          {BANK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          placeholder="Logo URL (optional)"
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="col-span-3 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} /> {saving ? "Adding..." : "Add bank"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={3}>
                  <SkeletonRows rows={4} cols={3} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {banks.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3">{b.type}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(b)} className="text-xs text-red-600 hover:underline flex items-center gap-1 ml-auto">
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
