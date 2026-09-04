import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2, Power } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

type Severity = "INFO" | "WARNING" | "MAINTENANCE";

interface Announcement {
  id: string;
  message: string;
  severity: Severity;
  active: boolean;
  createdAt: string;
}

const SEVERITY_COLORS: Record<Severity, string> = {
  INFO: "bg-blue-100 text-blue-700",
  WARNING: "bg-amber-100 text-amber-700",
  MAINTENANCE: "bg-red-100 text-red-700",
};

export default function Announcements() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<Severity>("INFO");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<Announcement[]>("/announcements").then(setItems).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  const currentActive = items.find((i) => i.active);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSaving(true);
    try {
      await api("/announcements", { method: "POST", body: JSON.stringify({ message: message.trim(), severity }) });
      toast.show("Announcement published");
      setMessage("");
      setSeverity("INFO");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to publish", "error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: Announcement) {
    if (item.active) {
      const ok = await confirm({
        title: "Take this announcement down?",
        message: "It will stop showing on the app's Dashboard immediately.",
        confirmLabel: "Deactivate",
      });
      if (!ok) return;
    }
    await api(`/announcements/${item.id}`, { method: "PATCH", body: JSON.stringify({ active: !item.active }) });
    toast.show(item.active ? "Announcement taken down" : "Announcement reactivated");
    reload();
  }

  async function remove(item: Announcement) {
    const ok = await confirm({
      title: "Delete this announcement?",
      message: "This removes it permanently from the history.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api(`/announcements/${item.id}`, { method: "DELETE" });
    toast.show("Announcement deleted");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">App Announcements</h1>
      <p className="text-sm text-slate-500 mb-6">
        A single app-wide banner on the Dashboard — for whole-app notices (scheduled maintenance, a new
        release) that don't belong to any one feature. Only the newest active announcement is ever shown;
        publishing a new one automatically supersedes the old one in the app (the old one stays in this
        history until explicitly deleted).
      </p>

      {currentActive && (
        <div className={`rounded-xl p-4 mb-6 text-sm ${SEVERITY_COLORS[currentActive.severity]}`}>
          <span className="font-medium">Currently showing in the app:</span> {currentActive.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs text-slate-500 mb-1">Message</label>
          <input
            placeholder="e.g. Scheduled maintenance tonight 11pm-1am IST"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Severity</label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="MAINTENANCE">Maintenance</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 px-4 hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} /> Publish
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Published</th>
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
                  <td className="px-4 py-3 max-w-sm">{item.message}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[item.severity]}`}>
                      {item.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {item.active ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleActive(item)}
                        title={item.active ? "Deactivate" : "Reactivate"}
                        className="text-slate-400 hover:text-brand"
                      >
                        <Power size={16} />
                      </button>
                      <button onClick={() => remove(item)} title="Delete" className="text-slate-400 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No announcements published yet.
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
