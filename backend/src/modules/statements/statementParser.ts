// Generic, heuristic credit-card statement transaction extraction. Deliberately not tuned to one
// issuer's exact layout yet — this is the pipeline the user asked to have "ready" ahead of real
// sample statements; expect to tighten these regexes against real files once provided.

export interface StatementTransaction {
  date: string; // ISO yyyy-mm-dd, best-effort
  description: string;
  amount: number;
  type: "debit" | "credit";
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function normalizeDate(raw: string): string | null {
  const numeric = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (numeric) {
    let [, d, m, y] = numeric;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const withMonthName = raw.match(/^(\d{1,2})[\/\-]([A-Za-z]{3})[\/\-]?(\d{2,4})$/);
  if (withMonthName) {
    let [, d, mon, y] = withMonthName;
    const m = MONTHS[mon.toLowerCase()];
    if (!m) return null;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m}-${d.padStart(2, "0")}`;
  }
  return null;
}

const DATE_TOKEN = /\b(\d{1,2}[\/\-](?:\d{1,2}|[A-Za-z]{3})[\/\-]?\d{2,4})\b/;
const AMOUNT_TOKEN = /([\d,]+\.\d{2})\s*(Dr|Cr|DR|CR)?\s*$/;

export function extractTransactionsFromText(text: string): StatementTransaction[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const transactions: StatementTransaction[] = [];

  for (const line of lines) {
    const dateMatch = line.match(DATE_TOKEN);
    if (!dateMatch || dateMatch.index === undefined || dateMatch.index > 20) continue; // date should be near line start

    const amountMatch = line.match(AMOUNT_TOKEN);
    if (!amountMatch) continue;

    const date = normalizeDate(dateMatch[1]);
    if (!date) continue;

    const amount = Number(amountMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const descStart = dateMatch.index + dateMatch[0].length;
    const descEnd = line.length - amountMatch[0].length;
    if (descEnd <= descStart) continue;
    const description = line.slice(descStart, descEnd).trim().replace(/\s{2,}/g, " ");
    if (!description) continue;

    const suffix = amountMatch[2]?.toLowerCase();
    const type: "debit" | "credit" = suffix === "cr" ? "credit" : "debit";

    transactions.push({ date, description, amount, type });
  }

  return transactions;
}

// CSV fallback — expects a header row containing recognizable column names (date/description/
// amount, or separate debit/credit columns). Falls back to positional (col0=date, colLast=amount)
// if no header is recognized.
export function extractTransactionsFromCsv(csvText: string): StatementTransaction[] {
  const rows = csvText
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")))
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
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
