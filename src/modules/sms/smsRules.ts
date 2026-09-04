// Regex templates for Indian bank transaction SMS. Built and validated against a real ~17,000
// message export (see docs/sms-parsing-notes.md) covering HDFC, Kotak, IndusInd, Axis, RBL, IDFC
// FIRST, Bank of Baroda, Amex, SBI, and Pluxee — 97% of genuine transaction messages in that
// export matched one of these rules. Anything else falls back to parseSmsWithLlm() (PRO-only).
//
// IMPORTANT: bank sender IDs in India follow a DLT header format like "JM-HDFCBK-S" or
// "AX-AXISBK-S" (telecom-operator prefix + bank code + category suffix) — NOT the bank's full
// name. Matching must check for the bank *code* (e.g. "HDFCBK") as a substring, not "HDFCBANK".

export type PaymentChannel = "card" | "upi" | "bank_transfer" | "wallet";

export interface SmsRule {
  bankCode: string;
  bankName: string;
  name: string;
  pattern: RegExp;
  amountGroup: number;
  merchantGroup?: number;
  merchantFallback?: string;
  txnType: "debit" | "credit";
  // Inferred from which pattern matched (card-swipe language, UPI-handle "Sent/Received", generic
  // A/C debit/credit, or a prepaid wallet) — not derivable from merchant text alone.
  channel: PaymentChannel;
}

