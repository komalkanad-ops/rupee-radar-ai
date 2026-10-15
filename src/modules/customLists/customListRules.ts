// Validation for the user's own lists (custom expense/income categories, payees, payers, payment
// methods). KEEP IN SYNC with the app's domain/usecase/CustomLists.kt — same kinds, limits, reserved
// names and normalisation, mirrored tests on both sides.

export const LIST_KINDS = ["EXPENSE_CATEGORY", "INCOME_CATEGORY", "PAYEE", "PAYER", "PAYMENT_METHOD"] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export const MAX_NAME = 40;
export const MAX_ITEMS_PER_USER = 500;
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

// Built-in category keys. A custom expense category's key is its lower-cased name, so it must not
// reuse one of these: "income"/"transfer"/"savings" in particular change what counts as spend.
export const RESERVED_CATEGORY_KEYS: ReadonlySet<string> = new Set([
  "groceries", "medical", "fitness", "dining", "transport", "travel", "tolls", "fuel",
  "shopping", "entertainment", "utilities", "rent", "insurance", "education", "emi",
  "electronics", "home", "income", "transfer", "savings", "investment", "investments",
  "other", "uncategorized", "uncategorised",
]);

// Built-in payment methods (stored keys and their display labels).
export const RESERVED_PAYMENT_METHODS: ReadonlySet<string> = new Set([
  "card", "upi", "bank_transfer", "bank transfer", "wallet", "cash", "not recorded",
]);

export function isListKind(v: unknown): v is ListKind {
  return typeof v === "string" && (LIST_KINDS as readonly string[]).includes(v);
}

/** Trims, collapses inner whitespace and drops control/format characters. Null when nothing
 * visible is left, it's longer than MAX_NAME, or it has no letter or digit at all. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/gu, " ").trim();
  if (!cleaned || cleaned.length > MAX_NAME) return null;
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return cleaned;
}

/** The category key a custom category is stored under on transactions and budgets. */
export function categoryKeyFor(name: string): string {
  return name.toLowerCase();
}

/** Why [name] can't be used for [kind], or null when it can. */
export function reservedReason(kind: ListKind, name: string): string | null {
  const key = name.toLowerCase();
  if ((kind === "EXPENSE_CATEGORY" || kind === "INCOME_CATEGORY") && RESERVED_CATEGORY_KEYS.has(key)) {
    return `"${name}" is already a built-in category`;
  }
  if (kind === "PAYMENT_METHOD" && RESERVED_PAYMENT_METHODS.has(key)) {
    return `"${name}" is already a built-in payment method`;
  }
  return null;
}

/**
 * An income sub-category on a transaction upload. undefined = the client sent nothing usable, so the
 * stored value is left alone (an older app build re-uploading an edit mustn't wipe it); null = clear.
 */
export function normalizeSubcategory(raw: unknown): string | null | undefined {
  if (raw === null || raw === "") return null;
  if (raw === undefined) return undefined;
  return normalizeName(raw) ?? undefined;
}
