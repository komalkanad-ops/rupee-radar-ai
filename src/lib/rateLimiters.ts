import rateLimit from "express-rate-limit";

// General ceiling for every route — generous for a mobile-app backend (a single active user's
// device can easily fire a dozen requests loading one screen), just high enough to blunt scripted
// abuse without affecting real usage. `/sms/*` is exempt: a first full inbox backfill legitimately
// fires thousands of requests (per-message parse + chunked uploads) and has its own smsLimiter.
// `/categorization/*` is exempt for the same reason — it runs off the back of an SMS backfill and
// is mounted under smsLimiter too.
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/sms") || req.path.startsWith("/categorization"),
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
