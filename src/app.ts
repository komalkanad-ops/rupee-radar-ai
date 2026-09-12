// Redeploy trigger, 2026-08-22 — the previous backend-root push wasn't picked up by Hostinger's
// build pipeline after 90+ minutes; this touch forces a genuinely new commit SHA to retry the
// webhook. Safe to remove this comment in a future edit.
import "dotenv/config";
import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import * as Sentry from "@sentry/node";

import { prisma } from "./lib/prisma.js";
import { authRouter } from "./modules/auth/authRouter.js";
import { cardsRouter, banksRouter, portalsRouter } from "./modules/cards/cardsRouter.js";
import { correctionsRouter } from "./modules/corrections/correctionsRouter.js";
import { smsRouter } from "./modules/sms/smsRouter.js";
import { recurringRouter } from "./modules/recurring/recurringRouter.js";
import { lendingRouter } from "./modules/lending/lendingRouter.js";
import { todoRouter } from "./modules/todo/todoRouter.js";
import { parkingRouter } from "./modules/parking/parkingRouter.js";
import { productsRouter } from "./modules/products/productsRouter.js";
import { wishlistRouter } from "./modules/wishlist/wishlistRouter.js";
import { loanRouter } from "./modules/loans/loanRouter.js";
import { savingsRouter } from "./modules/savings/savingsRouter.js";
import { subscriptionProvidersRouter } from "./modules/recurring/subscriptionProvidersRouter.js";
import { networthRouter } from "./modules/networth/networthRouter.js";
import { insightsRouter } from "./modules/insights/insightsRouter.js";
import { budgetRouter } from "./modules/budgets/budgetRouter.js";
import { goalRouter } from "./modules/goals/goalRouter.js";
import { investmentRouter } from "./modules/investments/investmentRouter.js";
import { siteContentRouter } from "./modules/siteContent/siteContentRouter.js";
import { placesRouter } from "./modules/places/placesRouter.js";
import { merchantRecommendationsRouter } from "./modules/places/merchantRecommendationsRouter.js";
import { billingRouter } from "./modules/billing/billingRouter.js";
import { configRouter } from "./modules/config/configRouter.js";
import { pushRouter } from "./modules/push/pushRouter.js";
import { usersRouter } from "./modules/users/usersRouter.js";
import { statementRouter } from "./modules/statements/statementRouter.js";
import { healthScoreRouter } from "./modules/healthscore/healthScoreRouter.js";
import { walletRouter } from "./modules/wallet/walletRouter.js";
import { challengesRouter } from "./modules/challenges/challengesRouter.js";
import { cashflowRouter } from "./modules/cashflow/cashflowRouter.js";
import { taxRouter } from "./modules/tax/taxRouter.js";
import { householdRouter } from "./modules/household/householdRouter.js";
import { offersRouter } from "./modules/offers/offersRouter.js";
import { benchmarksRouter } from "./modules/benchmarks/benchmarksRouter.js";
import { referralsRouter } from "./modules/rewards/referralsRouter.js";
import { rewardsRouter } from "./modules/rewards/rewardsRouter.js";
import { accountAggregatorRouter } from "./modules/accountAggregator/accountAggregatorRouter.js";
import { creditScoreRouter } from "./modules/creditscore/creditScoreRouter.js";
import { billPaymentRouter } from "./modules/billpayment/billPaymentRouter.js";
import { feedbackRouter } from "./modules/feedback/feedbackRouter.js";
import { bugReportRouter } from "./modules/bugReports/bugReportRouter.js";
import { appVersionRouter } from "./modules/appVersion/appVersionRouter.js";
import { chatRouter } from "./modules/chat/chatRouter.js";
import { featureFlagsRouter } from "./modules/featureFlags/featureFlagsRouter.js";
import { announcementsRouter } from "./modules/announcements/announcementsRouter.js";
import { logsRouter } from "./modules/logs/logsRouter.js";
import { meshUsageRouter } from "./modules/meshUsage/meshUsageRouter.js";
import { changelogRouter } from "./modules/changelog/changelogRouter.js";
import { merchantOverridesRouter } from "./modules/merchantOverrides/merchantOverridesRouter.js";
import { classifyRouter } from "./modules/categorization/classifyRouter.js";
import { featureUsageRouter } from "./modules/featureUsage/featureUsageRouter.js";
import { analyticsRouter } from "./modules/analytics/analyticsRouter.js";
import { loginBypassRouter } from "./modules/loginBypass/loginBypassRouter.js";
import { monitoringRouter } from "./modules/monitoring/monitoringRouter.js";
import { generalLimiter, smsLimiter, adminLimiter } from "./lib/rateLimiters.js";
import { requestId, requestLog, getRequestId } from "./lib/requestId.js";
import { routeMetrics, recordMetric } from "./lib/routeMetrics.js";

