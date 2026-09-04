import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import { SkeletonRows } from "../components/Skeleton";

// Everything an admin needs to triage a bug report without opening a database client — the
// per-user drill-down (GET /feature-usage/user/:userId, which already existed) joined with that
// user's recent error/crash logs (GET /logs?userId=). Reached from BugReports.tsx.

interface Device {
  deviceIdentifier: string;
  platform: string | null;
  deviceModel: string | null;
  deviceManufacturer: string | null;
  osVersion: string | null;
  appVersionName: string | null;
  appVersionCode: number | null;
  lastSeenAt: string;
  createdAt: string;
}

interface UserDrilldown {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    signInMethod: string | null;
    persona: string | null;
    city: string | null;
    isPro?: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  };
  devices: Device[];
  screenBreakdown?: { screen: string; count: number }[];
  screens?: { screen: string; count: number }[];
  timeline: { id: string; screen: string; action: string | null; createdAt: string }[];
  total: number;
}

interface LogRow {
  id: string;
  source: string;
  level: string;
  feature: string | null;
  message: string;
  metadata: unknown;
  createdAt: string;
}

export default function UserDiagnostics() {
  const { userId = "" } = useParams();
  const [data, setData] = useState<UserDrilldown | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api<UserDrilldown>(`/feature-usage/user/${encodeURIComponent(userId)}`),
      api<{ logs: LogRow[] }>(`/logs?userId=${encodeURIComponent(userId)}&limit=50`).catch(() => ({ logs: [] })),
    ])
      .then(([d, l]) => {
        setData(d);
        setLogs(l.logs ?? []);
      })
      .catch((e) => setError(e?.message || "Could not load this user"))
      .finally(() => setLoading(false));
  }, [userId]);

  const screens = data?.screenBreakdown ?? data?.screens ?? [];

  return (
    <div>
      <Link to="/bug-reports" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3">
        <ArrowLeft size={15} /> Back to bug reports
      </Link>
      <h1 className="text-2xl font-semibold text-brand-dark mb-1">User diagnostics</h1>
      <p className="text-xs font-mono text-slate-400 mb-6">{userId}</p>

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <SkeletonRows rows={6} cols={2} />
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl shadow-sm p-5 text-sm text-red-600">{error}</div>
      ) : !data ? null : (
        <div className="space-y-5">
          <section className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-700 mb-3">Profile</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                ["Name", data.user.name],
                ["Email", data.user.email],
                ["Phone", data.user.phone],
                ["Sign-in", data.user.signInMethod],
                ["Persona", data.user.persona],
                ["City", data.user.city],
                ["PRO", data.user.isPro == null ? null : data.user.isPro ? "Yes" : "No"],
                ["Joined", new Date(data.user.createdAt).toLocaleDateString("en-IN")],
                ["Last login", data.user.lastLoginAt ? new Date(data.user.lastLoginAt).toLocaleString("en-IN") : "—"],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-slate-400 text-xs">{k}</dt>
                  <dd className="text-slate-800">{(v as string) || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-700 mb-3">Devices ({data.devices.length})</h2>
            <div className="space-y-2 text-sm">
              {data.devices.length === 0 && <p className="text-slate-400">No devices registered.</p>}
              {data.devices.map((d) => (
                <div key={d.deviceIdentifier} className="flex justify-between border-b border-slate-100 pb-2 last:border-0">
                  <span>
                    {[d.deviceManufacturer, d.deviceModel].filter(Boolean).join(" ") || "Unknown device"}
                    {d.osVersion && <span className="text-slate-400"> · {d.platform} {d.osVersion}</span>}
                  </span>
                  <span className="text-slate-500">
                    {d.appVersionName ? `v${d.appVersionName} (${d.appVersionCode})` : "—"} · seen{" "}
                    {new Date(d.lastSeenAt).toLocaleDateString("en-IN")}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-700 mb-3">Recent errors & crashes ({logs.length})</h2>
            {logs.length === 0 ? (
              <p className="text-sm text-slate-400">No error logs for this user.</p>
            ) : (
              <div className="space-y-2">
                {logs.map((l) => (
                  <details key={l.id} className="text-sm border border-slate-100 rounded-md">
                    <summary className="cursor-pointer px-3 py-2 flex gap-2 items-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${l.level === "ERROR" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {l.level}
                      </span>
                      <span className="text-slate-400 text-xs">{new Date(l.createdAt).toLocaleString("en-IN")}</span>
                      <span className="truncate flex-1">{l.message}</span>
                    </summary>
                    {l.metadata != null && (
                      <pre className="px-3 py-2 text-xs bg-slate-50 overflow-x-auto whitespace-pre-wrap border-t border-slate-100">
                        {typeof l.metadata === "string" ? l.metadata : JSON.stringify(l.metadata, null, 2)}
                      </pre>
                    )}
                  </details>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-700 mb-3">
              Screen activity — most visited ({data.total} events total)
            </h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {screens.slice(0, 12).map((s) => (
                <div key={s.screen} className="flex justify-between">
                  <span className="text-slate-700">{s.screen}</span>
                  <span className="text-slate-400">{s.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-700 mb-3">Recent screen timeline</h2>
            <div className="space-y-1 text-sm">
              {data.timeline.slice(0, 40).map((e) => (
                <div key={e.id} className="flex gap-3">
                  <span className="text-slate-400 text-xs w-36 shrink-0">
                    {new Date(e.createdAt).toLocaleString("en-IN")}
                  </span>
                  <span className="text-slate-700">{e.screen}</span>
                  {e.action && <span className="text-slate-400">· {e.action}</span>}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