export const smsRules: SmsRule[] = [
  // ── HDFC Bank ──────────────────────────────────────────────────────────────────
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "spent-A", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /Spent\s+Rs\.?\s?([\d,]+\.?\d*)\s+On\s+HDFC Bank Card\s+\S+\s+At\s+(.+?)\s+On\s+\d{4}-\d{2}-\d{2}/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "spent-B", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+spent (?:on|From)\s+HDFC Bank Card\s+\S+\s+at\s+(.+?)\s+on\s+\d{4}-\d{2}-\d{2}/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "upi-txn", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "upi",
    pattern: /Txn\s+Rs\.?\s?([\d,]+\.?\d*)\s+On\s+HDFC Bank Card\s+\S+\s+At\s+(.+?)\s+by\s+UPI/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "paid-online-banking", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /Paid\s+Rs\.?\s?([\d,]+\.?\d*)\s+For:\s+(.+?)\s+From HDFC Bank A\/c/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "credit-alert", txnType: "credit", amountGroup: 1, merchantFallback: "HDFC Bank credit", channel: "bank_transfer",
    pattern: /Credit Alert!\s+Rs\.?([\d,]+\.?\d*)\s+credited to HDFC Bank A\/c/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "card-payment-credited", txnType: "credit", amountGroup: 1, merchantFallback: "Credit card payment", channel: "card",
    pattern: /Payment of Rs\.?\s?([\d,]+\.?\d*)\s+was credited to your card ending/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "bill-paid-smartpay", txnType: "debit", amountGroup: 2, merchantGroup: 1, channel: "card",
    pattern: /Bill Paid:\s+(.+?)\s+Bill\s+\S+\s+of\s+Rs\.?\s?([\d,]+\.?\d*)\s+paid on/i },
  // Real HDFC personal-loan EMI debit confirmation (as opposed to the "EMI Reminder"/"due on"
  // messages sent before the debit actually happens, which are deliberately NOT matched here —
  // matching those would record a spend that hasn't occurred yet).
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "loan-emi-debited", txnType: "debit", amountGroup: 1, merchantFallback: "EMI", channel: "bank_transfer",
    pattern: /INR\s?([\d,]+\.?\d*)\s+debited from HDFC Bank\s+\S+\s+on\s+[\w-]+\.\s*Info:\s*EMI/i },

  // ── ICICI Bank (credit card) ───────────────────────────────────────────────────
  { bankCode: "ICICIT", bankName: "ICICI Bank", name: "spent-using", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /(?:INR|Rs\.?)\s?([\d,]+\.?\d*)\s+spent using ICICI Bank Card\s+\S+\s+on\s+\d{1,2}-[A-Za-z]{3}-\d{2}\s+on\s+(.+?)\.\s*Avl Limit/i },
  { bankCode: "ICICIT", bankName: "ICICI Bank", name: "spent-at", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /(?:INR|Rs\.?)\s?([\d,]+\.?\d*)\s+spent on ICICI Bank Card\s+\S+\s+on\s+\d{1,2}-[A-Za-z]{3}-\d{2}\s+at\s+(.+?)\.\s*Avl Lmt/i },
  { bankCode: "ICICIT", bankName: "ICICI Bank", name: "credited-refunded", txnType: "credit", amountGroup: 1, merchantFallback: "ICICI Bank credit", channel: "card",
    pattern: /ICICI Bank Credit Card\s+\S+\s+credited\/refunded with Rs\.?\s?([\d,]+\.?\d*)\s+on/i },
  { bankCode: "ICICIT", bankName: "ICICI Bank", name: "bill-payment-received", txnType: "credit", amountGroup: 1, merchantFallback: "Credit card payment", channel: "card",
    pattern: /Payment of Rs\.?\s?([\d,]+\.?\d*)\s+has been received on your ICICI Bank Credit Card/i },

  // ── Kotak Bank ─────────────────────────────────────────────────────────────────
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "withdraw-thru", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /withdrawn\s+Rs\.?\s?([\d,]+\.?\d*)\s+thru\s+Kotak Bank Debit Card\s+\S+\s+on\s+[\d/]+\s+at\s+(.+?)\.\s*Avl/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "withdraw-via", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+withdrawn via Kotak Debit Card\s+\S+\s+on\s+[\d/]+\s+at\s+(.+?)\.\s*Avl/i },
  // "Sent/Received Rs...to/from <UPI handle or payee>" — Kotak's UPI P2P/P2M notification format.
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "sent", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "upi",
    pattern: /Sent\s+Rs\.?\s?([\d,]+\.?\d*)\s+from\s+Kotak Bank A\/?[Cc]\s+\S+\s+to\s+(.+?)\s+on\s+[\d-]+\./i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "received", txnType: "credit", amountGroup: 1, merchantFallback: "Kotak Bank transfer", channel: "upi",
    pattern: /Received\s+Rs\.?\s*([\d,]+\.?\d*)\s+(?:on\s+[\d-]+\s+)?in your Kotak Bank A\/?C/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "nach-pg-debit", txnType: "debit", amountGroup: 1, merchantGroup: 2, merchantFallback: "Kotak Bank auto-debit", channel: "bank_transfer",
    pattern: /(?:INR|Rs\.?)\s?([\d,]+\.?\d*)\s+(?:is\s+)?debited (?:to|from) your Account.*?(?:towards\s+(.+?)\s+)?Kotak Bank/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "pg-debit-alt", txnType: "debit", amountGroup: 1, merchantFallback: "Kotak Bank payment", channel: "bank_transfer",
    pattern: /Rs\.?([\d,]+\.?\d*)\s+debited from A\/C\s+\S+\s+via Kotak Bank PG/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "reversal-credit", txnType: "credit", amountGroup: 1, merchantFallback: "Kotak Bank credit", channel: "bank_transfer",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+is credited to (?:your\s+)?Kotak Bank a\/c/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "rtgs-neft-credit", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+credited to (?:your\s+)?Kotak Bank a\/c.*?from beneficiary\s+(.+?)\./i },

  // ── IndusInd Bank ──────────────────────────────────────────────────────────────
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "credited-from", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/C\s+\S+\s+credited by Rs\s?([\d,]+\.?\d*)\s+from\s+(.+?)\./i },
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "debited-towards", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/C\s+\S+\s+debited by Rs\s?([\d,]+\.?\d*)\s+towards\s+(.+?)\./i },
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "debited-credited-ref", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/C\s+(?:Debited|Credited);\s+INR\s?([\d,]+\.?\d*)\s+Ref-(.+?)\d/i },
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "purchase-debited", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /INR\s?([\d,]+\.?\d*)\s+has been debited from your IndusInd Bank.*?towards\s+(.+?)\s+purchase/i },
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "generic-debited-towards", txnType: "debit", amountGroup: 1, merchantGroup: 2, merchantFallback: "IndusInd Bank debit", channel: "bank_transfer",
    pattern: /INR\s?([\d,]+\.?\d*)\s+debited from your A\/C.*?towards\s+(.+?)\s*\.\s*Avl/i },
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "card-spent-new", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /INR\s?([\d,]+\.?\d*)\s+spent on IndusInd Card\s+\S+\s+on\s+[\d-]+\s+[\d:]+\s*(?:am|pm)?\s+at\s+(.+?)\.\s*Avl Lmt/i },
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "reversal-to-cc", txnType: "credit", amountGroup: 1, merchantFallback: "IndusInd reversal", channel: "card",
    pattern: /Amount of INR\s?([\d,]+\.?\d*)\s+will be credited to your Credit Card account/i },

  // ── Axis Bank ──────────────────────────────────────────────────────────────────
  { bankCode: "AXISBK", bankName: "Axis Bank", name: "spent-A", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /Spent\s+Card no\.\s+\S+\s+INR\s?([\d,]+\.?\d*)\s+[\d-]+\s+[\d:]+\s+(.+?)\s+Avl Lmt/i },
  { bankCode: "AXISBK", bankName: "Axis Bank", name: "spent-B", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /Spent\s+INR\s?([\d,]+\.?\d*)\s+Axis Bank Card no\.\s+\S+\s+[\d-]+\s+[\d:]+\s+IST\s+(.+?)\s+Avl Limit/i },

  // ── RBL Bank (credit card) ─────────────────────────────────────────────────────
  { bankCode: "RBLCRD", bankName: "RBL Bank", name: "spent-at", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /INR\s?([\d,]+\.?\d*)\s+spent at\s+(.+?)\s+on RBL Bank credit card/i },
  { bankCode: "RBLCRD", bankName: "RBL Bank", name: "you-have-spent", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /you have spent INR\s?([\d,]+\.?\d*)\s+at\s+(.+?)\s+using your RBL Bank Credit Card/i },
  { bankCode: "RBLCRD", bankName: "RBL Bank", name: "refund", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /Refund Alert!\s+(?:INR|USD)\s?([\d,.]+)\s+was credited on your RBL Bank Credit Card.*?from\s+(.+?)\s+on/i },

  // ── IDFC FIRST Bank ────────────────────────────────────────────────────────────
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "card-spent", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /(?:INR|USD)\s?([\d,]+\.?\d*)\s+spent on your IDFC FIRST Bank Credit Card.*?at\s+(.+?)\s+on\s+\d{1,2}[\s-][A-Z]{3}[\s-]\d{4}/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "toll", txnType: "debit", amountGroup: 1, merchantFallback: "Toll", channel: "wallet",
    pattern: /INR\s?([\d,]+\.?\d*)\s+toll paid from IDFC FIRST Bank Tag/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "account-credited", txnType: "credit", amountGroup: 1, merchantFallback: "IDFC FIRST Bank credit", channel: "bank_transfer",
    pattern: /A\/C\s+\S+\s+is credited with INR\s?([\d,]+\.?\d*)\s+on/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "fastag-recharge", txnType: "debit", amountGroup: 1, merchantFallback: "FASTag recharge", channel: "wallet",
    pattern: /FASTag.*?[Cc]redited with Rs\.?\s?([\d,.]+)\s+(?:on|Ref)/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "spent-from-account", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /Spent\s+Rs\.?([\d,]+\.?\d*)\s+from\s+A\/C\s+\S+\s+at\s+(.+?)\s+on/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "imps-credited", txnType: "credit", amountGroup: 1, merchantFallback: "IDFC FIRST Bank credit", channel: "bank_transfer",
    pattern: /a\/c no\.\s+\S+\s+is credited by Rs\.?\s?([\d,]+\.?\d*)\s+on/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "account-debited", txnType: "debit", amountGroup: 1, merchantFallback: "IDFC FIRST Bank debit", channel: "bank_transfer",
    pattern: /A\/C\s+\S+\s+is debited by INR\s?([\d,]+\.?\d*)\s+on.*?New Bal/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "si-card-payment", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /INR\s?([\d,]+\.?\d*)\s+for\s+(.+?)\s+paid from your IDFC FIRST Bank Credit Card/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "cc-repayment", txnType: "debit", amountGroup: 1, merchantFallback: "Credit card repayment", channel: "card",
    pattern: /A\/C\s+\S+\s+has been debited by INR\s?([\d,]+\.?\d*)\s+towards the repayment of IDFC FIRST Bank Credit Card/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "account-debited-transfer", txnType: "debit", amountGroup: 1, merchantFallback: "IDFC FIRST Bank transfer", channel: "bank_transfer",
    pattern: /a\/c(?:\s+ending)?\s+\S+\s+(?:is\s+)?debited by Rs\.?\s?([\d,]+\.?\d*)\s+on/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "debited-semicolon", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/c\s+\S+\s+debited by Rs\.?\s?([\d,]+\.?\d*)\s+on\s+[\d/]+;\s*(.+?)\s+credited/i },

  // ── Bank of Baroda (BOBCARD) ───────────────────────────────────────────────────
  { bankCode: "BOBCRD", bankName: "Bank of Baroda", name: "card-spent", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /INR\s?([\d,.]+)\s+is spent on your BOBCARD ending\s+\d+\s+at\s+(.+?)\s+on\s+\d{2}-\d{2}-\d{4}/i },

  // ── American Express ───────────────────────────────────────────────────────────
  { bankCode: "AMEXIN", bankName: "American Express", name: "spent", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /spent INR\s?([\d,.]+)\s+on your AMEX card.*?at\s+(.+?)\s+on\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}/i },
  { bankCode: "AMEXIN", bankName: "American Express", name: "payment-received", txnType: "credit", amountGroup: 1, merchantFallback: "Amex payment", channel: "card",
    pattern: /a payment of INR\s?([\d,.]+)\s+was received on your Amex Card/i },

  // ── SBI ────────────────────────────────────────────────────────────────────────
  { bankCode: "CBSSBI", bankName: "State Bank of India", name: "debited-transferred", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/C\s+\S+\s+Debited INR\s?([\d,.]+)\s+on\s+[\d/]+\s+-Transferred to\s+(.+?)\.\s+Avl Balance/i },

  // ── Pluxee (meal card) ─────────────────────────────────────────────────────────
  { bankCode: "PLUXEE", bankName: "Pluxee", name: "spent", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "wallet",
    pattern: /Rs\.?\s?([\d,.]+)\s+spent from Pluxee\s+Meal wallet.*?at\s+(.+?)\s*\.\s*Avl bal/i },
  { bankCode: "PLUXEE", bankName: "Pluxee", name: "wallet-credited", txnType: "credit", amountGroup: 1, merchantFallback: "Pluxee wallet top-up", channel: "wallet",
    pattern: /Pluxee Card.*?credited with (?:Rs\.?|INR\s?)([\d,.]+)\s+(?:towards|on)/i },
];

