import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { callMesh } from "../llm/meshClient.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

export const recurringRouter = Router();

recurringRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const items = await prisma.recurringPayment.findMany({
    where: { userId: req.userId, active: true },
    // nulls: "last" — without it, rows with no nextDueDate (common for manually-added payments
    // where "next due in days" was left blank) sort to the very top, ahead of anything actually
    // due soon, making the list look randomly ordered.
    orderBy: { nextDueDate: { sort: "asc", nulls: "last" } },
  });
  res.json(items);
});

recurringRouter.post("/", requireUser, async (req: UserRequest, res) => {
  // userId always comes from the verified token, never the request body — a client-supplied
  // userId field here would let one user silently write data into another user's account.
  const { userId: _ignored, ...body } = req.body ?? {};

  // Rows the app auto-creates from a parsed SMS (an EMI schedule, a card statement) are re-sent
  // every billing cycle. Upsert them by (type, name) so a new statement just refreshes the amount
  // and due date instead of stacking a duplicate row each month. Manually-added rows
  // (autoDetected !== true) always create — the user may legitimately track two similar payments.
  if (body.autoDetected === true && typeof body.type === "string" && typeof body.name === "string") {
    // Any prior row for this (type, name) — including a dismissed/converted one that's now
    // active:false. If the user marked it "not an EMI" (dismissedAt) or promoted it to a real
    // Loan (convertedLoanId), a later SMS must NOT resurrect it — just record that we saw another
    // payment (detectedCount) for when they revisit the review.
    const priorAny = await prisma.recurringPayment.findFirst({
      where: { userId: req.userId, autoDetected: true, type: body.type, name: body.name },
      orderBy: { createdAt: "desc" },
    });
    if (priorAny) {
      const smsDate = body.firstDetectedAt ? new Date(body.firstDetectedAt) : new Date();
      const keepFirstDetected =
        priorAny.firstDetectedAt && priorAny.firstDetectedAt < smsDate ? priorAny.firstDetectedAt : smsDate;
      const refreshable =
        priorAny.dismissedAt || priorAny.convertedLoanId
          ? { detectedCount: priorAny.detectedCount + 1, firstDetectedAt: keepFirstDetected }
          : { ...body, detectedCount: priorAny.detectedCount + 1, firstDetectedAt: keepFirstDetected };
      const item = await prisma.recurringPayment.update({ where: { id: priorAny.id }, data: refreshable });
      return res.status(200).json(item);
    }
  }

  const item = await prisma.recurringPayment.create({
    data: {
      ...body,
      userId: req.userId,
      ...(body.autoDetected === true
        ? { firstDetectedAt: body.firstDetectedAt ? new Date(body.firstDetectedAt) : new Date() }
        : {}),
    },
  });
  res.status(201).json(item);
});

// Ownership check before any id-scoped mutation — without it, a valid token still lets a user
// mutate another user's row as long as they know (or guess) its id.
async function loadOwnedRecurringPayment(id: string, userId: string) {
  const existing = await prisma.recurringPayment.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

recurringRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedRecurringPayment(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const { userId: _ignored, ...data } = req.body ?? {};
  const item = await prisma.recurringPayment.update({ where: { id: req.params.id }, data });
  res.json(item);
});

recurringRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedRecurringPayment(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.recurringPayment.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});

// PATCH /recurring/:id/dismiss — "this isn't a real recurring payment / EMI". Tombstones the row
// (active:false + dismissedAt) so it drops out of the list and the dues projection, and so a later
// SMS for the same (type, name) doesn't re-create it (see the POST upsert above).
recurringRouter.patch("/:id/dismiss", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedRecurringPayment(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const item = await prisma.recurringPayment.update({
    where: { id: req.params.id },
    data: { active: false, dismissedAt: new Date() },
  });
  res.json(item);
});

// PATCH /recurring/:id/usage — { usageTag: "OFTEN" | "RARELY" | "NEVER" }. There's no real
// per-service usage telemetry to derive this from, so it's user-self-tagged (typically when
// confirming a detected subscription) and feeds the "flagged for cancellation" heuristic below.
recurringRouter.patch("/:id/usage", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwnedRecurringPayment(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { usageTag } = req.body ?? {};
  if (!["OFTEN", "RARELY", "NEVER"].includes(usageTag)) {
    return res.status(400).json({ error: "usageTag must be OFTEN, RARELY, or NEVER" });
  }
  const item = await prisma.recurringPayment.update({ where: { id: req.params.id }, data: { usageTag } });
  res.json(item);
});

