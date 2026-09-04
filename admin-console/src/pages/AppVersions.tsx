import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2, ArrowUpCircle } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface AppVersion {
  id: string;
  platform: string;
  versionName: string;
  versionCode: number;
  channel: "BETA" | "STABLE";
  releaseNotes: string | null;
  minSupportedVersionCode: number | null;
  createdAt: string;
}

export default function AppVersions() {
  const [items, setItems] = useState<AppVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState("android");
  const [versionName, setVersionName] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [channel, setChannel] = useState<"BETA" | "STABLE">("BETA");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [minSupportedVersionCode, setMinSupportedVersionCode] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<AppVersion[]>("/app-version").then(setItems).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/app-version", {
        method: "POST",
        body: JSON.stringify({
          platform,
          versionName,
          versionCode: Number(versionCode),
          channel,
          releaseNotes: releaseNotes || undefined,
          minSupportedVersionCode: minSupportedVersionCode ? Number(minSupportedVersionCode) : undefined,
        }),
      });
      toast.show("Version logged");
      setVersionName("");
      setVersionCode("");
      setReleaseNotes("");
      setMinSupportedVersionCode("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to log version", "error");
    } finally {
      setSaving(false);
    }
  }

  async function promote(item: AppVersion) {
    if (item.channel === "STABLE") return;
    const ok = await confirm({
      title: "Promote to STABLE?",
      message: `"${item.versionName}" (${item.versionCode}) will be promoted from BETA to STABLE.`,
      confirmLabel: "Promote",
    });
    if (!ok) return;
    await api(`/app-version/${item.id}`, { method: "PATCH", body: JSON.stringify({ channel: "STABLE" }) });
    toast.show("Promoted to STABLE");
    reload();
  }

  async function remove(item: AppVersion) {
    const ok = await confirm({
      title: "Delete this version?",
      message: `"${item.versionName}" (${item.versionCode}) will be removed from the catalog.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api(`/app-version/${item.id}`, { method: "DELETE" });
    toast.show("Version deleted");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">App Versions</h1>
      <p className="text-sm text-slate-500 mb-6">
        Log each Android build here when it's cut. The app checks <code>GET /app-version/latest</code>{" "}
        to show an "update available" hint — promoting a BETA row to STABLE is what marks it as the
        recommended release for that channel.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-2 gap-3">
        <input
          placeholder="Platform (default android)"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as "BETA" | "STABLE")}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="BETA">Beta</option>
          <option value="STABLE">Stable</option>
        </select>
        <input
          placeholder="Version name (e.g. 0.4.0-beta)"
          value={versionName}
          onChange={(e) => setVersionName(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="number"
          placeholder="Version code (e.g. 4)"
          value={versionCode}
          onChange={(e) => setVersionCode(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="number"
          placeholder="Min supported version code (optional)"
          value={minSupportedVersionCode}
          onChange={(e) => setMinSupportedVersionCode(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Release notes (optional)"
          value={releaseNotes}
          onChange={(e) => setReleaseNotes(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="col-span-2 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} /> {saving ? "Logging..." : "Log version"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Platform</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Min supported</th>
              <th className="px-4 py-3">Release notes</th>
              <th className="px-4 py-3">Logged</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={8}>
                  <SkeletonRows rows={4} cols={8} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">{item.platform}</td>
                  <td className="px-4 py-3 font-medium">{item.versionName}</td>
                  <td className="px-4 py-3">{item.versionCode}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.channel === "STABLE" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {item.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3">{item.minSupportedVersionCode ?? "—"}</td>
                  <td className="px-4 py-3 max-w-xs truncate" title={item.releaseNotes ?? ""}>
                    {item.releaseNotes ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {item.channel === "BETA" && (
                        <button
                          onClick={() => promote(item)}
                          title="Promote to STABLE"
                          className="text-slate-400 hover:text-green-600"
                        >
                          <ArrowUpCircle size={16} />
                        </button>
                      )}
                      <button onClick={() => remove(item)} title="Delete" className="text-slate-400 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    No versions logged yet.
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
