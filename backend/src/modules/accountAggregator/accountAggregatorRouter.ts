import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { categorizeMerchant } from "../categorization/merchantCategorizer.js";
import {
  createConsent,
  getConsentStatus,
  createDataSession,
  getSessionData,
  isSetuConfigured,
  type SetuTransaction,
} from "./setuClient.js";

const NOT_CONFIGURED_ERROR = {
  error: "Account Aggregator bank-linking is not configured yet — set SETU_CLIENT_ID, " +
    "SETU_CLIENT_SECRET, SETU_PRODUCT_INSTANCE_ID, and SETU_BASE_URL",
};

export const accountAggregatorRouter = Router();

// Maps Setu's transaction shape onto the existing SmsTransaction table (see BankLink's schema
// comment for why this is additive-into-the-same-table rather than a parallel model) — every
// feature that already reads SmsTransaction benefits automatically. Dedupe key mirrors the
// existing "manual entry" precedent of repurposing rawSmsHash for a non-SMS origin.
export async function ingestAccountAggregatorTransactions(userId: string, transactions: SetuTransaction[]) {
  const rows = transactions.map((t) => ({
    userId,
    rawSmsHash: `aa:${t.txnId}`,
    bankSender: null as string | null,
    amount: Math.abs(Number(t.amount)),
    merchant: t.narration ?? null,
    category: t.type === "CREDIT" ? "income" : categorizeMerchant(t.narration),
    parsedVia: "account_aggregator",
    txnDate: new Date(t.transactionTimestamp),
  }));

  if (rows.length === 0) return 0;

  await prisma.$transaction(
    rows.map((data) =>
      prisma.smsTransaction.upsert({
        where: { userId_rawSmsHash: { userId: data.userId, rawSmsHash: data.rawSmsHash } },
        create: data,
        update: data,
      }),
    ),
  );
  return rows.length;
}

// POST /account-aggregator/link — { vua? } — starts a new consent request, scoped to DEPOSIT
// (bank accounts) only. Returns the hosted webview URL for Android to open in a Custom Tab.
accountAggregatorRouter.post("/link", requireUser, async (req: UserRequest, res) => {
  if (!isSetuConfigured()) return res.status(501).json(NOT_CONFIGURED_ERROR);
  const userId = req.userId!;
  const { vua } = req.body ?? {};

  const consent = await createConsent(vua);
  await prisma.bankLink.create({
    data: {
      userId,
      consentId: consent.id,
      status: consent.status,
      fiTypes: (consent.detail?.fiTypes ?? ["DEPOSIT"]).join(","),
      consentExpiry: consent.detail?.consentExpiry ? new Date(consent.detail.consentExpiry) : null,
    },
  });
  res.status(201).json({ consentId: consent.id, redirectUrl: consent.url });
});

// GET /account-aggregator/status — the caller's most recent bank link, re-checked live against
// Setu (Android polls this on app-resume after the Custom Tab closes — there's no deep-link
// infra to catch a redirect automatically).
accountAggregatorRouter.get("/status", requireUser, async (req: UserRequest, res) => {
  const link = await prisma.bankLink.findFirst({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  if (!link) return res.json(null);

  const live = await getConsentStatus(link.consentId);
  const updated = await prisma.bankLink.update({
    where: { id: link.id },
    data: { status: live.status },
  });
  res.json(updated);
});

// POST /account-aggregator/sync — given an ACTIVE consent, creates a data session and fetches +
// ingests whatever's ready. Bounded retries since sandbox data fetch isn't instant. Works whether
// or not the webhook below is configured, so the feature is testable without relying on a push
// notification arriving correctly.
accountAggregatorRouter.post("/sync", requireUser, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const link = await prisma.bankLink.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  if (!link) return res.status(400).json({ error: "No active bank link — link a bank account first" });

  const session = await createDataSession(link.consentId);

  let attempt = 0;
  let sessionData = await getSessionData(session.id);
  while (sessionData.status === "PENDING" && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    sessionData = await getSessionData(session.id);
    attempt++;
  }

  if (sessionData.status !== "PARTIAL" && sessionData.status !== "COMPLETED") {
    return res.status(202).json({ status: sessionData.status, ingested: 0 });
  }

  const transactions = (sessionData.data ?? []).flatMap(
    (d) => d.account?.transactions?.transaction ?? [],
  );
  const ingested = await ingestAccountAggregatorTransactions(userId, transactions);
  await prisma.bankLink.update({ where: { id: link.id }, data: { lastSyncedAt: new Date() } });

  res.json({ status: sessionData.status, ingested });
});

// POST /account-aggregator/webhook — Setu's consent-status-change and FI_DATA_READY
// notifications. Signature verification not yet confirmed against a real payload — see
// setuClient.ts's header comment. No requireUser (this is called by Setu, not the app).
accountAggregatorRouter.post("/webhook", async (req, res) => {
  const { consentId, eventType } = req.body ?? {};
  if (!consentId) return res.status(400).json({ error: "consentId is required" });

  const link = await prisma.bankLink.findUnique({ where: { consentId } });
  if (!link) return res.status(404).json({ error: "Unknown consentId" });

  if (eventType === "CONSENT_STATUS_UPDATE") {
    const live = await getConsentStatus(consentId);
    await prisma.bankLink.update({ where: { id: link.id }, data: { status: live.status } });
  } else if (eventType === "FI_DATA_READY") {
    const session = await createDataSession(consentId);
    const sessionData = await getSessionData(session.id);
    const transactions = (sessionData.data ?? []).flatMap(
      (d) => d.account?.transactions?.transaction ?? [],
    );
    await ingestAccountAggregatorTransactions(link.userId, transactions);
    await prisma.bankLink.update({ where: { id: link.id }, data: { lastSyncedAt: new Date() } });
  }

  res.status(200).json({ ok: true });
});