// GET /recurring/subscriptions?userId= — active SUBSCRIPTION-type payments enriched with a matching
// SubscriptionProvider (cancel/downgrade deep link — admin-curated, matched by merchant-name
// substring when not directly linked) and a `flagged` heuristic: self-tagged as rarely/never used,
// or auto-detected and left unconfirmed for 60+ days.
recurringRouter.get("/subscriptions", requireUser, async (req: UserRequest, res) => {
  const [subscriptions, providers] = await Promise.all([
    prisma.recurringPayment.findMany({
      where: { userId: req.userId, type: "SUBSCRIPTION", active: true },
      orderBy: { nextDueDate: { sort: "asc", nulls: "last" } },
      include: { provider: true },
    }),
    prisma.subscriptionProvider.findMany(),
  ]);

  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);

  const enriched = subscriptions.map((s) => {
    const matchedProvider =
      s.provider ?? providers.find((p) => s.name.toLowerCase().includes(p.merchantPattern.toLowerCase())) ?? null;
    const flagged =
      s.usageTag === "RARELY" ||
      s.usageTag === "NEVER" ||
      (s.autoDetected && !s.usageTag && s.createdAt < sixtyDaysAgo);

    return {
      ...s,
      provider: matchedProvider
        ? {
            providerName: matchedProvider.providerName,
            cancelUrl: matchedProvider.cancelUrl,
            downgradeUrl: matchedProvider.downgradeUrl,
          }
        : null,
      flagged,
    };
  });

  res.json(enriched);
});

function normalizeMerchant(name: string): string {
  // Strips order/reference-number suffixes banks often append ("AMAZON 4471" vs "AMAZON 9823")
  // so the same merchant still groups together under fuzzy matching.
  return name.trim().toLowerCase().replace(/\s*\d{3,}\s*$/, "");
}

type Frequency = "monthly" | "quarterly" | "yearly";

// A transaction only continues a recurring series if the gap to the previous one in that series
// falls in one of these windows — loose enough for real-world jitter (a "monthly" bill landing on
// the 3rd one month and the 6th the next), tight enough that unrelated one-off purchases of the
// same merchant/amount months apart (e.g. two ₹499 Amazon buys 70 days apart) don't qualify for
// any window and correctly fail to group.
const INTERVAL_WINDOWS: { frequency: Frequency; minDays: number; maxDays: number }[] = [
  { frequency: "monthly", minDays: 25, maxDays: 35 },
  { frequency: "quarterly", minDays: 80, maxDays: 100 },
  { frequency: "yearly", minDays: 350, maxDays: 380 },
];

function classifyGap(days: number): Frequency | null {
  return INTERVAL_WINDOWS.find((w) => days >= w.minDays && days <= w.maxDays)?.frequency ?? null;
}

type Txn = { id: string; merchant: string | null; amount: number; txnDate: Date };

// Splits a chronologically-sorted same-merchant/amount transaction list into sub-series where
// every consecutive gap classifies into the SAME interval window — a gap that doesn't fit any
// window (or switches window, e.g. monthly charges that suddenly go quarterly) ends the current
// series and starts a new one from that transaction, rather than stretching one series across an
// inconsistent gap the way pure merchant+amount bucketing used to.
function splitByInterval(sorted: Txn[]): { txns: Txn[]; frequency: Frequency }[] {
  const series: { txns: Txn[]; frequency: Frequency }[] = [];
  let current: Txn[] = [];
  let currentFrequency: Frequency | null = null;

  for (const t of sorted) {
    if (current.length === 0) {
      current = [t];
      continue;
    }
    const prev = current[current.length - 1];
    const gapDays = (t.txnDate.getTime() - prev.txnDate.getTime()) / 86400000;
    const gapFrequency = classifyGap(gapDays);
    if (gapFrequency !== null && (currentFrequency === null || gapFrequency === currentFrequency)) {
      current.push(t);
      currentFrequency = gapFrequency;
    } else {
      if (currentFrequency !== null) series.push({ txns: current, frequency: currentFrequency });
      current = [t];
      currentFrequency = null;
    }
  }
  if (currentFrequency !== null) series.push({ txns: current, frequency: currentFrequency });
  return series;
}

