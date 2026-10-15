// Heuristic statement transaction extraction for Indian bank-account and credit-card PDFs (text
// from pdf-parse). Not tuned to one issuer: a transaction starts at a line that begins with a date
// (optionally after a serial number), and its description/amounts can run onto the next few lines
// (several banks wrap the narration). Credit-card rows: the last amount is the transaction, "Cr" or
// a "+" marks money in. Bank-account rows: the last two amounts are amount and running balance, and
// the balance going up or down tells credit from debit. Summary lines (opening/closing balance,
// totals, minimum due, ...) are dropped. Ported from the owner's local statement-analysis pipeline,
// which was checked against a few hundred real statements; expect some layouts to still miss.

export interface StatementTransaction {
  date: string; // ISO yyyy-mm-dd, best-effort
  description: string;
  amount: number;
  type: "debit" | "credit";
}

export type StatementKind = "card" | "account";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function isoDate(d: number, m: number, y: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDate() !== d) return null; // 31 Feb etc.
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeDate(raw: string): string | null {
  const numeric = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (numeric) return isoDate(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
  const withMonthName = raw.match(/^(\d{1,2})[\s\/\-]*([A-Za-z]{3})[A-Za-z]*[\s\/\-,]*(\d{2,4})$/);
  if (withMonthName) {
    const m = MONTHS[withMonthName[2].toLowerCase()];
    if (!m) return null;
    return isoDate(Number(withMonthName[1]), Number(m), Number(withMonthName[3]));
  }
  return null;
}

// A date at the start of a line, optionally after a serial number ("12 01 Mar 2026 ..."), and an
// optional "| 14:05" / "14:05:33" time after it.
const LEADING_DATE =
  /^\s*(?:\d{1,4}\s+)?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}[\s\/\-]*[A-Za-z]{3}[A-Za-z]*[\s\/\-,]*\d{2,4})(?![\d\/])(?:\s*\|?\s*\d{1,2}:\d{2}(?::\d{2})?)?/;
// Rupee amounts with paise ("1,23,456.78", "450.00"), not part of a longer number or reference.
const AMOUNT = /(?<![\w.,\/@:-])(\d{1,3}(?:,\d{2,3})+\.\d{2}|\d+\.\d{2})(?![\d%])/g;
// "₹ 1,234" with no paise (some card statements), only when the rupee sign is right before it.
const RUPEE_WHOLE = /₹\s?(\d{1,3}(?:,\d{2,3})+|\d+)(?![\d.,])/g;
const CREDIT_FLAG = /(?:^|\s)(?:cr|cr\.)\s*$|\bcr\b(?!\w)/i;
const PLUS_BEFORE_AMOUNT = /\+\s*(?:₹|rs\.?|inr|c)?\s*[\d,]+\.\d{2}\s*\S{0,2}\s*$/i;
const CREDIT_WORDS = /\b(recd|received|credit(?:ed)?|salary|interest|refund|deposit|reversal|cashback)\b/i;
const JUNK =
  /opening balance|closing balance|^total|\btotal (?:amount|dues?|spends?|outstanding)|minimum (?:amount )?due|statement (?:date|period)|payment due|due date|credit limit|cash limit|available|previous balance|balance (?:b\/f|c\/f|brought|carried)|brought forward|carried forward|reward points?|^page \d|^sr\.? ?no|^date\b/i;
// On a card statement these are money in even without a "Cr" (some issuers don't print one).
const CARD_CREDIT_WORDS = /payment received|thank you|\brefund|\breversal|\brev\b|cashback|credit adjustment|\bcredited\b/i;
const MAX_CONTINUATION_LINES = 4;
// Real statement lines are well under this; capping bounds every regex below on hostile input.
const MAX_LINE = 400;
const MAX_BLOCK = 600;
const DAY_MS = 86_400_000;

/** The "Statement Period 01-03-2026 to 31-03-2026" (or "from ... to ...") range, when printed.
 * Rows dated well outside it are worked examples or old reference dates, not transactions. */
export function statementPeriod(text: string): { from: string; to: string } | null {
  const d = "(\\d{1,2}[\\/\\-.](?:\\d{1,2}|[A-Za-z]{3})[\\/\\-.,]?\\s?\\d{2,4}|\\d{1,2}\\s[A-Za-z]{3,9},?\\s\\d{2,4})";
  const m = text.match(new RegExp(`(?:statement|billing) period[^0-9]{0,20}${d}\\s*(?:to|-|–)\\s*${d}`, "i"));
  if (!m) return null;
  const from = normalizeDate(m[1].replace(/[\s,]+/g, "-"));
  const to = normalizeDate(m[2].replace(/[\s,]+/g, "-"));
  return from && to && from <= to ? { from, to } : null;
}

export function detectStatementKind(text: string): StatementKind {
  const head = text.slice(0, 6000).toLowerCase();
  if (/credit card|card no|card number|cardmember|card member|minimum amount due|total amount due/.test(head)) return "card";
  if (/balance/.test(head) && /(withdrawal|debit|deposit)/.test(head)) return "account";
  return "card";
}

