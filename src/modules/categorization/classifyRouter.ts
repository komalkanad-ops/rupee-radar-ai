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