// Requires the day-of-month to stay roughly consistent across a series (this is the user-facing
// "should have the same day of expense every month/quarter/year" requirement) — drops occurrences
// that land too far from the series' median day-of-month. UTC day-of-month, ±4 days tolerance to
// absorb weekend/holiday payment-processor drift without accepting genuinely different dates.
function trimByDayOfMonth(txns: Txn[]): Txn[] {
  if (txns.length < 2) return txns;
  const days = [...txns].map((t) => t.txnDate.getUTCDate()).sort((a, b) => a - b);
  const median = days[Math.floor(days.length / 2)];
  return txns.filter((t) => Math.abs(t.txnDate.getUTCDate() - median) <= 4);
}

// GET /recurring/detect?amountTolerancePct=&minOccurrences=&merchantMatchMode= — scans SMS
// transactions for repeating merchant+amount pairs, spaced consistently monthly/quarterly/yearly
// with a matching day-of-month, so the app can prompt "add as recurring?" backed by real evidence.
// Tunable so users can loosen/tighten matching instead of the old fixed exact-match heuristic:
//   amountTolerancePct  — group amounts within this % of each other as the "same" charge (default 0 = exact)
//   minOccurrences      — how many repeats before flagging as recurring (default 2)
//   merchantMatchMode   — "exact" (default) or "fuzzy" (case/whitespace/order-number insensitive)
// Categories from merchantCategorizer.ts's taxonomy that are essentially never real fixed-schedule
// recurring payments, even when they happen to land in the same interval/day-of-month window a few
// times in a row by coincidence (a user who orders Swiggy ~monthly on payday, or does a big grocery
// run every 4 weeks, isn't paying a "subscription" — that's ordinary repeat spend). Excluding these
// closes the false-positive gap the interval+day-of-month check alone couldn't: gap/day matching
// only proves *timing* looks periodic, not that the merchant is actually a recurring-bill type.
// Left out on purpose (kept eligible): entertainment (real streaming subscriptions live here),
// utilities/rent/insurance/education/emi (inherently recurring by nature), and null/uncategorized
// (an unrecognized merchant could still be a real subscription not yet in the taxonomy).
const NON_RECURRING_CATEGORIES = new Set(["groceries", "medical", "dining", "transport", "travel", "fuel", "shopping"]);

// "entertainment" is a mixed bag in merchantCategorizer.ts's taxonomy — real streaming
// subscriptions (Netflix, Spotify, …) sit alongside one-off ticket/event purchases (movie
// tickets, gigs) that are never a fixed recurring bill even when someone happens to catch 2-3
// movies at similar prices roughly 3 months apart. Category-level exclusion can't separate these
// (they're the same category string), so this is a merchant-keyword exclusion layered on top,
// scoped to exactly the one-off-ticketing brands from that taxonomy entry — not a second category.
const ONE_OFF_ENTERTAINMENT_KEYWORDS = ["bookmyshow", "pvr", "inox", "cinepolis"];

function isOneOffEntertainment(merchant: string): boolean {
  const lower = merchant.toLowerCase();
  return ONE_OFF_ENTERTAINMENT_KEYWORDS.some((k) => lower.includes(k));
}

