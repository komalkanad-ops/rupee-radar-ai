import * as Sentry from "@sentry/node";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { callMesh } from "../llm/meshClient.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { CLASSIFIABLE_CATEGORIES } from "./merchantCategorizer.js";

export const classifyRouter = Router();

const MAX_MERCHANTS = 50;
const ALLOWED = new Set(CLASSIFIABLE_CATEGORIES);

// POST /categorization/classify — { merchants: string[] } -> { results: { [merchant]: category } }
//
// A batched LLM pass over merchant names the on-device keyword taxonomy (mirrors
// merchantCategorizer.ts) couldn't place — the historical SMS backfill is regex-only, so a lot of
// real merchants ("Ruby Hall Clinic", "Prakash Expressway toll") land in "Other". The app collects
// the biggest uncategorised merchants for the current + previous month and asks once; each answer
// is stored as a MerchantCategoryOverride so it's a permanent, cheap correction, not a per-view
// call.
//
// PRO-gated the exact same way POST /sms/parse's LLM fallback is: regex categorisation is free for
// everyone, the model pass is PRO. Free users get { proRequired: true, results: {} } (200) so the
// client can prompt an upgrade rather than seeing a 403.
classifyRouter.post("/classify", requireUser, async (req: UserRequest, res) => {
  const { merchants } = req.body ?? {};
  if (!Array.isArray(merchants) || merchants.some((m) => typeof m !== "string")) {
    return res.status(400).json({ error: "merchants[] (array of strings) is required" });
  }

  const cleaned = Array.from(
    new Set(merchants.map((m) => m.trim()).filter((m) => m.length > 0))
  );
  if (cleaned.length === 0) {
    return res.json({ results: {} });
  }
  if (cleaned.length > MAX_MERCHANTS) {
    return res.status(400).json({ error: `Too many merchants in one request — send at most ${MAX_MERCHANTS}`, max: MAX_MERCHANTS });
  }

  const entitlement = await prisma.proEntitlement.findUnique({ where: { userId: req.userId! } });
  const isPro = entitlement?.status === "active" && (entitlement.expiryAt?.getTime() ?? 0) > Date.now();
  if (!isPro) {
    return res.json({ proRequired: true, results: {} });
  }

  const systemPrompt =
    "You classify Indian merchant names into spending categories. " +
    "The only allowed categories are: " +
    CLASSIFIABLE_CATEGORIES.join(", ") +
    ". Reply with ONLY a JSON object mapping each input merchant string (exactly as given) to one " +
    "of those categories. Omit a merchant entirely if you are not confident. No prose, no markdown " +
    "fences, no explanation.";

  let raw: string;
  try {
    raw = await callMesh(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(cleaned) },
      ],
      undefined,
      600,
      "merchant_classify",
      req.userId,
    );
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    // Same handling as /sms/parse: the mesh provider's own RPM limit is transient and expected —
    // a clean retryable 429, not a 500 + Sentry noise.
    if (/rpm limit|rate.?limit|429|too many requests/i.test(msg)) {
      return res.status(429).json({ error: "AI classifier is busy — try again shortly", retryable: true });
    }
    return res.status(502).json({ error: "AI classifier is unavailable right now", retryable: true });
  }

  const results: Record<string, string> = {};
  try {
    // Tolerate a stray markdown fence even though the prompt forbids it.
    const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === "object") {
      for (const [merchant, category] of Object.entries(parsed)) {
        if (typeof category === "string" && ALLOWED.has(category) && cleaned.includes(merchant)) {
          results[merchant] = category;
        }
      }
    }
  } catch (err) {
    // A malformed model *response* is a no-op (client keeps those merchants in "Other" and retries).
    // But an exception here can also be a mesh-API outage / auth failure / quota — report those so a
    // broken classify pass isn't invisible.
    Sentry.captureException(err, { tags: { route: "POST /categorization/classify" } });
  }

  res.json({ results });
});

const QUICK_CAPTURE_RECURRING_TYPES = new Set(["SUBSCRIPTION", "LOAN", "EMI", "SIP", "CREDIT_CARD_BILL", "OTHER"]);
const QUICK_CAPTURE_FREQUENCIES = new Set(["monthly", "quarterly", "yearly"]);
const QUICK_CAPTURE_MAX_CHARS = 1000;