export function tryParseWithRules(bankSender: string, rawSms: string) {
  const senderUpper = bankSender.toUpperCase();
  const candidates = smsRules.filter((r) => senderUpper.includes(r.bankCode));
  for (const rule of candidates) {
    const match = rawSms.match(rule.pattern);
    if (!match) continue;
    const amount = parseFloat(match[rule.amountGroup].replace(/,/g, ""));
    if (Number.isNaN(amount)) continue;
    const merchant = rule.merchantGroup ? match[rule.merchantGroup]?.trim() : rule.merchantFallback ?? null;
    return { amount, merchant: merchant ?? null, txnType: rule.txnType, channel: rule.channel };
  }
  return null;
}

// Extracts the bank's own "Available Balance" figure when the SMS states one — deliberately a
// separate, generic pattern run against the raw SMS text rather than a new capture group threaded
// into the 40+ rules above, so adding this can't risk breaking any of that already-tested amount/
// merchant extraction. Several (not all) bank templates include this phrasing (HDFC's
// "Avl bal:INR 48,320.26", Kotak's "Avl Bal Rs1000.00", SBI's "Avl Balance INR 10000.00", Pluxee's
// "Avl bal Rs.4493.94" for the meal wallet) — deliberately does NOT match "Avl Limit"/"Avl Lmt"
// (a credit LIMIT, a different concept from the account's actual current balance; conflating the
// two would show a misleading number). Banks/messages without this phrasing simply return null,
// not a guessed value.
const AVAILABLE_BALANCE_PATTERN = /Avl\.?\s*Bal(?:ance)?s?[:\s]*(?:Rs\.?|INR)?\s?([\d,]+\.?\d*)/i;

