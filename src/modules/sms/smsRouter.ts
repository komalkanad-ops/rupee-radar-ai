import { createHash } from "node:crypto";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { tryParseWithRules, categoryForTxnType, extractAvailableBalance, extractPaymentApp } from "./smsRules.js";
import { parseSmsWithLlm } from "../llm/meshClient.js";
import { categorizeMerchant } from "../categorization/merchantCategorizer.js";
import { requireAdmin, requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const smsRouter = Router();

// POST /sms/parse — { rawSms, bankSender } -> best-effort structured transaction, not yet stored.
// The Android app calls this only when its on-device regex table (mirrors smsRules.ts) misses.
// Regex parsing is free for everyone; the mesh-api (LLM) fallback for non-standard SMS formats is a
// PRO capability — free users get a clear proRequired flag instead of a silent drop, so the app can
// prompt an upgrade rather than losing the transaction.
smsRouter.post("/parse", requireUser, async (req: UserRequest, res) => {
  const { rawSms, bankSender } = req.body ?? {};
  if (!rawSms) return res.status(400).json({ error: "rawSms is required" });

  const ruleResult = bankSender ? tryParseWithRules(bankSender, rawSms) : null;
  if (ruleResult) {
    const category = categoryForTxnType(ruleResult.txnType, ruleResult.channel, ruleResult.merchant, categorizeMerchant);
    const balanceAfterTxn = extractAvailableBalance(rawSms);
    const paymentApp = extractPaymentApp(rawSms);
    return res.json({ ...ruleResult, category, balanceAfterTxn, paymentApp, parsedVia: "regex" });
  }

  const entitlement = await prisma.proEntitlement.findUnique({ where: { userId: req.userId! } });
  const isPro = entitlement?.status === "active" && (entitlement.expiryAt?.getTime() ?? 0) > Date.now();

  if (!isPro) {
    return res.json({
      amount: null,
      merchant: null,
      category: null,
      txnType: null,
      channel: null,
      parsedVia: "unparsed",
      proRequired: true,
    });
  }

  let llmResult;
  try {
    llmResult = await parseSmsWithLlm(rawSms);
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    // The mesh provider's own rate limit ("RPM limit of N req/min exceeded") is a transient,
    // expected condition during a big backfill scan — answer with a clean, retryable 429 instead
    // of letting it become a 500 + a Sentry error (it was flooding both).
    if (/rpm limit|rate.?limit|429|too many requests/i.test(msg)) {
      return res.status(429).json({ error: "AI parser is busy — try again shortly", retryable: true });
    }
    return res.status(502).json({ error: "AI parser is unavailable right now", retryable: true });
  }
  // extractAvailableBalance/extractPaymentApp run against the raw text directly, independent of
  // which path parsed the transaction — applies here too, not just the regex path above.
  res.json({
    ...llmResult,
    balanceAfterTxn: extractAvailableBalance(rawSms),
    paymentApp: extractPaymentApp(rawSms),
    parsedVia: "llm",
  });
});

// POST /sms/transactions — bulk ingest already-parsed transactions from the device. Upserts on
// (userId, rawSmsHash) rather than insert-only, so editing a transaction on-device and re-syncing
// updates the existing backend row instead of being silently skipped as a duplicate. Manual
// (non-SMS) entries use a stable random UUID as their "hash" so edits still upsert correctly.
smsRouter.post("/transactions", requireUser, async (req: UserRequest, res) => {
  const { transactions } = req.body ?? {};
  if (!Array.isArray(transactions)) {
    return res.status(400).json({ error: "transactions[] is required" });
  }
  // Keep each request (and its single Prisma $transaction below) small — a first full inbox scan
  // can produce thousands of rows; the client uploads them in chunks. Reject an oversized batch
  // with a clear, actionable error rather than a PayloadTooLargeError 500 or a huge DB transaction.
  const MAX_BATCH = 500;
  if (transactions.length > MAX_BATCH) {
    return res.status(413).json({ error: `Too many transactions in one request — send at most ${MAX_BATCH}`, maxBatch: MAX_BATCH });
  }
  const userId = req.userId!;

  const rows = transactions.map((t: any) => ({
    userId,
    rawSmsHash: t.rawSmsHash || createHash("sha256").update(t.rawSms ?? "").digest("hex"),
    bankSender: t.bankSender ?? null,
    amount: t.amount,
    merchant: t.merchant ?? null,
    category: t.category ?? categorizeMerchant(t.merchant),
    paymentMethod: t.paymentMethod ?? null,
    balanceAfterTxn: t.balanceAfterTxn ?? null,
    paymentApp: t.paymentApp ?? null,
    parsedVia: t.parsedVia ?? "regex",
    txnDate: new Date(t.txnDate),
  }));

  await prisma.$transaction(
    rows.map((data) =>
      prisma.smsTransaction.upsert({
        where: { userId_rawSmsHash: { userId: data.userId, rawSmsHash: data.rawSmsHash } },
        create: data,
        update: data,
      })
    )
  );

  res.status(201).json({ inserted: rows.length });
});

// DELETE /sms/transactions/by-hash/:hash?userId= — deletes a single transaction identified by its
// stable (userId, rawSmsHash) key. Used instead of a backend-generated id because the device never
// gets one back from the bulk-ingest endpoint above.
smsRouter.delete("/transactions/by-hash/:hash", requireUser, async (req: UserRequest, res) => {
  await prisma.smsTransaction.deleteMany({
    where: { userId: req.userId, rawSmsHash: req.params.hash },
  });
  res.status(204).send();
});

// Fixed merchantFallback strings from smsRules.ts's credit-type rules (see categoryForTxnType) —
// used here to backfill *existing* rows, which never had txnType/channel persisted (only the
// derived category), so they can't be re-classified the same way fresh parses now are. Only the
// rules with a fixed fallback string (not a dynamic merchantGroup capture, e.g. "credited from
// <name>") can be safely backfilled this way — dynamic-merchant credit rows stay uncategorized
// until re-synced from a fresh SMS scan, a known gap flagged rather than guessed at.
const INCOME_MERCHANT_FALLBACKS = [
  "HDFC Bank credit",
  "Kotak Bank transfer",
  "Kotak Bank credit",
  "IDFC FIRST Bank credit",
  "Pluxee wallet top-up",
];
const TRANSFER_MERCHANT_FALLBACKS = ["Credit card payment", "ICICI Bank credit", "IndusInd reversal", "Amex payment"];

// POST /sms/recategorize — admin-only. Backfills category for existing transactions where it's
// still null, using the merchant text already stored. Safe to re-run any time the taxonomy in
// merchantCategorizer.ts is extended — only touches rows that are still uncategorized.
smsRouter.post("/recategorize", requireAdmin, async (_req, res) => {
  const uncategorized = await prisma.smsTransaction.findMany({
    where: { category: null, merchant: { not: null } },
    select: { id: true, merchant: true },
  });

  let updated = 0;
  for (const txn of uncategorized) {
    const merchantLower = txn.merchant!.toLowerCase();
    const category =
      (INCOME_MERCHANT_FALLBACKS.some((m) => m.toLowerCase() === merchantLower) ? "income" : null) ??
      (TRANSFER_MERCHANT_FALLBACKS.some((m) => m.toLowerCase() === merchantLower) ? "transfer" : null) ??
      categorizeMerchant(txn.merchant);
    if (!category) continue;
    await prisma.smsTransaction.update({ where: { id: txn.id }, data: { category } });
    updated++;
  }

  res.json({ scanned: uncategorized.length, updated });
});

smsRouter.get("/transactions", requireUser, async (req: UserRequest, res) => {
  const { from, to } = req.query;
  // Bounded: this used to be an unbounded findMany that materialised a user's entire history into
  // memory on a memory-fragile host on every fresh-install re-hydrate. Default is a 25k safety cap
  // (≈20 bank SMS/day for 3+ years — beyond any real user), which the current "fetch all" client
  // stays correct under; `limit`/`offset` let a future client page explicitly.
  const DEFAULT_CAP = 25_000;
  const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_CAP, 1), DEFAULT_CAP);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const transactions = await prisma.smsTransaction.findMany({
    where: {
      userId: req.userId,
      txnDate: {
        gte: from ? new Date(String(from)) : undefined,
        lte: to ? new Date(String(to)) : undefined,
      },
    },
    orderBy: { txnDate: "desc" },
    take: limit,
    skip: offset,
  });
  res.json(transactions);
});

