// Validation for Loan.prepayments — KEEP IN SYNC with the limits and rules in the Android app's
// domain/usecase/LoanPrepayments.kt (normalize), so both sides store the same list.

export const MAX_PREPAYMENTS = 100;
export const MAX_NOTE_LENGTH = 80;
export const MAX_AMOUNT = 1_000_000_000;

export type LoanPrepayment = { date: string; amount: number; note?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Returns the cleaned list, or an error string when the input isn't a list at all. Individual bad
 * entries (unparseable date, non-positive or absurd amount) are dropped, not rejected — the same
 * as the app — so one odd row can't block a whole loan update. Sorted by date, capped in count,
 * notes trimmed and truncated, amounts rounded to paise.
 */
export function normalizePrepayments(input: unknown): { ok: true; value: LoanPrepayment[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "prepayments must be a list" };
  // Bound the work a hostile body can force before filtering.
  const out: LoanPrepayment[] = [];
  for (const raw of input.slice(0, MAX_PREPAYMENTS * 2)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.date !== "string" || !isRealDate(r.date)) continue;
    if (typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount <= 0 || r.amount > MAX_AMOUNT) continue;
    const entry: LoanPrepayment = { date: r.date, amount: Math.round(r.amount * 100) / 100 };
    if (typeof r.note === "string") {
      const note = r.note.trim().slice(0, MAX_NOTE_LENGTH);
      if (note) entry.note = note;
    }
    out.push(entry);
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ok: true, value: out.slice(0, MAX_PREPAYMENTS) };
}
