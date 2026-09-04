import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

type FlagStatus = "LIVE" | "BETA" | "EARLY_ACCESS" | "COMING_SOON" | "MAINTENANCE" | "DISABLED";

interface FeatureFlag {
  id: string;
  key: string;
  displayName: string;
  status: FlagStatus;
  message: string | null;
  order: number;
  updatedAt: string;
}

const STATUS_OPTIONS: { value: FlagStatus; label: string; color: string }[] = [
  { value: "LIVE", label: "Live", color: "bg-green-100 text-green-700" },
  { value: "BETA", label: "Beta", color: "bg-blue-100 text-blue-700" },
  { value: "EARLY_ACCESS", label: "Early Access", color: "bg-purple-100 text-purple-700" },
  { value: "COMING_SOON", label: "Coming Soon", color: "bg-amber-100 text-amber-700" },
  { value: "MAINTENANCE", label: "Maintenance", color: "bg-orange-100 text-orange-700" },
  { value: "DISABLED", label: "Disabled", color: "bg-red-100 text-red-700" },
];

function statusMeta(status: FlagStatus) {
  return STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[0];
}

export default function FeatureFlags() {
  const [items, setItems] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, { status: FlagStatus; message: string; order: number }>>({});
  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<FeatureFlag[]>("/feature-flags")
      .then((flags) => {
        setItems(flags);
        setDrafts(Object.fromEntries(flags.map((f) => [f.id, { status: f.status, message: f.message ?? "", order: f.order }])));
      })
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newKey.trim() || !newName.trim()) return;
    setSaving(true);
    try {
      await api("/feature-flags", { method: "POST", body: JSON.stringify({ key: newKey.trim(), displayName: newName.trim() }) });
      toast.show("Feature flag created");
      setNewKey("");
      setNewName("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to create flag", "error");
    } finally {
      setSaving(false);
    }
  }

  async function save(item: FeatureFlag) {
    const draft = drafts[item.id];
    if (!draft) return;
    try {
      await api(`/feature-flags/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: draft.status, message: draft.message || null, order: draft.order }),
      });
      toast.show(`${item.displayName} updated`);
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to update flag", "error");
    }
  }

  async function remove(item: FeatureFlag) {
    const ok = await confirm({
      title: "Delete this feature flag?",
      message: `"${item.displayName}" will revert to the default (Live) state, since the app treats a missing flag as Live.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api(`/feature-flags/${item.id}`, { method: "DELETE" });
    toast.show("Feature flag deleted");
    reload();
  }

  const needsMessage = (status: FlagStatus) => status === "COMING_SOON" || status === "MAINTENANCE";

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Feature Flags</h1>
      <p className="text-sm text-slate-500 mb-6">
        Controls what the app shows for each feature/screen, without an app release. A feature with no row
        here (or deleted) is treated as <span className="font-medium">Live</span> by the app. "Coming Soon"
        and "Maintenance" show the message below in place of the real screen; "Disabled" removes the
        feature from the app's menus entirely. <span className="font-medium">Order</span> sets the default
        arrangement of services in the app (lower shows first) — a user's own rearranging in the app
        overrides this once they've customized it themselves.
      </p>

      <form onSubmit={handleCreate} className="bg-white rounded-xl shadow-sm p-5 mb-6 flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs text-slate-500 mb-1">Feature key (matches the app's nav route)</label>
          <input
            placeholder="e.g. mall-mode"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-slate-500 mb-1">Display name</label>
          <input
            placeholder="e.g. Mall Mode"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 px-4 hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} /> Add
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Feature</th>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={7}>
                  <SkeletonRows rows={6} cols={7} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const draft = drafts[item.id] ?? { status: item.status, message: item.message ?? "", order: item.order };
                const dirty = draft.status !== item.status || draft.message !== (item.message ?? "") || draft.order !== item.order;
                return (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-medium">{item.displayName}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{item.key}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        value={draft.order}
                        onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: { ...draft, order: Number(e.target.value) || 0 } }))}
                        className="w-16 rounded-md border border-slate-200 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={draft.status}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [item.id]: { ...draft, status: e.target.value as FlagStatus } }))
                        }
                        className={`rounded-full text-xs font-medium px-2 py-1 border-0 ${statusMeta(draft.status).color}`}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        placeholder={needsMessage(draft.status) ? "Message shown to users..." : "Not shown unless Coming Soon/Maintenance"}
                        value={draft.message}
                        onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: { ...draft, message: e.target.value } }))}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => save(item)}
                          disabled={!dirty}
                          title="Save changes"
                          className="text-slate-400 hover:text-brand disabled:opacity-30 disabled:hover:text-slate-400"
                        >
                          <Save size={16} />
                        </button>
                        <button onClick={() => remove(item)} title="Delete" className="text-slate-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    No feature flags yet — every feature defaults to Live until one is added here.
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
