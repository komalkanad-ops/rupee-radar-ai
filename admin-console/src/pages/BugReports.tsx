import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, User } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";

interface BugReportItem {
  id: string;
  type: "BUG" | "SUGGESTION";
  message: string;
  screenRoute: string;
  appVersionName: string | null;
  appVersionCode: number | null;
  deviceModel: string | null;
  androidSdkInt: number | null;
  status: "NEW" | "REVIEWED" | "RESOLVED";
  userId: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = ["ALL", "NEW", "REVIEWED", "RESOLVED"] as const;
const TYPE_OPTIONS = ["ALL", "BUG", "SUGGESTION"] as const;

function ReportCard({ r, onUpdateStatus }: { r: BugReportItem; onUpdateStatus: (id: string, next: BugReportItem["status"]) => void }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                r.type === "BUG" ? "bg-red-100 text-red-700" : "bg-brand/10 text-brand-dark"
              }`}
            >
              {r.type === "BUG" ? "Bug" : "Suggestion"}
            </span>
            <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
              {r.screenRoute}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                r.status === "NEW" ? "bg-amber-100 text-amber-700" : r.status === "REVIEWED" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {r.status}
            </span>
          </div>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{r.message}</p>
          <p className="text-xs text-slate-500 mt-2">
            {[r.deviceModel, r.appVersionName && `v${r.appVersionName}`, r.androidSdkInt && `SDK ${r.androidSdkInt}`]
              .filter(Boolean)
              .join(" · ") || "No device info"}
            {" · "}
            {new Date(r.createdAt).toLocaleString("en-IN")}
          </p>
          {r.userId && (
            <Link
              to={`/user-diagnostics/${r.userId}`}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-dark hover:underline"
            >
              <User size={12} /> View this user's diagnostics
            </Link>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {r.status !== "REVIEWED" && (
            <button
              onClick={() => onUpdateStatus(r.id, "REVIEWED")}
              className="text-xs bg-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-300"
            >
              Mark reviewed
            </button>
          )}
          {r.status !== "RESOLVED" && (
            <button
              onClick={() => onUpdateStatus(r.id, "RESOLVED")}
              className="text-xs bg-brand text-white px-3 py-1.5 rounded-md hover:bg-brand-dark"
            >
              Mark resolved
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BugReports() {
  const [items, setItems] = useState<BugReportItem[]>([]);
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("ALL");
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]>("ALL");
  // Resolved reports are real history, not noise to filter away — kept in their own always-present
  // (but collapsed-by-default) section instead of only reachable by remembering to pick "Resolved"
  // from the status dropdown.
  const [historyOpen, setHistoryOpen] = useState(false);
  const toast = useToast();

  function reload() {
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (type !== "ALL") params.set("type", type);
    const query = params.toString() ? `?${params.toString()}` : "";
    api<BugReportItem[]>(`/bug-reports${query}`).then(setItems);
  }

  useEffect(reload, [status, type]);

  async function updateStatus(id: string, next: BugReportItem["status"]) {
    await api(`/bug-reports/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    toast.show(`Marked ${next.toLowerCase()}`);
    reload();
  }

  const openItems = items.filter((r) => r.status !== "RESOLVED");
  const resolvedItems = items.filter((r) => r.status === "RESOLVED");

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold text-brand-dark">Bug Reports & Suggestions</h1>
        <div className="flex gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as (typeof TYPE_OPTIONS)[number])}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t === "ALL" ? "All types" : t.charAt(0) + t.slice(1).toLowerCase()}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "ALL" ? "All statuses" : s.charAt(0) + s.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Submitted via the small report button beta testers see on every screen — un-rewarded and
        contextual, distinct from Settings' coin-rewarded Feedback flow.
      </p>

      <div className="space-y-3 mb-6">
        {openItems.length === 0 && <p className="text-sm text-slate-400">Nothing open.</p>}
        {openItems.map((r) => (
          <ReportCard key={r.id} r={r} onUpdateStatus={updateStatus} />
        ))}
      </div>

      <div className="border-t border-slate-200 pt-4">
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
        >
          {historyOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Resolved ({resolvedItems.length})
        </button>
        {historyOpen && (
          <div className="space-y-3 mt-3">
            {resolvedItems.length === 0 && <p className="text-sm text-slate-400">No resolved reports yet.</p>}
            {resolvedItems.map((r) => (
              <ReportCard key={r.id} r={r} onUpdateStatus={updateStatus} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
