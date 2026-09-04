import { Router } from "express";
import { requireAdmin } from "../auth/authMiddleware.js";
import { prisma } from "../../lib/prisma.js";
import { routeSummaries, routeTimeline } from "../../lib/routeMetrics.js";
import {
  isConfigured,
  listIssues,
  getIssue,
  resolveIssue,
  getUptimeMonitor,
  sentryWebBaseUrl,
  SentryApiError,
  SENTRY_ORG_SLUG,
  SENTRY_PROJECT_SLUG,
} from "./sentryClient.js";

export const monitoringRouter = Router();

// Everything the admin console's Monitoring page needs, proxied server-side so SENTRY_API_TOKEN
// never reaches the browser. All routes are requireAdmin. Nothing here 500s just because a token
// is missing — an unconfigured integration returns `{ configured: false }` with a 200, matching
// the mesh-api / Places / Firebase "degrade gracefully" convention.

const HEALTH_CHECK_URL = process.env.MONITORING_HEALTH_CHECK_URL || "https://api.rupeeradarai.com/health/db";

async function liveHealthCheck() {
  // Skipped under test so the suite doesn't depend on an outbound call to production.
  if (process.env.NODE_ENV === "test") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const startedAt = Date.now();
  try {
    const res = await fetch(HEALTH_CHECK_URL, { signal: controller.signal });
    return {
      url: HEALTH_CHECK_URL,
      status: res.ok ? ("ok" as const) : ("down" as const),
      httpStatus: res.status,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      url: HEALTH_CHECK_URL,
      status: "unknown" as const,
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error: (err as Error)?.name === "AbortError" ? "timed out" : (err as Error)?.message || "request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// GET /admin/monitoring/status — is monitoring wired up, plus a live self-check of the DB health
// endpoint and (when configured) the Sentry uptime monitor's own state.
monitoringRouter.get("/status", requireAdmin, async (_req, res) => {
  const configured = isConfigured();
  const [liveCheck, sentryMonitor] = await Promise.all([
    liveHealthCheck(),
    configured ? getUptimeMonitor().catch(() => null) : Promise.resolve(null),
  ]);

  res.json({
    configured,
    dsnPresent: !!process.env.SENTRY_DSN,
    org: SENTRY_ORG_SLUG,
    project: SENTRY_PROJECT_SLUG,
    projectIssuesUrl: `${sentryWebBaseUrl()}/issues/?project=${SENTRY_PROJECT_SLUG}`,
    liveCheck,
    sentryMonitor: sentryMonitor ?? {
      id: process.env.SENTRY_UPTIME_MONITOR_ID || "8324377",
      webUrl: `${sentryWebBaseUrl()}/monitors/${process.env.SENTRY_UPTIME_MONITOR_ID || "8324377"}/`,
      name: null,
      status: null,
      intervalSeconds: null,
      url: null,
    },
  });
});

// GET /admin/monitoring/issues?query=is:unresolved&limit=25
monitoringRouter.get("/issues", requireAdmin, async (req, res) => {
  if (!isConfigured()) return res.json({ configured: false, issues: [] });
  const query = typeof req.query.query === "string" ? req.query.query : "is:unresolved";
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 25;
  try {
    const issues = await listIssues(query, Number.isFinite(limit) ? limit : 25);
    res.json({ configured: true, query, issues });
  } catch (err) {
    // Don't 500 and don't leak the token — surface the Sentry-side error to the admin UI as data.
    res.json({ configured: true, query, issues: [], error: sentryErrorMessage(err) });
  }
});

// GET /admin/monitoring/issues/:id — one issue's detail + its latest event summary.
monitoringRouter.get("/issues/:id", requireAdmin, async (req, res) => {
  if (!isConfigured()) return res.json({ configured: false, issue: null });
  try {
    const issue = await getIssue(req.params.id);
    res.json({ configured: true, issue });
  } catch (err) {
    const status = err instanceof SentryApiError && err.status === 404 ? 404 : 200;
    res.status(status).json({ configured: true, issue: null, error: sentryErrorMessage(err) });
  }
});

// POST /admin/monitoring/issues/:id/resolve — mark an issue resolved in Sentry.
monitoringRouter.post("/issues/:id/resolve", requireAdmin, async (req, res) => {
  if (!isConfigured()) {
    return res.status(501).json({ error: "SENTRY_API_TOKEN is not configured" });
  }
  try {
    await resolveIssue(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: sentryErrorMessage(err) });
  }
});

function sentryErrorMessage(err: unknown): string {
  if (err instanceof SentryApiError) return err.message;
  return (err as Error)?.message || "Sentry request failed";
}

// GET /admin/monitoring/routes?window=1h|24h|7d — per-route call volume, error rate and p50/p95,
// sorted worst-first. The Traffic table on the Monitoring page. Data is the RouteMetricBucket
// rollup (lib/routeMetrics.ts) — local, so it works even when Sentry is rate-limited.
monitoringRouter.get("/routes", requireAdmin, async (req, res) => {
  const window = typeof req.query.window === "string" ? req.query.window : "24h";
  res.json({ window, routes: await routeSummaries(window) });
});

// GET /admin/monitoring/timeline?route=/cards&method=GET&window=24h — the 5-minute bucket series
// for one route, for the drill-down sparkline.
monitoringRouter.get("/timeline", requireAdmin, async (req, res) => {
  const route = typeof req.query.route === "string" ? req.query.route : "";
  if (!route) return res.status(400).json({ error: "route is required" });
  const method = typeof req.query.method === "string" ? req.query.method : undefined;
  const window = typeof req.query.window === "string" ? req.query.window : "24h";
  res.json({ route, method: method ?? null, window, buckets: await routeTimeline(route, method, window) });
});

// --- Database health card ---

interface TableSize {
  table: string;
  rows: number;
  dataMb: number;
  indexMb: number;
  totalMb: number;
}
let tableSizeCache: { at: number; rows: TableSize[] } | null = null;
const TABLE_SIZE_TTL_MS = 60 * 60_000;

async function tableSizes(): Promise<TableSize[]> {
  if (tableSizeCache && Date.now() - tableSizeCache.at < TABLE_SIZE_TTL_MS) return tableSizeCache.rows;
  try {
    const raw = await prisma.$queryRawUnsafe<
      Array<{ table_name: string; table_rows: bigint | number; data_length: bigint | number; index_length: bigint | number }>
    >(
      `SELECT table_name, table_rows, data_length, index_length
       FROM information_schema.TABLES
       WHERE table_schema = DATABASE()
       ORDER BY (data_length + index_length) DESC`,
    );
    const rows = raw.map((r) => {
      const data = Number(r.data_length) / 1e6;
      const index = Number(r.index_length) / 1e6;
      return {
        table: String(r.table_name),
        rows: Number(r.table_rows),
        dataMb: Math.round(data * 10) / 10,
        indexMb: Math.round(index * 10) / 10,
        totalMb: Math.round((data + index) * 10) / 10,
      };
    });
    tableSizeCache = { at: Date.now(), rows };
    return rows;
  } catch {
    return tableSizeCache?.rows ?? [];
  }
}

// GET /admin/monitoring/db?window=24h — live connect probe + the __db_probe latency series +
// cached table sizes. The connectMs series is the wedged-pool early-warning chart.
monitoringRouter.get("/db", requireAdmin, async (req, res) => {
  const window = typeof req.query.window === "string" ? req.query.window : "24h";
  const startedAt = process.hrtime.bigint();
  let probe: { connectMs: number | null; ok: boolean; checkedAt: string };
  try {
    await prisma.$queryRaw`SELECT 1`;
    probe = { connectMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6), ok: true, checkedAt: new Date().toISOString() };
  } catch {
    probe = { connectMs: null, ok: false, checkedAt: new Date().toISOString() };
  }
  const [series, sizes] = await Promise.all([routeTimeline("__db_probe", "GET", window), tableSizes()]);
  res.json({
    window,
    probe,
    // routeTimeline reports latency as p50/p95/max of the connectMs values recorded that bucket.
    connectMsSeries: series.map((b) => ({ at: b.at, p50: b.p50, p95: b.p95, max: b.max, samples: b.calls })),
    tableSizes: sizes,
  });
});
