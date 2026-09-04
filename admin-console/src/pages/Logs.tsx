import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { SkeletonRows } from "../components/Skeleton";

interface AppEventLog {
  id: string;
  source: string;
  level: string;
  feature: string | null;
  message: string;
  metadata: unknown;
  userId: string | null;
  createdAt: string;
}

interface LogsResponse {
  logs: AppEventLog[];
  total: number;
  limit: number;
  offset: number;
}

const SOURCES = ["", "ANDROID", "WEB", "ADMIN", "BACKEND"];
const LEVELS = ["", "INFO", "WARN", "ERROR"];
const PAGE_SIZE = 100;

function MetadataBlock({ metadata }: { metadata: unknown }) {
  if (metadata == null) return <span className="text-slate-400 text-xs">no metadata</span>;
  const text = typeof metadata === "string" ? metadata : JSON.stringify(metadata, null, 2);
  return (
    <pre className="mt-1 text-xs bg-slate-50 border border-slate-200 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-96">
      {text}
    </pre>
  );
}

export default function Logs() {
  const [logs, setLogs] = useState<AppEventLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [feature, setFeature] = useState("");
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (level) params.set("level", level);
    if (feature) params.set("feature", feature);
    if (q.trim()) params.set("q", q.trim());
    if (userId.trim()) params.set("userId", userId.trim());
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    api<LogsResponse>(`/logs?${params.toString()}`)
      .then((r) => {
        setLogs(r.logs);
        setTotal(r.total);
      })
      .finally(() => setLoading(false));
  }

  // Reset to page 0 whenever a filter changes.
  useEffect(() => setOffset(0), [source, level, feature, q, userId]);
  useEffect(reload, [source, level, feature, q, userId, offset]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Event Logs</h1>
      <p className="text-sm text-slate-500 mb-6">
        App and website error/event reports. Android crash stack traces and Send-Diagnostics
        bundles arrive here in the row's metadata — expand a row to read one.
      </p>

      <div className="bg-white rounded-xl shadow-sm p-5 mb-4 flex flex-wrap gap-3">
        <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          {SOURCES.map((s) => (
            <option key={s} value={s}>{s || "All sources"}</option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l || "All levels"}</option>
          ))}
        </select>
        <input placeholder="Feature" value={feature} onChange={(e) => setFeature(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm w-40" />
        <input placeholder="Search message…" value={q} onChange={(e) => setQ(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm flex-1 min-w-48" />
        <input placeholder="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm w-56 font-mono" />
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Feature</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={6}>
                  <SkeletonRows rows={6} cols={6} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <Fragment key={log.id}>
                  <tr
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  >
                    <td className="px-4 py-3">{log.source}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          log.level === "ERROR"
                            ? "bg-red-100 text-red-700"
                            : log.level === "WARN"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {log.level}
                      </span>
                    </td>
                    <td className="px-4 py-3">{log.feature ?? "—"}</td>
                    <td className="px-4 py-3 max-w-md truncate" title={log.message}>{log.message}</td>
                    <td className="px-4 py-3">
                      {log.userId ? (
                        <Link
                          to={`/user-diagnostics/${log.userId}`}
                          className="font-mono text-xs text-brand-dark hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {log.userId.slice(0, 8)}…
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(log.createdAt).toLocaleString()}</td>
                  </tr>
                  {expanded === log.id && (
                    <tr>
                      <td colSpan={6} className="px-4 pb-4">
                        <div className="text-xs text-slate-500 mb-1">Full message</div>
                        <pre className="text-xs bg-slate-50 border border-slate-200 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                          {log.message}
                        </pre>
                        <div className="text-xs text-slate-500 mt-2">Metadata</div>
                        <MetadataBlock metadata={log.metadata} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    No events match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          )}
        </table>
        <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500 border-t border-slate-100">
          <span>
            {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`} of {total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="px-3 py-1 rounded-md border border-slate-300 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="px-3 py-1 rounded-md border border-slate-300 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
