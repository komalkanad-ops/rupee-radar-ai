import * as Sentry from "@sentry/node";
import { createRequire } from "node:module";

// Error monitoring — no-ops until SENTRY_DSN is set (create a free Sentry account, add a Node
// project, paste the DSN into the backend's .env). Same "blocked on the user" pattern as the
// Firebase/Play Console integrations elsewhere in this project. Must be imported before anything
// else in the process entrypoint (see server.ts) per Sentry's Node SDK setup requirements.

const pkg = createRequire(import.meta.url)("../package.json") as { version?: string };

// Prisma's validation / known-request error messages embed the failing query arguments verbatim —
// for this app that means SMS-derived merchant names, amounts, and phone numbers. Those must not
// leave the process into a third-party service. This also catches the same shapes in any other
// error message.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?<!\d)(?:\+?91[- ]?)?[6-9]\d{9}(?!\d)/g;
const RUPEE_RE = /(?:₹|Rs\.?|INR)\s?[\d,]+(?:\.\d+)?/gi;

function scrubText(value: string): string {
  return value
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]")
    .replace(RUPEE_RE, "[amount]");
}

function scrubException(event: Sentry.ErrorEvent): void {
  for (const ex of event.exception?.values ?? []) {
    // Prisma bundles the whole offending query (args included) into `value`. Keep the type + code,
    // drop the body — the stack frames still point at the call site.
    if (ex.type?.startsWith("PrismaClient")) {
      ex.value = ex.value ? `${ex.type} (message redacted — see logs; contained query args)` : ex.value;
    } else if (ex.value) {
      ex.value = scrubText(ex.value);
    }
  }
  if (event.message) event.message = scrubText(event.message);
  // request bodies can carry the same PII; drop the parsed body outright.
  if (event.request?.data) event.request.data = "[redacted]";
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    // So "did the deploy of this version cause the spike?" is answerable in the issue view.
    release: `rupee-radar-ai-backend@${pkg.version ?? "unknown"}`,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      try {
        scrubException(event as Sentry.ErrorEvent);
      } catch {
        // A scrubber bug must never drop the event silently — send it, minus the request data.
        if (event.request) event.request.data = "[redacted]";
      }
      return event;
    },
  });
} else {
  console.warn("SENTRY_DSN not set — backend error monitoring is disabled");
}
