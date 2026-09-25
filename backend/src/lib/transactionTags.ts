// Tags on a synced transaction: a short list of user-chosen labels. Kept deliberately small — this
// rides along on the bulk POST /sms/transactions upload (up to 500 rows a request), so nothing here
// may throw or fail a batch over one bad tag.
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 24; // code points, not UTF-16 units — an emoji counts as one

// Bounds the work a hostile payload can force. The 2 MB body limit already caps the total, but there is
// no reason to walk 700k junk elements, or clean a multi-MB string in full, to keep 5 tags of 24
// characters. Only the first elements / characters are ever looked at.
const MAX_ELEMENTS_EXAMINED = 50;
const MAX_CHARS_EXAMINED = 256;

// Control characters plus the invisibles that have no legitimate use in a label: zero-width space,
// bidi marks / embeddings / overrides / isolates, word joiner and the invisible math operators, BOM.
// Deliberately NOT the whole Unicode "format" class: ZWJ (U+200D) and ZWNJ (U+200C) are load-bearing
// in emoji sequences (family, skin tone) and in Hindi / Persian / other Indic shaping, and the tag
// characters (U+E0020-E007F) carry flag sequences — stripping them silently mangles real text.
const INVISIBLE = /[\p{Cc}\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu;

// Returns undefined when the client didn't send a usable `tags` value at all, meaning "leave whatever
// is stored alone" — that's what keeps an older app build, which doesn't know about tags, from
// wiping them when it re-uploads an edited transaction. An array (even an empty one) is an explicit
// statement of the full tag set, so [] clears them.
export function normalizeTags(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.slice(0, MAX_ELEMENTS_EXAMINED)) {
    if (typeof raw !== "string") continue;
    // Whitespace is collapsed BEFORE controls are removed: \t and \n are control characters, so the
    // other order turned "road\ntrip" into "roadtrip" instead of "road trip". Collapsed again after,
    // because removing an invisible between two spaces leaves a double space.
    const cleaned = Array.from(
      raw.slice(0, MAX_CHARS_EXAMINED).replace(/\s+/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim(),
    )
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
