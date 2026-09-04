// Thin server-side client for Sentry's REST API, used only by the admin console's Monitoring page.
// SENTRY_API_TOKEN is a Sentry *org auth token* (scopes: org:read, project:read, event:read, and
// alerts:write if you want the "resolve" action) — it must never reach the browser, hence this
// proxy. Everything degrades gracefully: no token => `isConfigured()` is false and the router
// returns `{ configured: false }` instead of erroring, same convention as the mesh-api / Places /
// Firebase integrations elsewhere in this codebase.

const SENTRY_API_TOKEN = process.env.SENTRY_API_TOKEN;
export const SENTRY_ORG_SLUG = process.env.SENTRY_ORG_SLUG || "rupee-radar-ai";
export const SENTRY_PROJECT_SLUG = process.env.SENTRY_PROJECT_SLUG || "backend";
// Sentry Cloud is region-partitioned; this project's org lives in the US region. Override only for
// a self-hosted instance or an EU-region org.
export const SENTRY_REGION_URL = (process.env.SENTRY_REGION_URL || "https://us.sentry.io").replace(/\/$/, "");
export const SENTRY_UPTIME_MONITOR_ID = process.env.SENTRY_UPTIME_MONITOR_ID || "8324377";
// Numeric project id — only needed for the org-scoped issues endpoint's `project` filter. Resolved
// from the slug on first use and cached; this env var is just a hard fallback.
const SENTRY_PROJECT_ID_FALLBACK = process.env.SENTRY_PROJECT_ID || "4511993421234176";

export function isConfigured(): boolean {
  return !!SENTRY_API_TOKEN;
}

export function sentryWebBaseUrl(): string {
  return `https://${SENTRY_ORG_SLUG}.sentry.io`;
}

export class SentryApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SentryApiError";
  }
}

async function sentryFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!SENTRY_API_TOKEN) throw new SentryApiError("SENTRY_API_TOKEN is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${SENTRY_REGION_URL}/api/0${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${SENTRY_API_TOKEN}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const text = await res.text();
    const body = text ? safeJson(text) : null;
    if (!res.ok) {
      const detail = (body && (body.detail || body.error)) || `HTTP ${res.status}`;
      throw new SentryApiError(`Sentry API: ${detail}`, res.status);
    }
    return body as T;
  } catch (err) {
    if (err instanceof SentryApiError) throw err;
    if ((err as Error)?.name === "AbortError") throw new SentryApiError("Sentry API request timed out");
    throw new SentryApiError((err as Error)?.message || "Sentry API request failed");
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- tiny in-memory TTL cache (per process; fine for a single-admin console) --------------------

const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function cached<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await produce();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidateIssueCache() {
  for (const key of cache.keys()) if (key.startsWith("issues:")) cache.delete(key);
}

// ---- resolved-once helpers --------------------------------------------------------------------

async function projectId(): Promise<string> {
  return cached("projectId", 60 * 60 * 1000, async () => {
    try {
      const project = await sentryFetch<{ id: string }>(
        `/projects/${SENTRY_ORG_SLUG}/${SENTRY_PROJECT_SLUG}/`,
      );
      return project?.id || SENTRY_PROJECT_ID_FALLBACK;
    } catch {
      return SENTRY_PROJECT_ID_FALLBACK;
    }
  });
}

// ---- public shapes ---------------------------------------------------------------------------

export interface TrimmedIssue {
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

function trimIssue(raw: any): TrimmedIssue {
  return {
    id: String(raw.id),
    shortId: raw.shortId ?? null,
    title: raw.title ?? raw.metadata?.type ?? "(untitled)",
    culprit: raw.culprit ?? null,
    level: raw.level ?? null,
    status: raw.status ?? null,
    count: Number(raw.count ?? 0),
    userCount: Number(raw.userCount ?? 0),
    firstSeen: raw.firstSeen ?? null,
    lastSeen: raw.lastSeen ?? null,
    permalink: raw.permalink ?? null,
  };
}

export async function listIssues(query: string, limit: number): Promise<TrimmedIssue[]> {
  const q = query.trim();
  const cappedLimit = Math.min(Math.max(limit || 25, 1), 100);
  return cached(`issues:${q}:${cappedLimit}`, 60 * 1000, async () => {
    const pid = await projectId();
    const params = new URLSearchParams({
      project: pid,
      limit: String(cappedLimit),
      statsPeriod: "14d",
    });
    // An empty query means "all issues" to Sentry; only send `query` when non-empty so the default
    // (is:unresolved) applies when the caller wants unresolved.
    if (q) params.set("query", q);
    const raw = await sentryFetch<any[]>(`/organizations/${SENTRY_ORG_SLUG}/issues/?${params.toString()}`);
    return (raw || []).map(trimIssue);
  });
}

export interface IssueDetail extends TrimmedIssue {
  metadata: Record<string, unknown> | null;
  latestEvent: { id: string; title: string | null; message: string | null; dateCreated: string | null } | null;
}

export async function getIssue(id: string): Promise<IssueDetail> {
  const raw = await sentryFetch<any>(`/organizations/${SENTRY_ORG_SLUG}/issues/${encodeURIComponent(id)}/`);
  let latestEvent: IssueDetail["latestEvent"] = null;
  try {
    const ev = await sentryFetch<any>(
      `/organizations/${SENTRY_ORG_SLUG}/issues/${encodeURIComponent(id)}/events/latest/`,
    );
    if (ev) {
      latestEvent = {
        id: String(ev.id ?? ev.eventID ?? ""),
        title: ev.title ?? null,
        message: ev.message ?? ev.metadata?.value ?? null,
        dateCreated: ev.dateCreated ?? ev.dateReceived ?? null,
      };
    }
  } catch {
    // latest event is best-effort enrichment — a missing one shouldn't fail the whole detail view
  }
  return { ...trimIssue(raw), metadata: raw.metadata ?? null, latestEvent };
}

export async function resolveIssue(id: string): Promise<void> {
  await sentryFetch(
    `/organizations/${SENTRY_ORG_SLUG}/issues/?id=${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify({ status: "resolved" }) },
  );
  invalidateIssueCache();
}

export interface UptimeMonitorInfo {
  id: string;
  webUrl: string;
  name: string | null;
  status: string | null;
  intervalSeconds: number | null;
  url: string | null;
}

export async function getUptimeMonitor(): Promise<UptimeMonitorInfo> {
  const base: UptimeMonitorInfo = {
    id: SENTRY_UPTIME_MONITOR_ID,
    webUrl: `${sentryWebBaseUrl()}/monitors/${SENTRY_UPTIME_MONITOR_ID}/`,
    name: null,
    status: null,
    intervalSeconds: null,
    url: null,
  };
  return cached("uptimeMonitor", 60 * 1000, async () => {
    // Sentry has moved uptime monitors under a few different API shapes over time; try the
    // org-scoped monitor endpoint and fall back to the static link on any 404/shape mismatch.
    try {
      const raw = await sentryFetch<any>(
        `/organizations/${SENTRY_ORG_SLUG}/monitors/${SENTRY_UPTIME_MONITOR_ID}/`,
      );
      return {
        ...base,
        name: raw?.name ?? raw?.config?.name ?? null,
        status: raw?.status ?? raw?.uptimeStatus ?? null,
        intervalSeconds:
          raw?.intervalSeconds ?? raw?.config?.intervalSeconds ?? raw?.config?.schedule ?? null,
        url: raw?.url ?? raw?.config?.url ?? null,
      };
    } catch {
      return base;
    }
  });
}