export function extractAvailableBalance(rawSms: string): number | null {
  const match = rawSms.match(AVAILABLE_BALANCE_PATTERN);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ""));
  return Number.isNaN(value) ? null : value;
}

// Best-effort "which app" for UPI transactions — some (not all) bank SMS include the payee's VPA
// (e.g. "to merchant@paytm", "9876543210@ybl"), and a VPA's handle suffix identifies which PSP app
// issued it. Same generic-regex-over-raw-text pattern as extractAvailableBalance above, run once
// independent of which of the 40+ per-bank rules matched, rather than threading a new capture group
// into each one. Deliberately conservative: only handles this session could confirm with reasonable
// confidence are mapped; a genuinely unrecognized or absent VPA returns null rather than a guess —
// the caller falls back to the reliable "UPI" channel label in that case, never nothing. CRED and
// Tata Neu are known real UPI apps but were left out here since their exact VPA handle couldn't be
// confirmed with confidence — worth adding once verified against a real sample SMS.
const VPA_HANDLE_TO_APP: Record<string, string> = {
  paytm: "Paytm",
  ptaxis: "Paytm",
  ptsbi: "Paytm",
  pthdfc: "Paytm",
  ybl: "PhonePe",
  ibl: "PhonePe",
  axl: "PhonePe",
  okhdfcbank: "Google Pay",
  okicici: "Google Pay",
  okaxis: "Google Pay",
  oksbi: "Google Pay",
  okbizaxis: "Google Pay",
  apl: "Amazon Pay",
  yapl: "Amazon Pay",
  jupiteraxis: "Jupiter",
};

