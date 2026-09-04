const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function getToken() {
  return localStorage.getItem("rr_admin_token");
}

export function setToken(token: string) {
  localStorage.setItem("rr_admin_token", token);
}

export function clearToken() {
  localStorage.removeItem("rr_admin_token");
  localStorage.removeItem("rr_admin_role");
}

// UX-only — used to hide/badge nav items an admin's role can't act on. The backend independently
// enforces every RBAC boundary via requireRole regardless of what this says, so a stale/tampered
// value here can never grant real access, only ever hide a link a VIEWER couldn't use anyway.
export function getRole(): string {
  return localStorage.getItem("rr_admin_role") || "SUPER_ADMIN";
}

export function setRole(role: string) {
  localStorage.setItem("rr_admin_role", role);
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [300, 800, 1500];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The Hostinger deployment intermittently returns a fast 502/503 from its edge for a random
// subset of requests — confirmed by hammering multiple unrelated endpoints back to back and
// seeing different ones fail each time, independent of anything the app sends. Retrying
// transparently here is a real fix for that instability from the client side. Only network-level
// failures and 502/503/504 responses are retried; genuine application errors (4xx) return
// immediately, never retried.
function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `adm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let lastNetworkError: Error | null = null;
  // One id per logical call, reused across all retry attempts, so the whole retry chain shares a
  // single line in the admin Logs search. Surfaced in the thrown error message on failure.
  const requestId = newRequestId();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
    } catch (err) {
      lastNetworkError = err instanceof Error ? err : new Error("Network request failed");
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw lastNetworkError;
    }

    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const ref = body.requestId || res.headers.get("X-Request-Id") || requestId;
      throw new Error(`${body.error || `Request failed: ${res.status}`} (ref ${ref})`);
    }
    if (res.status === 204) return undefined as T;
    return await res.json();
  }

  throw lastNetworkError ?? new Error("Request failed after retries");
}

// Multipart upload — the browser must set its own `Content-Type` (with the boundary), so this
// can't go through `api()` which always sends JSON. No retry loop: an upload isn't idempotent.
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return await res.json();
}

export const API_BASE = API_BASE_URL;
