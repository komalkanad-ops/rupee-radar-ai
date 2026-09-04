import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, CircleHelp } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { SkeletonRows } from "../components/Skeleton";

interface LiveCheck {
  url: string;
  status: "ok" | "down" | "unknown";
  httpStatus: number | null;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

interface SentryMonitor {
  id: string;
  webUrl: string;
  name: string | null;
  status: string | null;
  intervalSeconds: number | null;
  url: string | null;
}

interface StatusResponse {
  configured: boolean;
  dsnPresent: boolean;
  org: string;
  project: string;
  projectIssuesUrl: string;
  liveCheck: LiveCheck | null;
  sentryMonitor: SentryMonitor;
}

interface Issue {
  id: string;
  shortId: string | null;
  title: string;
  culprit: string | null;
  level: string | null;
  status: string | null;
  count: number;
  userCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  permalink: string | null;
}

interface IssuesResponse {
  configured: boolean;
  query?: string;
  issues: Issue[];
  error?: string;
}

interface RouteRow {
  method: string;
  route: string;
  calls: number;
  errorCount: number;
  clientErrs: number;
  errorRate: number;
  p50: number;
  p95: number;
  max: number;
}

interface DbTableSize {
  table: string;
  rows: number;
  dataMb: number;
  indexMb: number;
  totalMb: number;
}

interface DbResponse {
  window: string;
  probe: { connectMs: number | null; ok: boolean; checkedAt: string };
  connectMsSeries: { at: string; p50: number; p95: number; max: number; samples: number }[];
  tableSizes: DbTableSize[];
}

type MetricWindow = "1h" | "24h" | "7d";

// Hand-rolled SVG sparkline — repo convention is no charting library on the web/admin surfaces.
function Sparkline({ values, threshold, width = 160, height = 32 }: { values: number[]; threshold?: number; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-slate-300">not enough data</span>;
  const max = Math.max(...values, threshold ?? 0, 1);
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => `${i * stepX},${height - (v / max) * height}`).join(" ");
  const breached = threshold != null && values[values.length - 1] > threshold;
  return (
    <svg width={width} height={height} className="overflow-visible">
      {threshold != null && (
        <line
          x1={0}
          y1={height - (threshold / max) * height}
          x2={width}
          y2={height - (threshold / max) * height}
          stroke="#f43f5e"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
      )}
      <polyline points={points} fill="none" stroke={breached ? "#f43f5e" : "#0284c7"} strokeWidth={1.5} />
    </svg>
  );
}

const LEVEL_STYLES: Record<string, string> = {
  fatal: "bg-red-100 text-red-700",
  error: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  info: "bg-sky-100 text-sky-700",
  debug: "bg-slate-100 text-slate-600",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function LiveCheckBanner({ status }: { status: StatusResponse }) {
  const lc = status.liveCheck;
  const state = lc?.status ?? "unknown";
  const tone =
    state === "ok"
      ? { box: "border-emerald-200 bg-emerald-50", text: "text-emerald-700", Icon: CheckCircle2, label: "Operational" }
      : state === "down"
        ? { box: "border-red-200 bg-red-50", text: "text-red-700", Icon: AlertTriangle, label: "Down" }
        : { box: "border-slate-200 bg-slate-50", text: "text-slate-600", Icon: CircleHelp, label: "Unknown" };

  return (
    <div className={`rounded-xl border p-4 ${tone.box}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <tone.Icon size={20} className={tone.text} />
          <div>
            <div className={`font-semibold ${tone.text}`}>API health check — {tone.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {lc ? (
                <>
                  <code className="text-slate-600">{lc.url}</code>
                  {lc.httpStatus != null && <> · HTTP {lc.httpStatus}</>} · {lc.latencyMs}ms · checked {relativeTime(lc.checkedAt)}
                  {lc.error && <> · {lc.error}</>}
                </>
              ) : (
                "Live check runs only outside the test environment."
              )}
            </div>
          </div>
        </div>
        <a
          href={status.sentryMonitor.webUrl}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-brand hover:text-brand-dark"
        >
          Sentry uptime monitor <ExternalLink size={12} />
        </a>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
        <span>
          Uptime monitor:{" "}
          <span className="font-medium text-slate-700">
            {status.sentryMonitor.name ?? `#${status.sentryMonitor.id}`}
          </span>
          {status.sentryMonitor.status && <> ({status.sentryMonitor.status})</>}
          {status.sentryMonitor.intervalSeconds && <> · every {status.sentryMonitor.intervalSeconds}s</>}
        </span>
        <span>
          Sentry error monitoring:{" "}
          <span className={status.dsnPresent ? "font-medium text-emerald-600" : "font-medium text-amber-600"}>
            {status.dsnPresent ? "DSN configured" : "DSN not set"}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function Monitoring() {
  const toast = useToast();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuesConfigured, setIssuesConfigured] = useState(true);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [scope, setScope] = useState<"unresolved" | "all">("unresolved");
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [metricWindow, setMetricWindow] = useState<MetricWindow>("24h");
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [db, setDb] = useState<DbResponse | null>(null);
  const [loadingDb, setLoadingDb] = useState(true);

  const loadStatus = useCallback(() => {
    setLoadingStatus(true);
    api<StatusResponse>("/admin/monitoring/status")
      .then(setStatus)
      .catch((err) => toast.show(err.message ?? "Failed to load monitoring status", "error"))
      .finally(() => setLoadingStatus(false));
  }, [toast]);

  const loadIssues = useCallback(() => {
    setLoadingIssues(true);
    const query = scope === "unresolved" ? "is:unresolved" : "";
    api<IssuesResponse>(`/admin/monitoring/issues?query=${encodeURIComponent(query)}&limit=50`)
      .then((res) => {
        setIssuesConfigured(res.configured);
        setIssues(res.issues ?? []);
        setIssuesError(res.error ?? null);
      })
      .catch((err) => toast.show(err.message ?? "Failed to load Sentry issues", "error"))
      .finally(() => setLoadingIssues(false));
  }, [scope, toast]);

  const loadRoutes = useCallback(() => {
    setLoadingRoutes(true);
    api<{ routes: RouteRow[] }>(`/admin/monitoring/routes?window=${metricWindow}`)
      .then((res) => setRoutes(res.routes ?? []))
      .catch((err) => toast.show(err.message ?? "Failed to load route telemetry", "error"))
      .finally(() => setLoadingRoutes(false));
  }, [metricWindow, toast]);

  const loadDb = useCallback(() => {
    setLoadingDb(true);
    api<DbResponse>(`/admin/monitoring/db?window=${metricWindow}`)
      .then(setDb)
      .catch((err) => toast.show(err.message ?? "Failed to load database health", "error"))
      .finally(() => setLoadingDb(false));
  }, [metricWindow, toast]);

  useEffect(loadStatus, [loadStatus]);
  useEffect(loadIssues, [loadIssues]);
  useEffect(loadRoutes, [loadRoutes]);
  useEffect(loadDb, [loadDb]);

  async function resolve(issue: Issue) {
    setResolvingId(issue.id);
    try {
      await api(`/admin/monitoring/issues/${issue.id}/resolve`, { method: "POST" });
      toast.show(`Resolved ${issue.shortId ?? issue.title}`, "success");
      setIssues((prev) => prev.filter((i) => i.id !== issue.id));
    } catch (err: any) {
      toast.show(err.message ?? "Could not resolve the issue", "error");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold text-brand-dark">Monitoring</h1>
        <button
          onClick={() => {
            loadStatus();
            loadIssues();
            loadRoutes();
            loadDb();
          }}
          className="flex items-center gap-1 text-xs text-brand hover:text-brand-dark"
        >
          <RefreshCw size={13} className={loadingStatus || loadingIssues ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Backend uptime and Sentry errors, proxied server-side (the Sentry API token never reaches this
        page). Full history lives in{" "}
        {status ? (
          <a
            href={status.projectIssuesUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:text-brand-dark"
          >
            Sentry
          </a>
        ) : (
          "Sentry"
        )}
        .
      </p>

      {loadingStatus ? (
        <div className="rounded-xl border border-slate-200 p-4">
          <SkeletonRows rows={2} cols={2} />
        </div>
      ) : status ? (
        <LiveCheckBanner status={status} />
      ) : null}

      {/* Traffic + Database — the RouteMetricBucket rollup. Local telemetry, works when Sentry is
          rate-limited. The connectMs sparkline is the wedged-pool early warning. */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Traffic &amp; latency</h2>
          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-0.5 text-xs">
            {(["1h", "24h", "7d"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setMetricWindow(w)}
                className={`rounded px-2.5 py-1 ${
                  metricWindow === w ? "bg-white shadow-sm font-medium text-brand-dark" : "text-slate-500"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {loadingRoutes ? (
          <div className="bg-white rounded-xl shadow-sm p-5">
            <SkeletonRows rows={5} cols={5} />
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-500 text-left">
                <tr>
                  <th className="px-4 py-2">Route</th>
                  <th className="px-4 py-2 w-20 text-right">Calls</th>
                  <th className="px-4 py-2 w-20 text-right">Error %</th>
                  <th className="px-4 py-2 w-20 text-right">p50</th>
                  <th className="px-4 py-2 w-20 text-right">p95</th>
                  <th className="px-4 py-2 w-20 text-right">max</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {routes.map((r) => {
                  const pct = r.errorRate * 100;
                  return (
                    <tr key={`${r.method} ${r.route}`} className={pct >= 1 ? "bg-red-50" : ""}>
                      <td className="px-4 py-2">
                        <span className="text-[10px] font-semibold text-slate-400 mr-1.5">{r.method}</span>
                        <code className="text-slate-700">{r.route}</code>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.calls.toLocaleString()}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${pct >= 1 ? "font-semibold text-red-600" : "text-slate-500"}`}>
                        {pct >= 0.05 ? `${pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">{r.p50}ms</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${r.p95 >= 1500 ? "font-semibold text-amber-600" : "text-slate-500"}`}>
                        {r.p95}ms
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-400">{r.max}ms</td>
                    </tr>
                  );
                })}
                {routes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-400">
                      No traffic recorded in this window yet — rollup buckets flush every 5 minutes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Database</h2>
        {loadingDb ? (
          <div className="bg-white rounded-xl shadow-sm p-5">
            <SkeletonRows rows={4} cols={3} />
          </div>
        ) : db ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-slate-500">Connect latency (SELECT 1)</span>
                <span
                  className={`text-lg font-semibold tabular-nums ${
                    db.probe.connectMs == null
                      ? "text-red-600"
                      : db.probe.connectMs > 1500
                        ? "text-amber-600"
                        : "text-emerald-600"
                  }`}
                >
                  {db.probe.connectMs == null ? "unreachable" : `${db.probe.connectMs}ms`}
                </span>
              </div>
              <div className="mt-2">
                <Sparkline values={db.connectMsSeries.map((s) => s.p95)} threshold={1500} width={280} height={40} />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                p95 per 5-min bucket · red line = 1500ms alert threshold. A sustained ramp here preceded both
                prior DB outages.
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-500 text-left">
                  <tr>
                    <th className="px-3 py-2">Table</th>
                    <th className="px-3 py-2 w-20 text-right">Rows</th>
                    <th className="px-3 py-2 w-20 text-right">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {db.tableSizes.slice(0, 10).map((t) => (
                    <tr key={t.table}>
                      <td className="px-3 py-1.5 text-slate-700">{t.table}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{t.rows.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{t.totalMb}MB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Sentry issues</h2>
          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-0.5 text-xs">
            {(["unresolved", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`rounded px-2.5 py-1 capitalize ${
                  scope === s ? "bg-white shadow-sm font-medium text-brand-dark" : "text-slate-500"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {!issuesConfigured ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            <div className="font-semibold">Sentry API token not configured</div>
            <p className="mt-1 text-amber-700">
              Add <code className="rounded bg-amber-100 px-1">SENTRY_API_TOKEN</code> (a Sentry org auth
              token with <code>org:read</code>, <code>project:read</code>, <code>event:read</code>, and{" "}
              <code>alerts:write</code> scopes) to the backend environment to list and resolve issues
              here. The uptime status above works without it.
            </p>
          </div>
        ) : loadingIssues ? (
          <div className="bg-white rounded-xl shadow-sm p-5">
            <SkeletonRows rows={5} cols={4} />
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            {issuesError && (
              <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                Sentry API error: {issuesError}
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-500 text-left">
                <tr>
                  <th className="px-4 py-2">Issue</th>
                  <th className="px-4 py-2 w-20">Events</th>
                  <th className="px-4 py-2 w-20">Users</th>
                  <th className="px-4 py-2 w-28">Last seen</th>
                  <th className="px-4 py-2 w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {issues.map((issue) => (
                  <tr key={issue.id}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {issue.level && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              LEVEL_STYLES[issue.level] ?? "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {issue.level}
                          </span>
                        )}
                        <span className="font-medium text-brand-dark">{issue.title}</span>
                        {issue.permalink && (
                          <a href={issue.permalink} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-brand">
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                      {issue.culprit && <div className="text-xs text-slate-400 mt-0.5">{issue.culprit}</div>}
                    </td>
                    <td className="px-4 py-2.5">{issue.count.toLocaleString()}</td>
                    <td className="px-4 py-2.5">{issue.userCount.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-slate-500">{relativeTime(issue.lastSeen)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {issue.status === "resolved" ? (
                        <span className="text-xs text-emerald-600">resolved</span>
                      ) : (
                        <button
                          onClick={() => resolve(issue)}
                          disabled={resolvingId === issue.id}
                          className="text-xs text-brand hover:text-brand-dark disabled:opacity-50"
                        >
                          {resolvingId === issue.id ? "Resolving…" : "Resolve"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {issues.length === 0 && !issuesError && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      No {scope === "unresolved" ? "unresolved " : ""}issues 🎉
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