const VPA_PATTERN = /[\w.\-]{2,}@([a-zA-Z]{2,})/;

export function extractPaymentApp(rawSms: string): string | null {
  const match = rawSms.match(VPA_PATTERN);
  if (!match) return null;
  return VPA_HANDLE_TO_APP[match[1].toLowerCase()] ?? null;
}

// Was previously missing entirely: category assignment only ever ran merchant-keyword matching
// (categorizeMerchant), regardless of txnType — so every credit-type transaction (salary, refunds,
// transfers received) fell through to null/uncategorized and got silently counted as an *expense*
// everywhere Income/Expense figures are computed (the filter is `category !== "income"`, and
// `null !== "income"` is true). A credit-type SMS is genuine "income" only when it credits a real
// bank/UPI/wallet balance — a credit reflected on the CARD channel (a bill payment confirmation, a
// refund, a reversal) is money clearing/returning, not new income, so it's tagged "transfer"
// instead: excluded from both income and expense sums, rather than wrongly inflating either one.
export function categoryForTxnType(
  txnType: "debit" | "credit",
  channel: PaymentChannel,
  merchant: string | null,
  categorizeMerchant: (merchant: string | null) => string | null,
): string | null {
  if (txnType === "credit") {
    return channel === "card" ? "transfer" : "income";
  }
  return categorizeMerchant(merchant);
}
