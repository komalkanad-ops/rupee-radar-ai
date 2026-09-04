// Mirrors mesh-cli/mesh.js's callMesh() so the backend talks to the same mesh-api
// endpoint/contract you already use from the CLI: an OpenAI-compatible chat-completions
// router that can point at Claude or any other model via the `model` string.
import * as Sentry from "@sentry/node";
import "dotenv/config";
import { prisma } from "../../lib/prisma.js";

const API_KEY = process.env.MESH_API_KEY;
const BASE_URL = process.env.MESH_BASE_URL || "https://api.meshapi.ai/v1";
const MODEL = process.env.MESH_MODEL || "anthropic/claude-sonnet-4.5";

export type MeshMessage = { role: "system" | "user" | "assistant"; content: string };

// Free string, not an enum — same convention as every other feature/type tag in this schema.
export type MeshFeature =
  | "chat"
  | "sms_parse_fallback"
  | "correction_summary"
  | "insight_narrative"
  | "merchant_classify"
  | "recurring_dedupe";

// Cost guardrails, tuned well above any legitimate use of the AI features (chat is the heaviest —
// a PRO user sending a genuine question every minute for an hour is ~60 calls). A runaway loop or a
// scripted abuse of a PRO account is what these stop; a real user never sees them.
const MESH_DAILY_CALLS_PER_USER = Number(process.env.MESH_DAILY_CALLS_PER_USER) || 300;
const MESH_DAILY_CALLS_GLOBAL = Number(process.env.MESH_DAILY_CALLS_GLOBAL) || 5000;

export class MeshBudgetExceededError extends Error {
  constructor(public scope: "user" | "global") {
    super(`AI budget exceeded (${scope})`);
    this.name = "MeshBudgetExceededError";
  }
}

async function assertWithinBudget(userId?: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [globalCount, userCount] = await Promise.all([
    prisma.meshUsageLog.count({ where: { createdAt: { gte: since } } }),
    userId ? prisma.meshUsageLog.count({ where: { userId, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  if (globalCount >= MESH_DAILY_CALLS_GLOBAL) throw new MeshBudgetExceededError("global");
  if (userId && userCount >= MESH_DAILY_CALLS_PER_USER) throw new MeshBudgetExceededError("user");
}

export async function callMesh(
  messages: MeshMessage[],
  model = MODEL,
  maxTokens?: number,
  feature: MeshFeature = "chat",
  userId?: string,
): Promise<string> {
  if (!API_KEY) {
    throw new Error("MESH_API_KEY is not set — add it to backend/.env");
  }

  await assertWithinBudget(userId);

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}) }),
  });

  let data: any;
  try {
    data = await res.json();
  } catch (err: any) {
    throw new Error(`Invalid JSON response from mesh-api: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || JSON.stringify(data));
  }

  // Fire-and-forget: mesh-api's own /usage endpoint (proxied separately for admins) has no concept
  // of "which app feature made this call" — only our own tagging can answer that. A logging failure
  // must never break the actual feature that called us.
  prisma.meshUsageLog
    .create({
      data: {
        feature,
        model,
        userId: userId ?? null,
        promptTokens: data?.usage?.prompt_tokens ?? null,
        completionTokens: data?.usage?.completion_tokens ?? null,
        totalTokens: data?.usage?.total_tokens ?? null,
      },
    })
    // A failed write silently under-counts LLM spend — report it rather than dropping it.
    .catch((e) => Sentry.captureException(e, { tags: { route: "meshUsageLog.create" } }));

  return data?.choices?.[0]?.message?.content || "";
}

/** Fallback SMS parser for bank-SMS formats not covered by the regex rule table. */
export async function parseSmsWithLlm(rawSms: string): Promise<{
  amount: number | null;
  merchant: string | null;
  category: string | null;
  txnType: "debit" | "credit" | null;
}> {
  const response = await callMesh([
    {
      role: "system",
      content:
        "You extract structured transaction data from Indian bank/card SMS alerts. " +
        'Reply with ONLY a JSON object: {"amount": number|null, "merchant": string|null, ' +
        '"category": string|null, "txn_type": "debit"|"credit"|null}. ' +
        "category should be a short lowercase label like groceries, dining, fuel, shopping, " +
        "utilities, travel, entertainment, emi, other — with two specific exceptions for " +
        "credit-type messages (txn_type=credit): if the SMS reports money credited into a bank " +
        'account, UPI, or wallet balance (real income/money received), category should be "income". ' +
        "If instead it reports a credit *card* payment being received, a refund, or a reversal " +
        '(money returning/clearing rather than new income), category should be "transfer". Never ' +
        "leave a credit-type message categorized as a spend category like shopping/dining/etc. " +
        "No prose, no markdown fences.",
    },
    { role: "user", content: rawSms },
  ], MODEL, undefined, "sms_parse_fallback");

  try {
    const parsed = JSON.parse(response);
    return {
      amount: parsed.amount ?? null,
      merchant: parsed.merchant ?? null,
      category: parsed.category ?? null,
      txnType: parsed.txn_type ?? null,
    };
  } catch {
    return { amount: null, merchant: null, category: null, txnType: null };
  }
}

/** Turns a free-text user correction into a structured field/value diff for the admin queue. */
export async function summarizeCorrection(
  cardName: string,
  currentValue: string | null,
  userNote: string
): Promise<string> {
  return callMesh([
    {
      role: "system",
      content:
        "You help an admin moderate crowdsourced corrections to a credit-card database. " +
        "Given the current stored value and a user's free-text correction note, write one " +
        "concise sentence describing exactly what should change and why, so the admin can " +
        "approve or reject at a glance.",
    },
    {
      role: "user",
      content: `Card: ${cardName}\nCurrent value: ${currentValue ?? "(empty)"}\nUser note: ${userNote}`,
    },
  ], MODEL, undefined, "correction_summary");
}

/** Generates a short natural-language summary for spend insights. */
export async function generateInsightNarrative(prompt: string): Promise<string> {
  return callMesh([
    {
      role: "system",
      content:
        "You are a concise personal-finance assistant. Turn the given spending data into a " +
        "2-3 sentence, plain-language summary a non-finance person can act on. No markdown.",
    },
    { role: "user", content: prompt },
  ], MODEL, undefined, "insight_narrative");
}
