import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

type HighlightType = "FEATURE" | "FIX" | "IMPROVEMENT";
type Platform = "android" | "web" | "admin" | "backend";

interface Highlight {
  type: HighlightType;
  platform: Platform;
  text: string;
}

interface ChangelogEntry {
  id: string;
  version: string;
  releaseDate: string;
  platforms: Platform[];
  summary: string | null;
  highlights: Highlight[];
}

const PLATFORMS: Platform[] = ["android", "web", "admin", "backend"];
const HIGHLIGHT_TYPES: HighlightType[] = ["FEATURE", "FIX", "IMPROVEMENT"];

export default function Changelog() {
  const [items, setItems] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState("");
  const [releaseDate, setReleaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [platforms, setPlatforms] = useState<Platform[]>(["android"]);
  const [summary, setSummary] = useState("");
  const [highlights, setHighlights] = useState<Highlight[]>([{ type: "FEATURE", platform: "android", text: "" }]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<ChangelogEntry[]>("/changelog").then(setItems).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  function togglePlatform(p: Platform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function updateHighlight(i: number, patch: Partial<Highlight>) {
    setHighlights((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanHighlights = highlights.filter((h) => h.text.trim());
    if (!version.trim() || platforms.length === 0 || cleanHighlights.length === 0) {
      toast.show("Version, at least one platform, and at least one highlight are required", "error");
      return;
    }
    setSaving(true);
    try {
      await api("/changelog", {
        method: "POST",
        body: JSON.stringify({ version, releaseDate, platforms, summary: summary || undefined, highlights: cleanHighlights }),
      });
      toast.show("Changelog entry published");
      setVersion("");
      setSummary("");
      setHighlights([{ type: "FEATURE", platform: "android", text: "" }]);
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to publish entry", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: ChangelogEntry) {
    const ok = await confirm({
      title: "Delete this changelog entry?",
      message: `Version ${item.version} will be removed from the public What's New feed.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api(`/changelog/${item.id}`, { method: "DELETE" });
    toast.show("Entry deleted");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Changelog</h1>
      <p className="text-sm text-slate-500 mb-6">
        The public "What's New" feed, read by both the website's /changelog page and the Android
        app — distinct from App Versions, which tracks Android's own APK build numbers.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="Version (e.g. 0.0.51)"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <input
          placeholder="One-line summary (optional)"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div>
          <div className="text-xs text-slate-500 mb-1">Platforms touched</div>
          <div className="flex gap-2">
            {PLATFORMS.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => togglePlatform(p)}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${
                  platforms.includes(p) ? "bg-brand text-white border-brand" : "border-slate-300 text-slate-600"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-500">Highlights</div>
          {highlights.map((h, i) => (
            <div key={i} className="grid grid-cols-[100px_110px_1fr] gap-2">
              <select
                value={h.type}
                onChange={(e) => updateHighlight(i, { type: e.target.value as HighlightType })}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              >
                {HIGHLIGHT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={h.platform}
                onChange={(e) => updateHighlight(i, { platform: e.target.value as Platform })}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                placeholder="e.g. Added a Savings Tracker for FDs, gold, and stocks"
                value={h.text}
                onChange={(e) => updateHighlight(i, { text: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setHighlights((prev) => [...prev, { type: "FEATURE", platform: "android", text: "" }])}
            className="text-xs text-brand hover:text-brand-dark"
          >
            + Add another highlight
          </button>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 px-4 hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} /> {saving ? "Publishing..." : "Publish entry"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        {loading ? (
          <SkeletonRows rows={4} cols={1} />
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div key={item.id} className="p-5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-brand-dark">v{item.version}</span>
                    <span className="text-xs text-slate-400">{new Date(item.releaseDate).toLocaleDateString()}</span>
                    {item.platforms.map((p) => (
                      <span key={p} className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">
                        {p}
                      </span>
                    ))}
                  </div>
                  <button onClick={() => remove(item)} className="text-slate-400 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </div>
                {item.summary && <p className="text-sm text-slate-500 mb-2">{item.summary}</p>}
                <ul className="text-sm space-y-0.5">
                  {item.highlights.map((h, i) => (
                    <li key={i} className="text-slate-700">
                      <span
                        className={`inline-block w-16 text-xs font-medium ${
                          h.type === "FEATURE" ? "text-green-600" : h.type === "FIX" ? "text-red-500" : "text-blue-600"
                        }`}
                      >
                        {h.type}
                      </span>
                      {h.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {items.length === 0 && <div className="p-6 text-center text-slate-400">No changelog entries yet.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