// Just the Express app — no listen(), no cron scheduler bootstrap. Separated from server.ts so
// tests (Supertest) can import and exercise the app directly without starting a real network
// listener or scheduling real cron jobs in the test process.
export const app = express();
// Hostinger's edge sits in front of this process (confirmed by the documented intermittent
// 502/503 behavior below), so requests arrive with X-Forwarded-For set — trust exactly one hop so
// express-rate-limit keys on the real client IP instead of the proxy's, which would otherwise
// either rate-limit every user as one bucket or make the limiter reject requests outright.
app.set("trust proxy", 1);

// Correlation id — mounted first so every response (even a helmet/cors/limiter rejection) carries
// X-Request-Id and every Sentry event is tagged with it. See lib/requestId.ts.
app.use(requestId);

// Security headers. CSP is off — this API serves JSON + a couple of tiny error/health pages, never
// an app shell, so a policy would only be noise; the valuable bits are nosniff, frameguard, HSTS,
// and a tight referrer policy. `crossOriginResourcePolicy: false` so the public website can still
// read /cards etc. cross-origin.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: { maxAge: 15552000, includeSubDomains: true },
  }),
);

// CORS allowlist — the API is called cross-origin only by the two first-party static sites; the
// Android app is a native client (no Origin header) and server-to-server callers (Razorpay
// webhook) send none either. A request with no Origin is allowed through; a browser request from
// anything not on this list is refused. `*.rupeeradarai.com` covers the apex + admin + www; any
// localhost port is allowed for local dev.
const ALLOWED_ORIGINS = [/^https:\/\/([a-z0-9-]+\.)?rupeeradarai\.com$/, /^http:\/\/localhost(:\d+)?$/];
app.use(
  cors({
    origin(origin, cb) {
      // `false` (not an Error) — omit the CORS headers so the browser blocks it, without turning a
      // disallowed cross-origin request into a 500.
      cb(null, !origin || ALLOWED_ORIGINS.some((re) => re.test(origin)));
    },
    credentials: true,
  }),
);
// Razorpay's webhook signature is an HMAC over the RAW, unparsed request body — express.json()'s
// `verify` hook runs on the raw buffer before parsing, so this stashes it on req.rawBody without
// needing a separate raw-body middleware or a route-registration-order trick (both parse-once
// approaches risk double-consuming the request stream).
// 2mb (up from the 100kb default): the SMS backfill's POST /sms/transactions sends batches of a few
// hundred parsed transactions at once — a first full inbox scan blew past 100kb and 500'd as a
// PayloadTooLargeError (the client also chunks now, but this keeps a comfortable margin).
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { (req as any).rawBody = buf.toString(); } }));

// Health endpoints are mounted BEFORE generalLimiter (300/15min, IP-keyed): the Sentry uptime
// monitor, the admin Monitoring page's live check, and any future probe could otherwise share an
// egress IP and 429 each other into a false "outage" alert. These three are cheap and read-only.
app.get("/", (_req, res) =>
  res.json({ ok: true, service: "rupee-radar-ai-api", docs: "see /health and /cards" })
);
app.get("/health", (_req, res) => res.json({ ok: true, service: "rupee-radar-ai-api" }));

// Deep health check — actually touches the database (a trivial SELECT 1) so an external uptime
// monitor can tell "process alive but DB unreachable" (the exact failure mode of the 2026-08-22
// and 2026-08-29 outages) apart from a genuinely healthy API. Returns 503 (not 500) on failure so
// the monitor trips without this looking like an application bug. Cheap enough to poll every
// minute; deliberately unauthenticated.
//
// DB_PROBE_TIMEOUT_MS bounds how long this handler can take, independent of whether the
// underlying `$queryRaw` ever resolves. Hostinger support traced a September 2026 outage to this
// exact query hanging for ~5,000 SECONDS per call against a wedged DB connection — on this host's
// Passenger-style worker model, a request that never completes ties up its worker indefinitely,
// so every 60s poll (the Sentry uptime monitor) piles on a fresh worker until the shared hosting
// account's 120-process ceiling is hit and EVERY app on the account starts 500ing, not just this
// one. Racing the query against a short timeout guarantees this handler always responds quickly
// and frees its worker, even though it can't cancel the underlying hung Prisma call itself.
const DB_PROBE_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`db probe timed out after ${ms}ms`)), ms)),
  ]);
}

