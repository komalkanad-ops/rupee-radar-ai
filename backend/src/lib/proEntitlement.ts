import type { Prisma, ProEntitlement } from "@prisma/client";

/**
 * Extends (or creates) a user's ProEntitlement by `days`, stacking on top of any existing
 * unexpired entitlement rather than overwriting it — "extend from the later of (existing expiry,
 * now)". This is what lets PRO-granting sources (purchases, vouchers, referrals) all add on top of
 * each other instead of one clobbering another's remaining time.
 *
 * Race-safe under concurrent calls for the same user via an optimistic read-then-conditional-write
 * retry loop: the underlying UPDATE's own row lock is what actually serializes two concurrent
 * writers, a lost race just means "someone else updated it first," so retry with a fresh read
 * rather than erroring out. Originally inline in proPurchaseRouter.ts's /redeem (see that file's
 * history for the reasoning) — extracted here once a second caller (referralsRouter.ts) needed the
 * exact same logic, to avoid a second copy of this correctness-critical loop drifting out of sync.
 *
 * Must be called inside the SAME transaction (`tx`) as whatever one-time claim precedes it (e.g.
 * marking a voucher/referral consumed) so a rollback on a later failure also undoes that claim.
 */
export async function extendProEntitlementDays(
  tx: Prisma.TransactionClient,
  userId: string,
  days: number,
  productId: string,
): Promise<ProEntitlement> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await tx.proEntitlement.findUnique({ where: { userId } });
    const existingExpiryMs = existing?.status === "active" ? (existing.expiryAt?.getTime() ?? 0) : 0;
    const expiryAt = new Date(Math.max(existingExpiryMs, Date.now()) + days * 24 * 60 * 60 * 1000);
    if (!existing) {
      try {
        return await tx.proEntitlement.create({
          data: { userId, productId, expiryAt, verifiedAt: new Date(), status: "active" },
        });
      } catch (err: any) {
        if (err?.code === "P2002" && attempt < 4) continue; // someone else created it first — retry as an update
        throw err;
      }
    }
    const updated = await tx.proEntitlement.updateMany({
      where: { userId, expiryAt: existing.expiryAt, status: existing.status },
      data: { productId, expiryAt, verifiedAt: new Date(), status: "active" },
    });
    if (updated.count === 1) return tx.proEntitlement.findUniqueOrThrow({ where: { userId } });
    if (attempt === 4) throw new Error("Could not extend PRO entitlement due to a concurrent update — please retry");
  }
  throw new Error("Could not extend PRO entitlement due to a concurrent update — please retry");
}
