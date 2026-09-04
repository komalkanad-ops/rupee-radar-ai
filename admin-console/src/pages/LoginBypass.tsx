import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface LoginBypassEntry {
  id: string;
  phone: string;
  enabled: boolean;
  note: string | null;
  createdAt: string;
}

interface AppUser {
  id: string;
  email: string | null;
  phone: string | null;
}

export default function LoginBypass() {
  const [items, setItems] = useState<LoginBypassEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [installedPhones, setInstalledPhones] = useState<string[]>([]);
  const [newPhone, setNewPhone] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<LoginBypassEntry[]>("/admin/login-bypass").then(setItems).finally(() => setLoading(false));
  }

  useEffect(reload, []);
  useEffect(() => {
    // Auto-populate suggestions from every installed user/device — pure convenience, typing a
    // number not in this list still works (pre-authorizing someone who hasn't installed yet).
    api<AppUser[]>("/users").then((users) => {
      setInstalledPhones(Array.from(new Set(users.map((u) => u.phone).filter((p): p is string => !!p))));
    });
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newPhone.trim()) return;
    setSaving(true);
    try {
      await api("/admin/login-bypass", { method: "POST", body: JSON.stringify({ phone: newPhone.trim(), note: newNote.trim() || undefined }) });
      toast.show("Bypass added — that number will see its OTP code directly on Sign in with phone");
      setNewPhone("");
      setNewNote("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to add", "error");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: LoginBypassEntry) {
    await api(`/admin/login-bypass/${item.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !item.enabled }) });
    toast.show(item.enabled ? "Disabled" : "Enabled");
    reload();
  }

  async function remove(item: LoginBypassEntry) {
    const ok = await confirm({
      title: "Remove this bypass?",
      message: `${item.phone} will go back to needing real phone verification to sign in.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await api(`/admin/login-bypass/${item.id}`, { method: "DELETE" });
    toast.show("Removed");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Login Bypass</h1>
      <p className="text-sm text-slate-500 mb-6">
        Lets a specific real phone number see its OTP code directly in the app instead of needing
        real SMS delivery (no SMS gateway is wired up yet) — the code is still a real, hashed,
        verified one-time code, this only changes who gets shown it. Use this to let named beta
        testers sign in with a real identity while phone verification is otherwise unavailable.
      </p>

      <form onSubmit={handleCreate} className="bg-white rounded-xl shadow-sm p-5 mb-6 flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs text-slate-500 mb-1">Phone number</label>
          <input
            list="installed-phones"
            placeholder="+91XXXXXXXXXX"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <datalist id="installed-phones">
            {installedPhones.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-slate-500 mb-1">Note (optional)</label>
          <input
            placeholder="e.g. beta tester — Priya"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={saving || !newPhone.trim()}
          className="flex items-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 px-4 hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} /> Add
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Added</th>
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
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-mono">{item.phone}</td>
                  <td className="px-4 py-3 text-slate-500">{item.note ?? "—"}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggle(item)}
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        item.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {item.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => remove(item)} title="Remove" className="text-slate-400 hover:text-red-600">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No bypass entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