recurringRouter.get("/detect", requireUser, async (req: UserRequest, res) => {
  const amountTolerancePct = Math.max(0, Number(req.query.amountTolerancePct) || 0);
  const minOccurrences = Math.max(2, Number(req.query.minOccurrences) || 2);
  const fuzzyMerchant = req.query.merchantMatchMode === "fuzzy";

  const transactions = (
    await prisma.smsTransaction.findMany({
      where: {
        userId: req.userId,
        merchant: { not: null },
        OR: [{ category: null }, { category: { notIn: Array.from(NON_RECURRING_CATEGORIES) } }],
      },
      orderBy: { txnDate: "asc" },
    })
  ).filter((t) => !isOneOffEntertainment(t.merchant!));

  const byMerchant = new Map<string, typeof transactions>();
  for (const t of transactions) {
    const key = fuzzyMerchant ? normalizeMerchant(t.merchant!) : t.merchant!;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key)!.push(t);
  }

  // Within each merchant, cluster amounts that fall within tolerance of each other so slightly
  // variable charges (e.g. usage-based subscriptions) still group as one recurring candidate.
  const amountBuckets: Txn[][] = [];
  for (const txns of byMerchant.values()) {
    const byAmount = [...txns].sort((a, b) => a.amount - b.amount);
    let current: Txn[] = [];
    for (const t of byAmount) {
      if (current.length === 0) {
        current = [t];
        continue;
      }
      const bucketAvg = current.reduce((s, c) => s + c.amount, 0) / current.length;
      const withinTolerance = bucketAvg === 0 || Math.abs(t.amount - bucketAvg) / Math.abs(bucketAvg) * 100 <= amountTolerancePct;
      if (withinTolerance) {
        current.push(t);
      } else {
        amountBuckets.push(current);
        current = [t];
      }
    }
    if (current.length > 0) amountBuckets.push(current);
  }

  const series = amountBuckets.flatMap((txns) => {
    const sorted = [...txns].sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime());
    const rawSeries = splitByInterval(sorted);
    // Trimming outlier days-of-month can break a series' gaps apart further (removing a middle
    // occurrence changes the gap on either side of it), so re-split anything that got trimmed.
    return rawSeries.flatMap((s) => {
      const trimmed = trimByDayOfMonth(s.txns);
      return trimmed.length === s.txns.length ? [s] : splitByInterval(trimmed);
    });
  });

  const candidates = series
    // "quarterly" needs a higher bar than the user's general minOccurrences: its 80-100 day window
    // is 20 days wide, so two same-merchant/amount charges landing in it is meaningfully more
    // likely to be pure coincidence than two ~monthly charges 25-35 days apart (a 10-day window on
    // a much shorter, more frequently-sampled cycle). A third occurrence at a consistent interval
    // is real evidence a monthly-vs-quarterly coincidence pair can't fake.
    .filter((s) => s.txns.length >= (s.frequency === "quarterly" ? Math.max(3, minOccurrences) : minOccurrences))
    .map((s) => {
      const sorted = s.txns;
      const gaps = sorted.slice(1).map((t, i) => (t.txnDate.getTime() - sorted[i].txnDate.getTime()) / 86400000);
      const avgGapDays = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
      return {
        merchant: sorted[0].merchant,
        // The most recent charge, not the first-ever one — with amountTolerancePct > 0 the series
        // can span a genuine price change (e.g. a subscription upgrade), and the most recent
        // amount is what the user will actually be charged next, not whatever it cost originally.
        amount: sorted[sorted.length - 1].amount,
        occurrences: sorted.length,
        avgGapDays: Math.round(avgGapDays),
        frequency: s.frequency,
        lastSeen: sorted[sorted.length - 1].txnDate,
        // Real SMS-backed evidence for each occurrence in this series, so the app can show exactly
        // which transactions (and their real dates/times) fed the "recurring" call instead of just
        // asserting it.
        transactions: sorted.map((t) => ({ id: t.id, amount: t.amount, merchant: t.merchant, txnDate: t.txnDate })),
      };
    })
    // Most-recently-active candidates first — otherwise the list order is just Map iteration
    // order (effectively "whichever merchant happened to appear first chronologically"), which
    // reads as random to a user scanning the list.
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

  res.json(candidates);
});

const MAX_DEDUPE_CANDIDATES = 40;

