import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin, requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const rewardsRouter = Router();

async function getBalance(userId: string): Promise<number> {
  const result = await prisma.coinLedgerEntry.aggregate({ where: { userId }, _sum: { delta: true } });
  return result._sum.delta ?? 0;
}

rewardsRouter.get("/balance", requireUser, async (req: UserRequest, res) => {
  res.json({ balance: await getBalance(req.userId!) });
});

rewardsRouter.get("/ledger", requireUser, async (req: UserRequest, res) => {
  const entries = await prisma.coinLedgerEntry.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(entries);
});

// GET /rewards/vouchers — active catalog only, mirrors GET /offers. NEVER returns `code`/`pin`
// (that would let anyone read a gift-card code without spending coins) — only whether redeeming
// is instant.
rewardsRouter.get("/vouchers", requireUser, async (_req, res) => {
  const vouchers = await prisma.voucher.findMany({
    where: { active: true },
    orderBy: { coinCost: "asc" },
    select: {
      id: true, title: true, description: true, coinCost: true, imageUrl: true,
      stockRemaining: true, active: true, code: true,
    },
  });
  res.json(vouchers.map(({ code, ...v }) => ({ ...v, instant: !!code })));
});

// GET /rewards/redemptions — the caller's own redemption history, including any revealed code/PIN
// for instant vouchers and the admin fulfilment note for manually-fulfilled ones.
rewardsRouter.get("/redemptions", requireUser, async (req: UserRequest, res) => {
  const rows = await prisma.voucherRedemption.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    include: { voucher: { select: { title: true, imageUrl: true } } },
  });
  res.json(
    rows.map((r) => ({
      id: r.id,
      voucherTitle: r.voucher.title,
      imageUrl: r.voucher.imageUrl,
      coinsCost: r.coinsCost,
      status: r.status,
      code: r.revealedCode,
      pin: r.revealedPin,
      fulfillmentNote: r.fulfillmentNote,
      createdAt: r.createdAt,
      fulfilledAt: r.fulfilledAt,
    })),
  );
});

// POST /rewards/vouchers/:id/redeem — atomic: verify balance + stock, decrement stock, record the
// redemption and a negative ledger entry together so nothing can go out of sync under concurrent
// requests.
rewardsRouter.post("/vouchers/:id/redeem", requireUser, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const voucherId = req.params.id;

  try {
    const redemption = await prisma.$transaction(async (tx) => {
      const voucher = await tx.voucher.findUnique({ where: { id: voucherId } });
      if (!voucher || !voucher.active) throw Object.assign(new Error("Voucher not found"), { httpStatus: 404 });
      if (voucher.stockRemaining !== null && voucher.stockRemaining <= 0) {
        throw Object.assign(new Error("Voucher is out of stock"), { httpStatus: 409 });
      }

      const balanceResult = await tx.coinLedgerEntry.aggregate({ where: { userId }, _sum: { delta: true } });
      const balance = balanceResult._sum.delta ?? 0;
      if (balance < voucher.coinCost) {
        throw Object.assign(new Error("Not enough coins"), { httpStatus: 402 });
      }

      if (voucher.stockRemaining !== null) {
        await tx.voucher.update({ where: { id: voucherId }, data: { stockRemaining: { decrement: 1 } } });
      }

      // Instant if the admin pre-loaded a code — the user gets it right away and the redemption is
      // already FULFILLED. Otherwise it goes to the manual fulfilment queue as before.
      const instant = !!voucher.code;
      const created = await tx.voucherRedemption.create({
        data: {
          userId,
          voucherId,
          coinsCost: voucher.coinCost,
          status: instant ? "FULFILLED" : "PENDING_FULFILLMENT",
          fulfilledAt: instant ? new Date() : null,
          revealedCode: instant ? voucher.code : null,
          revealedPin: instant ? voucher.pin : null,
        },
      });
      await tx.coinLedgerEntry.create({
        data: { userId, delta: -voucher.coinCost, reason: "VOUCHER_REDEMPTION", relatedId: created.id },
      });
      return created;
    });
    res.status(201).json({
      id: redemption.id,
      voucherId: redemption.voucherId,
      coinsCost: redemption.coinsCost,
      status: redemption.status,
      code: redemption.revealedCode,
      pin: redemption.revealedPin,
      createdAt: redemption.createdAt,
    });
  } catch (err: any) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ error: err.message });
    throw err;
  }
});

