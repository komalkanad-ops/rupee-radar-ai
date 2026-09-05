import rateLimit from "express-rate-limit";

// Admin-console-only surfaces (never called by the Android app) are all gated behind requireAdmin
// JWT auth already, so IP-based abuse protection buys nothing extra — but they DO share the same
// per-IP bucket as every anonymous/app request from that network. In practice the admin console and
// its operator's own diagnostic traffic (curl/scripts) usually run from the same home/office IP, and
// a page like User Activity fires several requests per load/tab-switch — easily exhausting a
// 300/15min ceiling shared with everything else on that IP, surfacing as a "continuous" 429 on those
// pages specifically (root-caused 2026-09-05: admin console + owner's own troubleshooting traffic
// both hammering api.rupeeradarai.com from the same IP during the repo-split migration). Own limiter.
const ADMIN_ONLY_PREFIXES = ["/feature-usage", "/analytics", "/admin/monitoring", "/users"];

// General ceiling for every route — generous for a mobile-app backend (a single active user's
// device can easily fire a dozen requests loading one screen), just high enough to blunt scripted
// abuse without affecting real usage. `/sms/*` is exempt: a first full inbox backfill legitimately
// fires thousands of requests (per-message parse + chunked uploads) and has its own smsLimiter.
// `/categorization/*` is exempt for the same reason — it runs off the back of an SMS backfill and
// is mounted under smsLimiter too. `ADMIN_ONLY_PREFIXES` are exempt per the comment above.
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path.startsWith("/sms") ||
    req.path.startsWith("/categorization") ||
    ADMIN_ONLY_PREFIXES.some((p) => req.path.startsWith(p)),
});

// Admin-console-only routes — see ADMIN_ONLY_PREFIXES above. Requires a valid admin JWT on every
// route it covers, so a much higher ceiling is safe; still bounded against a runaway console tab.
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3000,
  standardHeaders: true,
  legacyHeaders: false,
});

// The SMS backfill scan is an inherently high-request-count operation for a user with years of
// history — a much higher ceiling, still bounded so a runaway client can't hammer indefinitely.
export const smsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many SMS-sync requests — pause and let the current scan finish", retryable: true },
});

// Stricter limiter for the auth surface (OTP request/verify, session issuance, admin login) — these
// are the routes worth protecting specifically against brute-force/OTP-spam, where 300/15min would
// still allow a meaningful attack.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please wait a few minutes and try again" },
});