// POST /recurring/dedupe-candidates — { candidates: [{ merchant, amount, occurrences, frequency }] }
// -> { groups: [{ indices: number[], confidence: "high"|"medium"|"low" }] }
//
// The merchant-grouping in GET /detect (and its Android mirror, RecurringDetector.kt) is exact- or
// fuzzy-string matching only, so the same real-world biller written as "ZOMATO", "Zomato Ltd", and
// "ZOMATO*ORDER" shows up as three separate "detected" candidates — the root cause behind a report
// of "253 bill/EMIs detected" on one scan. This is an opt-in AI pass over an already-detected
// candidate list to group those variants; every numeric value in the response is computed
// client-side from the real input rows, never trusted from the model — this endpoint only decides
// *which* indices belong together, exactly like /categorization/classify only decides a category
// label, never a number. PRO-gated the same way classify/narrative endpoints are: free users get
// { proRequired: true, groups: [] } (200), not a 403.
recurringRouter.post("/dedupe-candidates", requireUser, async (req: UserRequest, res) => {
  const { candidates } = req.body ?? {};
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ error: "candidates[] is required" });
  }
  if (candidates.length > MAX_DEDUPE_CANDIDATES) {
    return res.status(400).json({
      error: `Too many candidates in one request — send at most ${MAX_DEDUPE_CANDIDATES}`,
      max: MAX_DEDUPE_CANDIDATES,
    });
  }
  for (const c of candidates) {
    if (typeof c?.merchant !== "string" || !c.merchant.trim()) {
      return res.status(400).json({ error: "each candidate needs a non-empty merchant string" });
    }
  }

  const entitlement = await prisma.proEntitlement.findUnique({ where: { userId: req.userId! } });
  const isPro = entitlement?.status === "active" && (entitlement.expiryAt?.getTime() ?? 0) > Date.now();
  if (!isPro) {
    return res.json({ proRequired: true, groups: [] });
  }

  const indexed = candidates.map((c: any, i: number) => ({
    index: i,
    merchant: String(c.merchant).slice(0, 80),
    amount: typeof c.amount === "number" ? c.amount : null,
    occurrences: typeof c.occurrences === "number" ? c.occurrences : null,
    frequency: typeof c.frequency === "string" ? c.frequency.slice(0, 32) : null,
  }));

  const systemPrompt =
    "You deduplicate a list of auto-detected recurring-payment merchants for an Indian personal " +
    "finance app. Some entries are the SAME real-world biller written slightly differently — e.g. " +
    "\"ZOMATO\", \"Zomato Ltd\", and \"ZOMATO*ORDER\" are one biller; \"NETFLIX\" and \"NETFLIX.COM\" " +
    "are one biller. Input is a JSON array of {index, merchant, amount, occurrences, frequency}. " +
    "Reply with ONLY a JSON array of groups: " +
    "[{\"indices\": [i, j, ...], \"confidence\": \"high\"|\"medium\"|\"low\"}]. " +
    "Every input index must appear in exactly one group. A merchant with no duplicate goes alone in " +
    "its own group with confidence \"high\". Group only entries you are reasonably confident are the " +
    "same biller — when unsure, keep entries separate. No prose, no markdown fences.";

  let raw: string;
  try {
    raw = await callMesh(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(indexed) },
      ],
      undefined,
      800,
      "recurring_dedupe",
      req.userId,
    );
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/rpm limit|rate.?limit|429|too many requests/i.test(msg)) {
      return res.status(429).json({ error: "AI cleanup is busy — try again shortly", retryable: true });
    }
    return res.status(502).json({ error: "AI cleanup is unavailable right now", retryable: true });
  }

  type Group = { indices: number[]; confidence: "high" | "medium" | "low" };
  let groups: Group[] = [];
  try {
    const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonText);
    // A syntactically-valid-but-wrong shape (e.g. {"groups": [...]} instead of a top-level array)
    // must fall through to the same "every candidate its own group" fallback as a genuine parse
    // failure below — treating it as "no groups at all" would wipe every real candidate the user
    // was about to confirm, which JSON.parse succeeding doesn't throw an exception for.
    if (!Array.isArray(parsed)) {
      throw new Error("mesh response was valid JSON but not a top-level array");
    }
    const seen = new Set<number>();
    for (const g of parsed) {
      if (!Array.isArray(g?.indices)) continue;
      // Dedupe *within* this one group's own indices too, not just across groups — the model
      // repeating an index (e.g. [0, 0, 1]) would otherwise let a single candidate's occurrence
      // count/transaction list get double-counted on the client after the merge, effectively
      // letting the model influence a number through a side channel this endpoint is designed to
      // never trust it with.
      const idxs: number[] = Array.from(new Set(g.indices)).filter(
        (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < candidates.length && !seen.has(i as number),
      ) as number[];
      if (idxs.length === 0) continue;
      idxs.forEach((i) => seen.add(i));
      const confidence: Group["confidence"] = ["high", "medium", "low"].includes(g.confidence) ? g.confidence : "medium";
      groups.push({ indices: idxs, confidence });
    }
    // Anything the model dropped or returned malformed stays as its own high-confidence singleton
    // group, so a parse hiccup never silently drops a real candidate from the list.
    for (let i = 0; i < candidates.length; i++) {
      if (!seen.has(i)) groups.push({ indices: [i], confidence: "high" });
    }
  } catch {
    groups = candidates.map((_: unknown, i: number) => ({ indices: [i], confidence: "high" as const }));
  }

  res.json({ groups });
});