// --- Admin: voucher catalog CRUD ---

// Whitelist the fields an admin can set — never let arbitrary req.body keys through to Prisma.
function voucherInput(body: any) {
  const out: Record<string, unknown> = {};
  if (typeof body?.title === "string") out.title = body.title.trim();
  if (body?.description === null || typeof body?.description === "string") out.description = body.description || null;
  if (body?.coinCost !== undefined) out.coinCost = Math.max(0, Math.trunc(Number(body.coinCost)));
  if (body?.imageUrl === null || typeof body?.imageUrl === "string") out.imageUrl = body.imageUrl || null;
  if (body?.stockRemaining === null || body?.stockRemaining === undefined) out.stockRemaining = null;
  else if (Number.isFinite(Number(body.stockRemaining))) out.stockRemaining = Math.max(0, Math.trunc(Number(body.stockRemaining)));
  if (body?.code === null || typeof body?.code === "string") out.code = body.code?.trim() || null;
  if (body?.pin === null || typeof body?.pin === "string") out.pin = body.pin?.trim() || null;
  if (typeof body?.active === "boolean") out.active = body.active;
  return out;
}

rewardsRouter.post("/admin/vouchers", requireAdmin, async (req, res) => {
  const data = voucherInput(req.body);
  if (!data.title || data.coinCost === undefined) {
    return res.status(400).json({ error: "title and coinCost are required" });
  }
  const voucher = await prisma.voucher.create({ data: data as any });
  res.status(201).json(voucher);
});

rewardsRouter.put("/admin/vouchers/:id", requireAdmin, async (req, res) => {
  const voucher = await prisma.voucher.update({ where: { id: req.params.id }, data: voucherInput(req.body) });
  res.json(voucher);
});

// GET /rewards/admin/vouchers — full rows INCLUDING code/pin, admin-only (the user-facing
// GET /rewards/vouchers strips those).
rewardsRouter.get("/admin/vouchers", requireAdmin, async (_req, res) => {
  const vouchers = await prisma.voucher.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { redemptions: true } } },
  });
  res.json(vouchers);
});

rewardsRouter.delete("/admin/vouchers/:id", requireAdmin, async (req, res) => {
  await prisma.voucher.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// --- Admin: redemption fulfillment queue — manual fulfillment, no live voucher-issuing API exists
// (same "sandbox/manual now, real automation is a business step" framing as AA/bureau/payment-
// gateway phases) ---

rewardsRouter.get("/admin/redemptions", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const redemptions = await prisma.voucherRedemption.findMany({
    where: { status: status ? String(status) as any : undefined },
    include: { voucher: true, user: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(redemptions);
});

// Cancelling refunds the spent coins and restores stock — a cancelled redemption shouldn't leave
// the user out of pocket for a voucher they never received.
rewardsRouter.patch("/admin/redemptions/:id", requireAdmin, async (req, res) => {
  const { status, fulfillmentNote } = req.body ?? {};
  if (status !== "FULFILLED" && status !== "CANCELLED") {
    return res.status(400).json({ error: "status must be FULFILLED or CANCELLED" });
  }

  const redemption = await prisma.$transaction(async (tx) => {
    const existing = await tx.voucherRedemption.findUniqueOrThrow({ where: { id: req.params.id } });
    if (status === "CANCELLED" && existing.status !== "CANCELLED") {
      await tx.coinLedgerEntry.create({
        data: { userId: existing.userId, delta: existing.coinsCost, reason: "ADMIN_ADJUSTMENT", relatedId: existing.id },
      });
      const voucher = await tx.voucher.findUnique({ where: { id: existing.voucherId } });
      if (voucher?.stockRemaining !== null && voucher?.stockRemaining !== undefined) {
        await tx.voucher.update({ where: { id: existing.voucherId }, data: { stockRemaining: { increment: 1 } } });
      }
    }
    return tx.voucherRedemption.update({
      where: { id: req.params.id },
      data: { status, fulfillmentNote, fulfilledAt: status === "FULFILLED" ? new Date() : null },
    });
  });
  res.json(redemption);
});
