// Every admin-gated test in this suite calls adminToken() and silently `return`s if login fails
// (see e.g. test/featureFlags.test.ts) — a deliberate "skip gracefully when the admin bootstrap
// isn't configured in this environment" convention for local dev. In CI, that convention would
// mean every admin-gated test silently no-ops on a fresh database with nothing to catch it. This
// bootstraps the same admin row the /auth/admin/bootstrap route would create, once, before the
// suite runs, so CI actually exercises those tests instead of quietly skipping all of them.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export default async function setup() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) return;

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.adminUser.count();
    if (existing === 0) {
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.adminUser.create({ data: { email, passwordHash } });
    }
  } finally {
    await prisma.$disconnect();
  }
}
