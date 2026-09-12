import { PrismaClient } from "@prisma/client";

// Hostinger's shared-hosting plan caps the account at 120 active processes total across every app
// (web/admin/api). A request that hangs on a wedged DB connection never releases its process slot,
// so a handful of hung connections can exhaust the account-wide ceiling and take down apps that
// have nothing to do with the DB (root-caused via Hostinger support chat, see
// HostingerLogs/hostinger 500 Error Chat.md and memory project_backend_500_outage_2026-08-22).
// These are the MySQL-connector URL params Prisma actually supports (confirmed against Prisma docs
// — `socket_timeout` is a Postgres-only param and does NOT exist for MySQL, so it's deliberately
// omitted rather than silently ignored or rejected):
//   - connect_timeout: seconds to wait when opening a new connection (default 5s)
//   - pool_timeout: seconds to wait for a connection to free up from the pool (default 10s)
//   - connection_limit: max pool size (default is CPU-core-based; pinned explicitly here since this
//     host's process ceiling makes an unbounded/large pool actively dangerous)
// This bounds connection *acquisition*, not an already-open connection stuck mid-query — there is
// no MySQL-connector URL param for that. The existing `/health/db` withTimeout() wrapper (app.ts)
// is what protects the health-check probe itself from a hung in-flight query.
export function withConnectionTimeouts(url: string): string {
  const [base, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  if (!params.has("connect_timeout")) params.set("connect_timeout", "10");
  if (!params.has("pool_timeout")) params.set("pool_timeout", "10");
  if (!params.has("connection_limit")) params.set("connection_limit", "5");
  return `${base}?${params.toString()}`;
}

// Lazily constructed. Hostinger's Node.js App hosting forks worker processes from a pre-loaded
// parent (confirmed via live logs: "PANIC: timer has gone away" on 100% of fresh processes, always
// on the very first query) — a classic symptom of a Rust async runtime's timer thread being started
// before a fork, then inherited (dead) by the forked child. Constructing PrismaClient eagerly at
// module-import time — before the app even calls listen() — is exactly the pattern that triggers
// this. Deferring construction until the first real query means the native engine's threads only
// ever start inside an already-forked worker process.
let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!client) {
    const url = process.env.DATABASE_URL;
    client = url
      ? new PrismaClient({ datasources: { db: { url: withConnectionTimeouts(url) } } })
      : new PrismaClient();
  }
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient() as object, prop, receiver);
  },
});