app.get("/health/db", async (_req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_PROBE_TIMEOUT_MS);
    const connectMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    // Feed the round-trip time into the metrics rollup as a synthetic route so the wedged-pool
    // ramp is charted, not just sampled — this is the leading indicator for both prior outages.
    recordMetric("GET", "__db_probe", connectMs, 200);
    res.json({ ok: true, db: "up", connectMs, uptimeS: Math.round(process.uptime()), pid: process.pid });
  } catch (err: any) {
    const connectMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    recordMetric("GET", "__db_probe", connectMs, 503);
    if (!res.headersSent) res.status(503).json({ ok: false, db: "down", connectMs });
    // The 503 IS the signal (the uptime monitor trips on it). A transient connect-timeout —
    // Hostinger's DB is briefly unreachable a few dozen times a day, retries succeed, 0 users
    // impacted — does NOT need its own Sentry event; re-throwing every one generated ~250 near-
    // identical `PrismaClientKnownRequestError` events in 4 days (BACKEND-5). Only re-throw the
    // unrecoverable engine panic, which still needs the shared handler's process-exit self-heal.
    if (err?.name === "PrismaClientRustPanicError") throw err;
    console.error("health/db check failed (transient):", err?.code ?? err?.name ?? err);
  }
});

app.use(generalLimiter);

// Request telemetry + structured request log — mounted after the health probes (so they don't
// dominate the rollup; DB latency is fed in explicitly above as `__db_probe`) but before the
// routers, so a 429 or an auth 401 is still counted. Both are finish-hooks: zero cost until the
// response completes, and wrapped so telemetry can never affect the response.
app.use(routeMetrics);
app.use(requestLog);

// Reports whether Sentry error monitoring is actually live on this running process — the only way
// to tell "SENTRY_DSN set and the SDK initialized" apart from "env var missing/malformed" from
// outside (same pattern as /auth/admin/firebase-diagnostics). Returns booleans only, never the DSN.
// `?test=1` also sends one throwaway event so you can confirm events reach the Sentry project
// end-to-end, not just that init succeeded.
app.get("/health/sentry", (req, res) => {
  const initialized = !!Sentry.getClient();
  if (initialized && req.query.test === "1") {
    Sentry.captureMessage("health/sentry end-to-end probe", "info");
  }
  res.json({ dsnConfigured: !!process.env.SENTRY_DSN, initialized });
});

