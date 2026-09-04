import { apiPost } from "./api";

// First-party, self-hosted analytics — no third-party service (Google Analytics/Plausible/etc.
// all need an external account signup, out of scope here). Fire-and-forget: a tracking failure
// must never surface to the user or block navigation.
export function trackPageview(path: string) {
  apiPost("/analytics/event", { path, eventType: "pageview" }).catch(() => {});
}

export function trackEvent(eventType: string, metadata?: Record<string, unknown>) {
  apiPost("/analytics/event", { path: window.location.pathname, eventType, metadata }).catch(() => {});
}
