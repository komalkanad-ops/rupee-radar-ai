// Shared period + category helpers for the "financial review" / "safety net" / "money leaks"
// endpoints. Kept in one place so month/quarter/year windowing and the essential-vs-discretionary
// split are defined once.

export type PeriodKind = "month" | "quarter" | "year";

export interface PeriodRange {
  start: Date;
  end: Date; // exclusive
  prevStart: Date;
  prevEnd: Date; // exclusive; the equally-sized window immediately before [start, end)
  label: string; // e.g. "August 2026", "Q3 2026", "2026"
}

/** [start, end) for the period containing `anchor`, plus the equally-sized prior window. */
export function periodRange(kind: PeriodKind, anchor: Date): PeriodRange {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();

  let start: Date;
  let end: Date;
  let label: string;

  if (kind === "month") {
    start = new Date(Date.UTC(y, m, 1));
    end = new Date(Date.UTC(y, m + 1, 1));
    label = start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  } else if (kind === "quarter") {
    const q = Math.floor(m / 3);
    start = new Date(Date.UTC(y, q * 3, 1));
    end = new Date(Date.UTC(y, q * 3 + 3, 1));
    label = `Q${q + 1} ${y}`;
  } else {
    start = new Date(Date.UTC(y, 0, 1));
    end = new Date(Date.UTC(y + 1, 0, 1));
    label = `${y}`;
  }

  const spanMs = end.getTime() - start.getTime();
  const prevEnd = start;
  const prevStart =
    kind === "month"
      ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1))
      : kind === "quarter"
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 3, 1))
        : new Date(Date.UTC(start.getUTCFullYear() - 1, 0, 1));
  // spanMs kept for callers that want month-count normalisation.
  void spanMs;

  return { start, end, prevStart, prevEnd, label };
}

export function monthsInPeriod(kind: PeriodKind): number {
  return kind === "month" ? 1 : kind === "quarter" ? 3 : 12;
}

// Categories that are hard to cut (rent, EMI, utilities, groceries, medical, commute, fuel, tolls).
// KEEP IN SYNC with android's single copy: domain/usecase/EssentialCategories.kt (ALL). The audit
// on 2026-09-03 found the Android side had drifted into three separate copies of this set, one
// stale without "tolls" — now consolidated.
export const ESSENTIAL_CATEGORIES = new Set([
  "groceries",
  "utilities",
  "rent",
  "insurance",
  "emi",
  "medical",
  "fuel",
  "transport",
  "tolls",
]);

// Excluded from every "spend" total — not consumption.
export const NON_SPEND_CATEGORIES = new Set(["income", "transfer", "savings"]);

export function isSpendCategory(category: string | null | undefined): boolean {
  return !!category && !NON_SPEND_CATEGORIES.has(category);
}

export function isEssential(category: string | null | undefined): boolean {
  return !!category && ESSENTIAL_CATEGORIES.has(category);
}

// Merchant/description substrings that mark a transaction as a fee/charge rather than a purchase —
// used by the money-leaks fee audit. Deliberately conservative (whole-word-ish) to avoid flagging
// e.g. "Charged Cafe".
export const FEE_KEYWORDS = [
  "convenience fee",
  "conv fee",
  "conv. fee",
  "service charge",
  "processing fee",
  "surcharge",
  "late fee",
  "late payment",
  "penalty",
  "finance charge",
  "fin charge",
  "atm withdrawal charge",
  "atm charge",
  "annual fee",
  "joining fee",
  "renewal fee",
  "gst on",
  "markup fee",
  "forex markup",
  "overlimit",
  "cheque bounce",
  "ecs return",
  "nach return",
  "auto debit failure",
];

export function looksLikeFee(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return FEE_KEYWORDS.some((k) => t.includes(k));
}

// Normalise a merchant name for duplicate-charge grouping: lowercase, drop trailing ref/order
// numbers and punctuation.
export function normalizeMerchant(m: string | null | undefined): string {
  return (m ?? "")
    .toLowerCase()
    .replace(/[#*]?\s*(ref|txn|order|inv|no)[:.]?\s*\w+/g, "")
    .replace(/\d{4,}/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}