// No blanket authLimiter here anymore — it's now applied per-route inside authRouter, only on
// /admin/login and /phone/request-otp (see that file's own comment for why). Every other /auth
// route still gets the generalLimiter above.
app.use("/auth", authRouter);
app.use("/cards", cardsRouter);
app.use("/banks", banksRouter);
app.use("/redemption-portals", portalsRouter);
app.use("/corrections", correctionsRouter);
app.use("/sms", smsLimiter, smsRouter);
app.use("/recurring", recurringRouter);
app.use("/lending", lendingRouter);
app.use("/todo", todoRouter);
app.use("/parking", parkingRouter);
app.use("/products", productsRouter);
app.use("/wishlist", wishlistRouter);
app.use("/loans", loanRouter);
app.use("/savings", savingsRouter);
app.use("/subscription-providers", subscriptionProvidersRouter);
app.use("/networth", networthRouter);
app.use("/insights", insightsRouter);
app.use("/budgets", budgetRouter);
app.use("/goals", goalRouter);
app.use("/investments", investmentRouter);
app.use("/site-content", siteContentRouter);
app.use("/places", placesRouter);
app.use("/merchant-recommendations", merchantRecommendationsRouter);
app.use("/billing", billingRouter);
app.use("/config", configRouter);
app.use("/push", pushRouter);
app.use("/statements", statementRouter);
app.use("/health-score", healthScoreRouter);
app.use("/wallet", walletRouter);
app.use("/challenges", challengesRouter);
app.use("/cashflow", cashflowRouter);
app.use("/tax", taxRouter);
app.use("/household", householdRouter);
app.use("/offers", offersRouter);
app.use("/benchmarks", benchmarksRouter);
app.use("/referrals", referralsRouter);
app.use("/rewards", rewardsRouter);
app.use("/account-aggregator", accountAggregatorRouter);
app.use("/credit-score", creditScoreRouter);
app.use("/bill-payment", billPaymentRouter);
app.use("/feedback", feedbackRouter);
app.use("/bug-reports", bugReportRouter);
app.use("/admin/login-bypass", loginBypassRouter);
app.use("/app-version", appVersionRouter);
app.use("/chat", chatRouter);
app.use("/feature-flags", featureFlagsRouter);
app.use("/announcements", announcementsRouter);
app.use("/logs", logsRouter);
app.use("/mesh-usage", meshUsageRouter);
app.use("/changelog", changelogRouter);
app.use("/merchant-overrides", merchantOverridesRouter);
// smsLimiter (5000/15min), not generalLimiter — this runs as a follow-up step of an SMS backfill.
app.use("/categorization", smsLimiter, classifyRouter);
// adminLimiter (3000/15min), not generalLimiter — see ADMIN_ONLY_PREFIXES in rateLimiters.ts.
app.use("/feature-usage", adminLimiter, featureUsageRouter);
app.use("/analytics", adminLimiter, analyticsRouter);
app.use("/admin/monitoring", adminLimiter, monitoringRouter);
app.use("/users", adminLimiter, usersRouter);

// Sentry's Express error handler — captures the exception WITH request/route/transaction context
// (the bare `Sentry.captureException(err)` this replaces had none, so issues in Monitoring.tsx
// showed no route and no user). Registered before the custom handler below; it only captures 5xx /
// unstatused errors and then calls next(err), so the custom handler still runs.
Sentry.setupExpressErrorHandler(app);

// A failed Prisma query (or any other route error) must return a 500 to that one request, never
// take down the whole process silently. express-async-errors (imported above) routes async route
// rejections here instead of letting them become unhandled rejections.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = getRequestId(req);
  console.error(`Request error [${requestId}]:`, err);
  if (!res.headersSent) {
    // Common Prisma errors have an obvious HTTP mapping — a `.update`/`.delete` on a row that
    // doesn't exist (P2025) is a 404, not a server fault. Roughly 30 admin `:id` routes were
    // returning 500 (+ a Sentry event) for what is a routine "not found". CLAUDE.md records only
    // one such route (`PATCH /bug-reports/:id/status`, `BACKEND-2`); this is the general fix.
    // `requestId` is echoed in every error body so a user/admin can quote it and the owner can
    // find the exact server log line + Sentry event.
    if (err?.code === "P2025") {
      res.status(404).json({ error: "Not found", requestId });
    } else if (err?.code === "P2002") {
      res.status(409).json({ error: "That already exists", requestId });
    } else if (err?.name === "PrismaClientValidationError") {
      // The message embeds the query args — never send it to the client (the Sentry scrubber
      // handles the copy that goes to Sentry).
      res.status(400).json({ error: "Invalid request", requestId });
    } else {
      res.status(500).json({ error: "Something went wrong processing that request", requestId });
    }
  }

  // "PANIC: timer has gone away" (confirmed via production logs) leaves the native query engine
  // permanently broken for the rest of this process's life — every subsequent query fails
  // identically, and disconnecting the JS client does NOT reload the underlying native library.
  // The only real fix is a fresh process. Hostinger's supervisor restarts a crashed Node process in
  // well under a second (confirmed live), so exiting here — after this response has already been
  // sent — trades one request's worth of downtime for actually recovering, instead of every request
  // failing identically until someone notices and restarts it manually.
  if (err?.name === "PrismaClientRustPanicError") {
    console.error("Unrecoverable Prisma engine panic — exiting so the platform restarts a fresh process");
    setImmediate(() => process.exit(1));
  }
});

// Last-resort net: log and keep serving other requests instead of letting the process die. Only
// wired when this module is loaded as part of the real server, not per-test — see server.ts.
export function installProcessCrashGuards() {
  process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err);
    Sentry.captureException(err);
  });
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    Sentry.captureException(err);
  });
}