// GET /sms/balances — the most recently known "Available Balance" per bank, from whichever
// transaction with a non-null balanceAfterTxn is most recent for that bankSender. Deliberately
// per-bankSender (the literal DLT sender id, e.g. "JM-HDFCBK-S"), not per-bankName, since two
// accounts at the same bank would otherwise collapse into one row — a real, if uncommon, case this
// avoids getting wrong rather than silently merging.
smsRouter.get("/balances", requireUser, async (req: UserRequest, res) => {
  const rows = await prisma.smsTransaction.findMany({
    where: { userId: req.userId, balanceAfterTxn: { not: null }, bankSender: { not: null } },
    orderBy: { txnDate: "desc" },
    select: { bankSender: true, balanceAfterTxn: true, txnDate: true },
  });

  const latestPerBank = new Map<string, { bankSender: string; balanceAfterTxn: number; asOf: Date }>();
  for (const row of rows) {
    if (!latestPerBank.has(row.bankSender!)) {
      latestPerBank.set(row.bankSender!, { bankSender: row.bankSender!, balanceAfterTxn: row.balanceAfterTxn!, asOf: row.txnDate });
    }
  }

  res.json(Array.from(latestPerBank.values()).sort((a, b) => b.asOf.getTime() - a.asOf.getTime()));
});

// PATCH /sms/transactions/:id/tax-section — { taxSection: "80C" | "80D" | "80D_MEDICAL" | null } —
// lets a user confirm/override the auto-matched tax-nudge guess (see taxRouter.ts) on a specific
// transaction.
smsRouter.patch("/transactions/:id/tax-section", requireUser, async (req: UserRequest, res) => {
  const { taxSection } = req.body ?? {};
  const validSections = [null, "80C", "80D", "80D_MEDICAL"];
  if (!validSections.includes(taxSection)) {
    return res.status(400).json({ error: "taxSection must be '80C', '80D', '80D_MEDICAL', or null" });
  }

  const existing = await prisma.smsTransaction.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== req.userId) return res.status(404).json({ error: "Not found" });

  const item = await prisma.smsTransaction.update({ where: { id: req.params.id }, data: { taxSection } });
  res.json(item);
});