const num = (s: string) => Number(s.replace(/,/g, ""));

function amountsIn(text: string): { value: number; index: number; end: number }[] {
  const out: { value: number; index: number; end: number }[] = [];
  for (const m of text.matchAll(AMOUNT)) out.push({ value: num(m[1]), index: m.index!, end: m.index! + m[0].length });
  if (out.length === 0) for (const m of text.matchAll(RUPEE_WHOLE)) out.push({ value: num(m[1]), index: m.index!, end: m.index! + m[0].length });
  return out;
}

const SEPARATORS = new Set([" ", "\t", "|", ":", ",", "-"]);

/** Strips separators from both ends with a plain loop — a `[...]+$` regex here is quadratic on a
 * long run of separators that isn't at the end (a crafted PDF line could stall the process). */
function trimSeparators(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && SEPARATORS.has(s[start])) start++;
  while (end > start && SEPARATORS.has(s[end - 1])) end--;
  return s.slice(start, end);
}

function cleanDescription(text: string): string {
  return trimSeparators(
    text
      .slice(0, MAX_BLOCK)
      .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s+/, "") // a time, then often the date again (posting date)
      .replace(/^\s*\d{1,2}[\s\/\-]*(?:[A-Za-z]{3}|\d{1,2})[\s\/\-]*\d{2,4}(?![\d\/])\s+/, "")
      .replace(AMOUNT, " ")
      .replace(RUPEE_WHOLE, " ")
      .replace(/(?:^|\s)(?:₹|rs\.?|inr|cr|dr|c|l|\+|-)(?=\s|$)/gi, " ")
      .replace(/\s+/g, " "),
  );
}

export function extractTransactionsFromText(text: string, kind: StatementKind = detectStatementKind(text)): StatementTransaction[] {
  const lines = text.split(/\r?\n/).map((l) => l.slice(0, MAX_LINE).replace(/\s+/g, " ").trim()).filter(Boolean);
  const transactions: StatementTransaction[] = [];
  const period = statementPeriod(text);
  const earliest = period ? new Date(Date.parse(period.from) - 7 * DAY_MS).toISOString().slice(0, 10) : null;
  const latest = period ? new Date(Date.parse(period.to) + 3 * DAY_MS).toISOString().slice(0, 10) : null;
  const opening = text.match(/opening balance[^0-9]{0,25}([\d,]+\.\d{2})/i);
  let prevBalance: number | null = opening ? num(opening[1]) : null;

  for (let i = 0; i < lines.length; i++) {
    const dateMatch = lines[i].match(LEADING_DATE);
    if (!dateMatch) continue;
    const date = normalizeDate(dateMatch[1].replace(/\s+/g, " ").trim().replace(/ /g, "-"));
    if (!date) continue;
    if (earliest && latest && (date < earliest || date > latest)) continue;
    const first = lines[i].slice(dateMatch[0].length);
    if (JUNK.test(first)) continue;

    // The row's own line first; if it has no amount, borrow up to a few following lines (until the
    // next dated line or a summary line).
    let block = first;
    for (let j = i + 1; amountsIn(block).length === 0 && j < lines.length && j <= i + MAX_CONTINUATION_LINES; j++) {
      if (LEADING_DATE.test(lines[j]) && normalizeDate((lines[j].match(LEADING_DATE)![1]).replace(/\s+/g, "-"))) break;
      if (JUNK.test(lines[j])) break;
      block += " " + lines[j];
    }
    const amounts = amountsIn(block);
    if (amounts.length === 0) continue;

    let amount: number;
    let credit: boolean;
    if (kind === "account" && amounts.length >= 2) {
      const balance = amounts[amounts.length - 1].value;
      amount = amounts[amounts.length - 2].value;
      const tail = block.slice(amounts[amounts.length - 2].index);
      if (prevBalance !== null && Math.abs(Math.abs(balance - prevBalance) - amount) < 0.011) credit = balance > prevBalance;
      else credit = CREDIT_FLAG.test(tail) || CREDIT_WORDS.test(block);
      prevBalance = balance;
    } else {
      const last = amounts[amounts.length - 1];
      amount = last.value;
      const tail = block.slice(last.end, last.end + 6);
      credit = /^\s*(cr\b|cr\.)/i.test(tail) || PLUS_BEFORE_AMOUNT.test(block.slice(0, last.end + 3)) ||
        (kind === "account" ? CREDIT_WORDS.test(block) : CARD_CREDIT_WORDS.test(block));
    }
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const description = cleanDescription(block).slice(0, 140);
    if (description.length < 3 || JUNK.test(description)) continue;
    transactions.push({ date, description, amount, type: credit ? "credit" : "debit" });
  }

  return transactions;
}

/** One CSV line into cells, honouring quotes — bank exports quote amounts like "1,234.00". */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