// POST /categorization/quick-capture — { text: string } -> { captures: [...] }
//
// The "companion" dictation flow: a user describes their spends/EMIs/bills in plain language
// ("paid 500 for groceries today, netflix is 649 a month, rent 15000") instead of filling forms.
// This ONLY parses text into structured proposals — it never writes anything to the database.
// The Android client shows every capture in an editable confirm sheet; the user still taps
// "Add" per item (or "Add all") before an Expense/RecurringPayment row is created, same as any
// manual entry. That keeps a human between a mis-parse and a wrong ₹ amount landing in the ledger.
//
// PRO-gated the same way /classify and /sms/parse's LLM fallback are — free users get a clear
// proRequired flag (200, not 403) so the client can prompt an upgrade instead of a dead end; they
// still have the ordinary manual-entry forms.
classifyRouter.post("/quick-capture", requireUser, async (req: UserRequest, res) => {
  const { text } = req.body ?? {};
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }
  const cleaned = text.trim().slice(0, QUICK_CAPTURE_MAX_CHARS);

  const entitlement = await prisma.proEntitlement.findUnique({ where: { userId: req.userId! } });
  const isPro = entitlement?.status === "active" && (entitlement.expiryAt?.getTime() ?? 0) > Date.now();
  if (!isPro) {
    return res.json({ proRequired: true, captures: [] });
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const systemPrompt =
    "You extract structured personal-finance entries from a user's freeform, dictated description " +
    "of their spends, EMIs, bills, or subscriptions. The user is Indian and amounts are in INR " +
    "unless stated otherwise; assume ₹ for bare numbers. Today's date is " +
    todayIso +
    ". Split the input into one entry per distinct spend/bill/EMI mentioned — there may be several " +
    "in one sentence. For each entry decide kind: " +
    '"expense" for a single already-happened spend (something bought/paid today or on a specific ' +
    'past date), or "recurring" for anything that repeats on a schedule (rent, EMI, subscription, ' +
    "SIP, credit card bill). " +
    "Reply with ONLY a JSON object: " +
    '{"captures": [ { "kind": "expense" | "recurring", "amount": number, ' +
    '"merchant": string | null, "category": one of [' +
    CLASSIFIABLE_CATEGORIES.join(", ") +
    '] or null (expense only), "name": string | null (recurring only — e.g. "Netflix", "Home loan EMI"), ' +
    '"type": one of [' +
    [...QUICK_CAPTURE_RECURRING_TYPES].join(", ") +
    "] or null (recurring only), " +
    '"frequency": one of [monthly, quarterly, yearly] or null (recurring only, default monthly if repeating but unstated) } ] }. ' +
    "Omit an entry entirely if you cannot extract a numeric amount for it. No prose, no markdown fences.";

  let raw: string;
  try {
    raw = await callMesh(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: cleaned },
      ],
      undefined,
      800,
      "quick_capture",
      req.userId,
    );
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/rpm limit|rate.?limit|429|too many requests/i.test(msg)) {
      return res.status(429).json({ error: "AI capture is busy — try again shortly", retryable: true });
    }
    return res.status(502).json({ error: "AI capture is unavailable right now", retryable: true });
  }

  const captures: any[] = [];
  try {
    const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonText);
    const list = Array.isArray(parsed?.captures) ? parsed.captures : [];
    for (const item of list) {
      const amount = Number(item?.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const kind = item?.kind === "recurring" ? "recurring" : "expense";
      if (kind === "expense") {
        const category = typeof item?.category === "string" && ALLOWED.has(item.category) ? item.category : null;
        captures.push({
          kind,
          amount,
          merchant: typeof item?.merchant === "string" && item.merchant.trim() ? item.merchant.trim().slice(0, 120) : null,
          category,
        });
      } else {
        const type = typeof item?.type === "string" && QUICK_CAPTURE_RECURRING_TYPES.has(item.type) ? item.type : "OTHER";
        const frequency = typeof item?.frequency === "string" && QUICK_CAPTURE_FREQUENCIES.has(item.frequency) ? item.frequency : "monthly";
        const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim().slice(0, 120) : "Recurring payment";
        captures.push({ kind, amount, name, type, frequency });
      }
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /categorization/quick-capture" } });
  }

  res.json({ captures });
});
