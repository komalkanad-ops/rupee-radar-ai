import { describe, it, expect } from "vitest";
import { normalizeTags, parseStoredTags, MAX_TAGS, MAX_TAG_LENGTH } from "../src/lib/transactionTags";

describe("normalizeTags", () => {
  it("returns undefined for anything that isn't an array (client sent no tags — leave stored value alone)", () => {
    for (const v of [undefined, null, "trip", 5, { 0: "trip" }, true]) {
      expect(normalizeTags(v)).toBeUndefined();
    }
  });

  it("treats an empty array as an explicit 'clear all tags'", () => {
    expect(normalizeTags([])).toEqual([]);
  });

  it("keeps ordinary tags in order", () => {
    expect(normalizeTags(["trip", "reimbursable"])).toEqual(["trip", "reimbursable"]);
  });

  it("strips control and zero-width/format characters", () => {
    expect(normalizeTags(["tr​ip", "a\u0000b", "x‮y"])).toEqual(["trip", "ab", "xy"]);
  });

  it("drops tags that are only invisible characters or whitespace", () => {
    expect(normalizeTags(["​​", "   ", "\t\n", "ok"])).toEqual(["ok"]);
  });

  it("collapses internal whitespace and trims", () => {
    expect(normalizeTags(["  goa   trip \n 2026 "])).toEqual(["goa trip 2026"]);
  });

  it("truncates to 24 characters", () => {
    const [t] = normalizeTags(["a".repeat(60)])!;
    expect(t).toHaveLength(MAX_TAG_LENGTH);
  });

  it("counts by code point, so an emoji is one character and is never split in half", () => {
    const [t] = normalizeTags(["😀".repeat(40)])!;
    expect(Array.from(t)).toHaveLength(MAX_TAG_LENGTH);
    expect(t).toBe("😀".repeat(MAX_TAG_LENGTH)); // no lone surrogate at the cut
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(t)).toBe(false);
  });

  it("does not leave trailing whitespace after truncating", () => {
    const [t] = normalizeTags(["a".repeat(23) + " bbbb"])!;
    expect(t).toBe("a".repeat(23));
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(normalizeTags(["Trip", "trip", "TRIP", "food"])).toEqual(["Trip", "food"]);
  });

  it("de-duplicates tags that only became equal after cleaning or truncation", () => {
    expect(normalizeTags(["a b", "a​   b"])).toEqual(["a b"]);
    expect(normalizeTags(["x".repeat(30), "x".repeat(40)])).toEqual(["x".repeat(24)]);
  });

  it("keeps at most 5", () => {
    const out = normalizeTags(["1", "2", "3", "4", "5", "6", "7"])!;
    expect(out).toEqual(["1", "2", "3", "4", "5"]);
    expect(out).toHaveLength(MAX_TAGS);
  });

  it("counts only distinct valid tags towards the cap (junk and duplicates don't use up slots)", () => {
    expect(normalizeTags(["a", "A", "", null, 3, "b", "c", "d", "e", "f"])).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("silently drops non-string elements instead of throwing", () => {
    expect(normalizeTags([1, null, undefined, {}, [], true, "keep"])).toEqual(["keep"]);
  });
});

describe("parseStoredTags", () => {
  it("parses a stored JSON array", () => {
    expect(parseStoredTags('["trip","food"]')).toEqual(["trip", "food"]);
  });

  it("returns [] for null, undefined and empty", () => {
    expect(parseStoredTags(null)).toEqual([]);
    expect(parseStoredTags(undefined)).toEqual([]);
    expect(parseStoredTags("")).toEqual([]);
  });

  it("returns [] for malformed JSON rather than throwing", () => {
    expect(parseStoredTags("{not json")).toEqual([]);
  });

  it("returns [] when the JSON is not an array", () => {
    expect(parseStoredTags('{"a":1}')).toEqual([]);
    expect(parseStoredTags('"trip"')).toEqual([]);
  });

  it("drops non-string entries from a stored array", () => {
    expect(parseStoredTags('["ok", 3, null, "fine"]')).toEqual(["ok", "fine"]);
  });
});
