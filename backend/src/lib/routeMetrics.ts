import type { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { prisma } from "./prisma.js";

// Per-route request telemetry with a 5-minute rollup. The design constraint is the host: a
// memory-fragile shared box that has been bitten by per-request cost before. So this keeps ONE
// in-process accumulator of the current + previous few buckets, and a background flush writes at
// most a handful of rows every 5 minutes (one upsert per route per bucket), never per request.
//
// This is the layer the DB-outage early warning hangs off: the documented wedged-pool failure
// (memory project_backend_500_outage_2026-08-22, recurred 2026-08-29) presents as p95 ramping to a
// flat ~5s BEFORE connections fully fail. Today that ramp is unobservable; the uptime monitor only
// trips after total failure + ~3 min. A charted `__db_probe` p95 series is the missing leading
// indicator.

const BUCKET_MS = 5 * 60_000;
const MAX_SAMPLES_PER_KEY = 2_000; // reservoir cap — percentiles stay accurate, memory stays bounded

interface Acc {
  count: number;
  errorCount: number;
  clientErrs: number;
  durations: number[];
  maxMs: number;
}

// bucketAtEpoch -> routeKey ("METHOD route") -> Acc
const buckets = new Map<number, Map<string, Acc>>();

function bucketFloor(ts: number): number {
  return Math.floor(ts / BUCKET_MS) * BUCKET_MS;
}

function accFor(bucketAt: number, key: string): Acc {
  let byKey = buckets.get(bucketAt);
  if (!byKey) {
    byKey = new Map();
    buckets.set(bucketAt, byKey);
  }
  let acc = byKey.get(key);
  if (!acc) {
    acc = { count: 0, errorCount: 0, clientErrs: 0, durations: [], maxMs: 0 };
    byKey.set(key, acc);
  }
  return acc;
}

export function recordMetric(method: string, route: string, durationMs: number, status: number) {
  const bucketAt = bucketFloor(Date.now());
  const acc = accFor(bucketAt, `${method} ${route}`);
  acc.count++;
  if (status >= 500) acc.errorCount++;
  else if (status >= 400) acc.clientErrs++;
  if (acc.durations.length < MAX_SAMPLES_PER_KEY) acc.durations.push(durationMs);
  if (durationMs > acc.maxMs) acc.maxMs = durationMs;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

// Express finish-hook middleware — mounted early so it wraps every route. `req.route?.path` is only
// populated after routing, which has happened by the time `finish` fires. Unmatched URLs (404s)
// collapse to a single "(unmatched)" key so a scanner hitting random paths can't explode
// cardinality.
export function routeMetrics(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const pattern = req.route?.path
        ? req.baseUrl + (req.route.path === "/" ? "" : req.route.path)
        : "(unmatched)";
      recordMetric(req.method, pattern || "/", durationMs, res.statusCode);
    } catch {
      /* telemetry must never affect the response */
    }
  });
  next();
}

async function flushClosedBuckets() {
  const currentBucket = bucketFloor(Date.now());
  for (const [bucketAt, byKey] of buckets) {
    if (bucketAt >= currentBucket) continue; // still filling — leave it
    for (const [key, acc] of byKey) {
      const spaceIdx = key.indexOf(" ");
      const method = key.slice(0, spaceIdx);
      const route = key.slice(spaceIdx + 1);
      const sorted = [...acc.durations].sort((a, b) => a - b);
      const data = {
        count: acc.count,
        errorCount: acc.errorCount,
        clientErrs: acc.clientErrs,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs: Math.round(acc.maxMs),
      };
      try {
        await prisma.routeMetricBucket.upsert({
          where: { bucketAt_method_route: { bucketAt: new Date(bucketAt), method, route } },
          create: { bucketAt: new Date(bucketAt), method, route, ...data },
          // Multi-worker safety: counts merge via increment; percentiles take the larger view
          // (a per-worker approximation is acceptable for a trend indicator, not billing).
          update: {
            count: { increment: data.count },
            errorCount: { increment: data.errorCount },
            clientErrs: { increment: data.clientErrs },
            p50Ms: Math.max(data.p50Ms, 0),
            p95Ms: data.p95Ms,
            maxMs: data.maxMs,
          },
        });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: "routeMetrics.flush" } });
      }
    }
    buckets.delete(bucketAt);
  }
}

let flushTimer: NodeJS.Timeout | null = null;

// Started from server.ts only (not app.ts) so the test process never schedules a real timer or
// touches the DB on a cadence. `.unref()` so it can't hold the process open on shutdown.
export function startRouteMetricsFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushClosedBuckets().catch(() => {});
  }, 60_000);
  flushTimer.unref();
}

export function stopRouteMetricsFlush() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}

// ---- read side (admin monitoring) ----

const WINDOWS: Record<string, number> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};

export function windowMs(window: string | undefined): number {
  return WINDOWS[window ?? "24h"] ?? WINDOWS["24h"];
}

export interface RouteSummary {
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

export async function routeSummaries(window: string | undefined): Promise<RouteSummary[]> {
  const since = new Date(Date.now() - windowMs(window));
  const rows = await prisma.routeMetricBucket.findMany({
    where: { bucketAt: { gte: since }, NOT: { route: "__db_probe" } },
    orderBy: { bucketAt: "asc" },
  });
  const byRoute = new Map<string, { method: string; route: string; calls: number; err: number; cerr: number; p50s: number[]; p95s: number[]; max: number }>();
  for (const r of rows) {
    const key = `${r.method} ${r.route}`;
    let agg = byRoute.get(key);
    if (!agg) {
      agg = { method: r.method, route: r.route, calls: 0, err: 0, cerr: 0, p50s: [], p95s: [], max: 0 };
      byRoute.set(key, agg);
    }
    agg.calls += r.count;
    agg.err += r.errorCount;
    agg.cerr += r.clientErrs;
    if (r.p50Ms > 0) agg.p50s.push(r.p50Ms);
    if (r.p95Ms > 0) agg.p95s.push(r.p95Ms);
    if (r.maxMs > agg.max) agg.max = r.maxMs;
  }
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  return [...byRoute.values()]
    .map((a) => ({
      method: a.method,
      route: a.route,
      calls: a.calls,
      errorCount: a.err,
      clientErrs: a.cerr,
      errorRate: a.calls ? a.err / a.calls : 0,
      p50: median(a.p50s),
      p95: a.p95s.length ? Math.max(...a.p95s) : 0,
      max: a.max,
    }))
    .sort((x, y) => y.errorRate - x.errorRate || y.p95 - x.p95);
}

export async function routeTimeline(route: string, method: string | undefined, window: string | undefined) {
  const since = new Date(Date.now() - windowMs(window));
  const rows = await prisma.routeMetricBucket.findMany({
    where: { bucketAt: { gte: since }, route, ...(method ? { method } : {}) },
    orderBy: { bucketAt: "asc" },
  });
  return rows.map((r) => ({
    at: r.bucketAt.toISOString(),
    calls: r.count,
    errorCount: r.errorCount,
    p50: r.p50Ms,
    p95: r.p95Ms,
    max: r.maxMs,
  }));
}
