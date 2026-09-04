import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";

// A single correlation id threaded through every request. Before this, a user-reported bug
// ("sync failed around 3pm") could not be joined to a server log or a Sentry event — triage was
// guesswork over a `createdAt` window. Now: the client generates the id, sends it as X-Request-Id,
// the server echoes it on EVERY response (including errors), tags the Sentry scope with it, and
// puts it in the structured request-log line. The client shows it in an error toast / attaches it
// to a bug report, so the owner can paste one string into the admin Logs search.

const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function getRequestId(req: Request): string {
  return (req as any).requestId ?? "-";
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  // Honour a well-formed client-supplied id so client and server agree on one value; reject
  // anything that isn't a plain 8-64 char token so it can't be used for log injection.
  const supplied = String(req.header("X-Request-Id") ?? "");
  const id = VALID_ID.test(supplied) ? supplied : randomUUID();
  (req as any).requestId = id;
  res.setHeader("X-Request-Id", id);
  Sentry.getCurrentScope().setTag("request_id", id);
  next();
}

// Structured one-line JSON log per completed request — no logging library, `JSON.stringify` to
// stdout keeps Hostinger's log viewer greppable. Skipped for the health probes (they'd drown the
// log) and under test.
const QUIET_PATHS = new Set(["/health", "/health/db", "/health/sentry", "/"]);

export function requestLog(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === "test") return next();
  const startedAt = Date.now();
  res.on("finish", () => {
    if (QUIET_PATHS.has(req.path)) return;
    const line = {
      ts: new Date().toISOString(),
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      requestId: getRequestId(req),
      userId: (req as any).userId ?? (req as any).adminId ?? null,
      method: req.method,
      path: req.baseUrl + (req.route?.path && req.route.path !== "/" ? req.route.path : req.path.slice(req.baseUrl.length) || "/"),
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    };
    try {
      console.log(JSON.stringify(line));
    } catch {
      /* never let a logging failure break the response lifecycle */
    }
  });
  next();
}
