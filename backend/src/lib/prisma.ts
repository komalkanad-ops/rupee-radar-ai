import { PrismaClient } from "@prisma/client";

// Lazily constructed. Hostinger's Node.js App hosting forks worker processes from a pre-loaded
// parent (confirmed via live logs: "PANIC: timer has gone away" on 100% of fresh processes, always
// on the very first query) — a classic symptom of a Rust async runtime's timer thread being started
// before a fork, then inherited (dead) by the forked child. Constructing PrismaClient eagerly at
// module-import time — before the app even calls listen() — is exactly the pattern that triggers
// this. Deferring construction until the first real query means the native engine's threads only
// ever start inside an already-forked worker process.
let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!client) client = new PrismaClient();
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient() as object, prop, receiver);
  },
});
