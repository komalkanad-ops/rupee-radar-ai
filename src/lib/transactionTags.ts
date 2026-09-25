// Tags on a synced transaction: a short list of user-chosen labels. Kept deliberately small — this
// rides along on the bulk POST /sms/transactions upload (up to 500 rows a request), so nothing here
// may throw or fail a batch over one bad tag.
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 24; // code points, not UTF-16 units — an emoji counts as one

const INVISIBLE = /[\p{Cc}\p{Cf}]/gu; // control + format (zero-width, bidi overrides)

// Returns undefined when the client didn't send a usable `tags` value at all, meaning "leave whatever
// is stored alone" — that's what keeps an older app build, which doesn't know about tags, from
// wiping them when it re-uploads an edited transaction. An array (even an empty one) is an explicit
// statement of the full tag set, so [] clears them.
export function normalizeTags(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const cleaned = Array.from(raw.replace(INVISIBLE, "").replace(/\s+/g, " ").trim())
      .slice(0, MAX_TAG_LENGTH)
      .join("")
      .trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

// Reads the stored column back. A malformed or unexpected value yields [] rather than throwing, so
// one bad row can never take down a whole GET /sms/transactions.
export function parseStoredTags(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}