// CSV fallback — expects a header row containing recognizable column names (date/description/
// amount, or separate debit/credit columns). Falls back to positional (col0=date, colLast=amount)
// if no header is recognized.
export function extractTransactionsFromCsv(csvText: string): StatementTransaction[] {
  const rows = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(splitCsvLine)
    .filter((row) => row.length > 1 && row.some(Boolean));
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.toLowerCase());
  const dateIdx = header.findIndex((h) => h.includes("date"));
  const descIdx = header.findIndex((h) => h.includes("desc") || h.includes("narration") || h.includes("particular"));
  const amountIdx = header.findIndex((h) => h.includes("amount"));
  const debitIdx = header.findIndex((h) => h.includes("debit") || h.includes("withdrawal"));
  const creditIdx = header.findIndex((h) => h.includes("credit") || h.includes("deposit"));

  const hasHeader = dateIdx >= 0 && (amountIdx >= 0 || debitIdx >= 0 || creditIdx >= 0);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const transactions: StatementTransaction[] = [];
  for (const row of dataRows) {
    const rawDate = row[hasHeader ? dateIdx : 0];
    const date = normalizeDate(rawDate?.trim() ?? "");
    if (!date) continue;

    let amount = 0;
    let type: "debit" | "credit" = "debit";

    if (hasHeader && debitIdx >= 0 && row[debitIdx]?.trim()) {
      amount = Number(row[debitIdx].replace(/,/g, ""));
      type = "debit";
    } else if (hasHeader && creditIdx >= 0 && row[creditIdx]?.trim()) {
      amount = Number(row[creditIdx].replace(/,/g, ""));
      type = "credit";
    } else {
      const rawAmount = row[hasHeader ? amountIdx : row.length - 1];
      amount = Number(rawAmount?.replace(/,/g, "").replace(/[^\d.-]/g, ""));
      type = amount < 0 ? "credit" : "debit";
      amount = Math.abs(amount);
    }
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const description = hasHeader && descIdx >= 0 ? row[descIdx] : row.slice(1, -1).join(" ");
    if (!description?.trim()) continue;

    transactions.push({ date, description: description.trim(), amount, type });
  }

  return transactions;
}

const ISSUER_KEYWORDS: [string, string][] = [
  ["hdfc", "HDFC Bank"],
  ["icici", "ICICI Bank"],
  ["axis", "Axis Bank"],
  ["kotak", "Kotak Mahindra Bank"],
  ["state bank of india", "State Bank of India"],
  ["idfc", "IDFC FIRST Bank"],
  ["rbl", "RBL Bank"],
  ["bank of baroda", "Bank of Baroda"],
  ["american express", "American Express"],
  ["indusind", "IndusInd Bank"],
];

export function detectIssuer(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [keyword, label] of ISSUER_KEYWORDS) {
    if (lower.includes(keyword)) return label;
  }
  return null;
}

export interface HiddenFee {
  type: "finance_charge" | "late_payment" | "over_limit" | "gst" | "forex_markup" | "apr";
  description: string;
  amountInr: number | null;
}

// Hidden Fee & Penalty Radar — scans the raw statement text line-by-line for the categories of
// charge issuers tend to bury in fine print rather than a clearly-labeled "Fees" section. Same
// heuristic/generic caveat as the rest of this parser (see the file-level comment) — tuned against
// common Indian card-statement wording, not any one issuer's exact layout.
const HIDDEN_FEE_KEYWORDS: [RegExp, HiddenFee["type"]][] = [
  [/finance charge|interest charged|revolving credit/i, "finance_charge"],
  [/late payment fee|late fee/i, "late_payment"],
  [/over\s?-?limit fee/i, "over_limit"],
  [/\bgst\b|\bigst\b|\bcgst\b|\bsgst\b/i, "gst"],
  [/forex markup|cross[- ]currency markup|foreign currency transaction|currency conversion/i, "forex_markup"],
  [/\bapr\b|annual percentage rate/i, "apr"],
];

const LINE_AMOUNT = /(?:₹|rs\.?|inr)?\s*([\d,]+\.\d{2})/i;
const LINE_PERCENT = /(\d+(?:\.\d+)?)\s*%/;

export function detectHiddenFees(text: string): HiddenFee[] {
  const lines = text.split(/\r?\n/).map((l) => l.slice(0, MAX_LINE).trim()).filter(Boolean);
  const fees: HiddenFee[] = [];

  for (const line of lines) {
    for (const [pattern, type] of HIDDEN_FEE_KEYWORDS) {
      if (!pattern.test(line)) continue;

      if (type === "apr") {
        // APR is a rate, not a rupee amount — only worth surfacing if a % actually appears nearby,
        // otherwise "apr" alone is too weak a signal (e.g. it could be part of an unrelated word).
        if (!LINE_PERCENT.test(line)) continue;
        fees.push({ type, description: line, amountInr: null });
      } else {
        const amountMatch = line.match(LINE_AMOUNT);
        fees.push({ type, description: line, amountInr: amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null });
      }
      break; // one match per line — a line naming both "GST" and "finance charge" is rare enough
      // not to worry about, and avoids double-counting the same line under two categories.
    }
  }

  return fees;
}
