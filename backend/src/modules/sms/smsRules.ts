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
  // A credit that is money coming back (a failed/reversed UPI debit), not new income — tagged
  // "transfer" by categoryForTxnType so it doesn't inflate income.
  refund?: boolean;
  // Inferred from which pattern matched (card-swipe language, UPI-handle "Sent/Received", generic
  // A/C debit/credit, or a prepaid wallet) — not derivable from merchant text alone.
  channel: PaymentChannel;
  // A category the rule itself knows (a FASTag toll, a transfer to an account number); wins over the
  // merchant keyword lookup in categoryForTxnType.
  category?: string;
  // "%s" is replaced by the captured merchant group ("IMPS to A/c ••%s").
  merchantTemplate?: string;
}

export const smsRules: SmsRule[] = [
  // ── HDFC Bank ──────────────────────────────────────────────────────────────────
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "spent-A", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /Spent\s+Rs\.?\s?([\d,]+\.?\d*)\s+(?:On|From)\s+HDFC Bank Card\s+\S+\s+At\s+(.+?)\s+On\s+\d{4}-\d{2}-\d{2}/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "spent-B", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+spent (?:on|From)\s+HDFC Bank Card\s+\S+\s+at\s+(.+?)\s+on\s+\d{4}-\d{2}-\d{2}/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "upi-txn", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "upi",
    pattern: /Txn\s+Rs\.?\s?([\d,]+\.?\d*)\s+On\s+HDFC Bank Card\s+\S+\s+At\s+(.+?)\s+by\s+UPI/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "paid-online-banking", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /Paid\s+Rs\.?\s?([\d,]+\.?\d*)\s+For:\s+(.+?)\s+From HDFC Bank A\/c/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "credit-alert", txnType: "credit", amountGroup: 1, merchantFallback: "HDFC Bank credit", channel: "bank_transfer",
    pattern: /Credit Alert!\s+Rs\.?([\d,]+\.?\d*)\s+credited to HDFC Bank A\/c/i },
  // "Update! INR X deposited in HDFC Bank A/c XX1234 on 30-JUL-26 for NEFT Cr-<IFSC>-Salary Acme Pvt Ltd-NAME-REF.Avl bal"
  // — HDFC's NEFT/RTGS/IMPS credit wording (salary included). Says "deposited", never "credited", so nothing matched it.
  // Merchant = the remitter text after the IFSC. Mirrors SmsRules.kt.
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "neft-deposit", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /INR\s?([\d,]+\.?\d*)\s+deposited in HDFC Bank A\/c\s+\S+\s+on\s+[\w-]+\s+for\s+(?:NEFT|RTGS|IMPS)\s*Cr-[A-Z0-9]+-([^-]{2,60}?)(?=-)/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "deposit", txnType: "credit", amountGroup: 1, merchantFallback: "HDFC Bank deposit", channel: "bank_transfer",
    pattern: /INR\s?([\d,]+\.?\d*)\s+deposited in HDFC Bank A\/c/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "card-payment-credited", txnType: "credit", amountGroup: 1, merchantFallback: "Credit card payment", channel: "card",
    pattern: /Payment of Rs\.?\s?([\d,]+\.?\d*)\s+was credited to your card ending/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "bill-paid-smartpay", txnType: "debit", amountGroup: 2, merchantGroup: 1, channel: "card",
    pattern: /Bill Paid:\s+(.+?)\s+Bill\s+\S+\s+of\s+Rs\.?\s?([\d,]+\.?\d*)\s+paid on/i },
  // Real HDFC personal-loan EMI debit confirmation (as opposed to the "EMI Reminder"/"due on"
  // messages sent before the debit actually happens, which are deliberately NOT matched here —
  // matching those would record a spend that hasn't occurred yet).
  // The loan number's last 4 digits name the loan, so two HDFC loans are two payees. Mirrors SmsRules.kt.
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "loan-emi-debited-numbered", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    category: "emi", merchantTemplate: "HDFC Bank loan ••%s",
    pattern: /INR\s?([\d,]+\.?\d*)\s+debited from HDFC Bank\s+\S+\s+on\s+[\w-]+\.\s*Info:\s*EMI\s+\d*(\d{4})\b/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "loan-emi-debited", txnType: "debit", amountGroup: 1, merchantFallback: "EMI", channel: "bank_transfer",
    pattern: /INR\s?([\d,]+\.?\d*)\s+debited from HDFC Bank\s+\S+\s+on\s+[\w-]+\.\s*Info:\s*EMI/i },
  // "Info: ACH D- UNION BANK OF INDIA-A9Q…" — a mandate debit; a bank/lender payee is a loan EMI.
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "ach-lender", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer", category: "emi",
    pattern: /INR\s?([\d,]+\.?\d*)\s+debited from HDFC Bank\s+\S+\s+on\s+[\w-]+\.\s*Info:\s*ACH\s*D-\s*([^-]*?\b(?:BANK|FINANCE|FINANCIAL|CAPITAL|LOANS?|HOUSING)\b[^-]*?)\s*-/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "ach", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /INR\s?([\d,]+\.?\d*)\s+debited from HDFC Bank\s+\S+\s+on\s+[\w-]+\.\s*Info:\s*ACH\s*D-\s*([^-]{2,50}?)\s*-/i },
  // HDFC also sends "IMPS INR … sent" for the same transfer, so this is a transfer too.
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "imps-info", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer", category: "transfer",
    pattern: /INR\s?([\d,]+\.?\d*)\s+debited from HDFC Bank\s+\S+\s+on\s+[\w-]+\.\s*Info:\s*IMPS-\d+-([^-]{2,50}?)-/i },
  // IMPS / net-banking transfers to an account number — no payee name, and in a real export most
  // went to the sender's own accounts, so they are transfers, never spend.
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "imps-sent", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    category: "transfer", merchantTemplate: "IMPS to A/c ••%s",
    pattern: /IMPS\s+INR\s?([\d,]+\.?\d*)\s+sent from HDFC Bank A\/c\s+\S+\s+on\s+[\d-]+\s+To A\/c\s+[xX*]*\d*?(\d{4})\b/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "online-transfer", txnType: "debit", amountGroup: 1, merchantFallback: "HDFC online transfer", channel: "bank_transfer", category: "transfer",
    pattern: /Amt Deducted!\s*Rs\.?\s?([\d,]+\.?\d*)\s+from your HDFC Bank A\/c\s+\S+\s+for Money Transfer via HDFC Bank Online Banking/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "received-imps", txnType: "credit", amountGroup: 1, merchantGroup: 2, merchantFallback: "HDFC Bank credit", channel: "bank_transfer",
    pattern: /Received!\s*INR\s?([\d,]+\.?\d*)\s+in HDFC Bank A\/c\s+\S+\s+On\s+[\d-]+\s+For\s+(?:IMPS|NEFT|RTGS|UPI)?\s*-\s*([^-\n]{2,60}?)\s*-/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "atm-withdrawn", txnType: "debit", amountGroup: 1, merchantFallback: "Cash withdrawal", channel: "card",
    pattern: /Withdrawn\s+Rs\.?\s?([\d,]+\.?\d*)\s+From HDFC Bank Card\s+\S+\s+At\s+.+?\s+On\s+\d{4}-\d{2}-\d{2}/i },
  { bankCode: "HDFCBK", bankName: "HDFC Bank", name: "smart-pay", txnType: "debit", amountGroup: 1, merchantFallback: "Bill payment (Smart Pay)", channel: "card",
    pattern: /successfully debited your HDFC Bank Credit card ending\s+\d+\s+to pay your\s+.+?\s+bill for the amount Rs\.?\s?([\d,]+\.?\d*)/i },

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
  // Must precede "received": same opening, but this one names the payer's UPI handle.
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "received-upi-from", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "upi",
    pattern: /Received\s+Rs\.?\s*([\d,]+\.?\d*)\s+in your Kotak Bank A\/?C\s+\S+\s+from\s+(\S+?)\s+on\s+[\d-]+/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "received", txnType: "credit", amountGroup: 1, merchantFallback: "Kotak Bank transfer", channel: "upi",
    pattern: /Received\s+Rs\.?\s*([\d,]+\.?\d*)\s+(?:on\s+[\d-]+\s+)?in your Kotak Bank A\/?C/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "nach-pg-debit", txnType: "debit", amountGroup: 1, merchantGroup: 2, merchantFallback: "Kotak Bank auto-debit", channel: "bank_transfer",
    pattern: /(?:INR|Rs\.?)\s?([\d,]+\.?\d*)\s+(?:is\s+)?debited (?:to|from) your Account.*?(?:towards\s+(.+?)\s+)?Kotak Bank/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "pg-debit-alt", txnType: "debit", amountGroup: 1, merchantFallback: "Kotak Bank payment", channel: "bank_transfer",
    pattern: /Rs\.?([\d,]+\.?\d*)\s+debited from A\/C\s+\S+\s+via Kotak Bank PG/i },
  // Must precede "reversal-credit", which would otherwise count a reversed UPI debit as income.
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "upi-reversal", txnType: "credit", refund: true, amountGroup: 1, merchantFallback: "UPI reversal", channel: "upi",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+is credited to Kotak Bank a\/c.*?as a reversal of debit transaction/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "reversal-credit", txnType: "credit", amountGroup: 1, merchantFallback: "Kotak Bank credit", channel: "bank_transfer",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+is credited to (?:your\s+)?Kotak Bank a\/c/i },
  { bankCode: "KOTAKB", bankName: "Kotak Bank", name: "rtgs-neft-credit", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+credited to (?:your\s+)?Kotak Bank a\/c.*?from beneficiary\s+(.+?)\./i },

  // ── IndusInd Bank ──────────────────────────────────────────────────────────────
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "credited-from", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/C\s+\S+\s+credited by Rs\s?([\d,]+\.?\d*)\s+from\s+(.+?)\./i },
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "debited-towards", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/C\s+\S+\s+debited by Rs\s?([\d,]+\.?\d*)\s+towards\s+(.+?)\./i },
  // "Debited;" and "Credited;" share one layout — they were one rule tagged "debit", so a credit
  // (e.g. "Ref-Repayment credit") was counted as spend.
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "debited-ref", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/C\s+Debited;\s+INR\s?([\d,]+\.?\d*)\s+Ref-(.+?)\d/i },
  { bankCode: "INDUSB", bankName: "IndusInd Bank", name: "credited-ref", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/C\s+Credited;\s+INR\s?([\d,]+\.?\d*)\s+Ref-(.+?)\d/i },
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
    category: "tolls", pattern: /INR\s?([\d,]+\.?\d*)\s+toll paid from IDFC FIRST Bank Tag/i },
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "account-credited", txnType: "credit", amountGroup: 1, merchantFallback: "IDFC FIRST Bank credit", channel: "bank_transfer",
    pattern: /A\/C\s+\S+\s+is credited with INR\s?([\d,]+\.?\d*)\s+on/i },
  // A top-up, not spend — the tolls deducted from the tag are the spend.
  { bankCode: "IDFCFB", bankName: "IDFC FIRST Bank", name: "fastag-recharge", txnType: "debit", amountGroup: 1, merchantFallback: "FASTag recharge", channel: "wallet", category: "transfer",
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

  // ── Kotak 811 (KOTAKD sender — a different bank code, so KOTAKB rules never see these) ──
  { bankCode: "KOTAKD", bankName: "Kotak Bank", name: "upi-sent", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "upi",
    pattern: /Sent\s+Rs\.?\s?([\d,]+\.?\d*)\s+from\s+\S+\s+to\s+(.+?)\s+on\s+\d{1,2}[\/-](?:\d{1,2}|[A-Za-z]{3})[\/-]\d{2,4}\.\s*UPI ref/i },
  { bankCode: "KOTAKD", bankName: "Kotak Bank", name: "upi-received", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "upi",
    pattern: /Received\s+Rs\.?\s?([\d,]+\.?\d*)\s+from\s+(.+?)\s+in your Kotak\S*\s+a\/c/i },

  // ── SBI ────────────────────────────────────────────────────────────────────────
  { bankCode: "CBSSBI", bankName: "State Bank of India", name: "debited-transferred", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /A\/C\s+\S+\s+Debited INR\s?([\d,.]+)\s+on\s+[\d/]+\s+-Transferred to\s+(.+?)\.\s+Avl Balance/i },
  { bankCode: "CBSSBI", bankName: "State Bank of India", name: "debit-by-transfer", txnType: "debit", amountGroup: 1, merchantFallback: "SBI transfer", channel: "bank_transfer",
    pattern: /has a debit by transfer of Rs\.?\s?([\d,]+\.?\d*)\s+on/i },
  { bankCode: "SBIUPI", bankName: "State Bank of India", name: "upi-debit", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "upi",
    pattern: /A\/C\s+\S+\s+debited by\s+([\d,]+\.?\d*)\s+on date\s+\S+\s+trf to\s+(.+?)\s+(?:Refno\s+)?\d{6,}/i },
  { bankCode: "SBIUPI", bankName: "State Bank of India", name: "upi-credit", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "upi",
    pattern: /A\/c\s*\S+?credited by Rs\.?\s?([\d,]+\.?\d*)\s+on\s+\S+\s+transfer from\s+(.+?)\s+Ref No/i },
  { bankCode: "SBIUPI", bankName: "State Bank of India", name: "upi-reversal", txnType: "credit", refund: true, amountGroup: 1, merchantFallback: "UPI reversal", channel: "upi",
    pattern: /credited with Rs\.?\s?([\d,]+\.?\d*)\s+on\s+\S+\s+against reversal/i },
  { bankCode: "SBIINB", bankName: "State Bank of India", name: "imps-credit", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /a\/c no\.\s+\S+\s+is credited by Rs\.?\s?([\d,]+\.?\d*)\s+on\s+[\d-]+\s+by a\/c linked to mobile\s+\S+?-\s*(.+?)\s*\((?:IMPS|UPI)/i },
  { bankCode: "SBIPSG", bankName: "State Bank of India", name: "imps-credit", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /a\/c no\.\s+\S+\s+is credited by Rs\.?\s?([\d,]+\.?\d*)\s+on\s+[\d-]+\s+by a\/c linked to mobile\s+\S+?-\s*(.+?)\s*\((?:IMPS|UPI)/i },
  { bankCode: "SBICRD", bankName: "SBI Card", name: "bbps-payment", txnType: "credit", amountGroup: 1, merchantFallback: "Credit card payment", channel: "card",
    pattern: /received payment of Rs\.?\s?([\d,]+\.?\d*)\s+via\s+\S+\s+&\s+the same has been credited to your SBI Credit Card/i },
  // Same SBI Card message delivered over RCS (sender "SIP:SBI_CARDS_AND_PAYMENT_SERVICES_...").
  { bankCode: "SBI_CARDS", bankName: "SBI Card", name: "bbps-payment-rcs", txnType: "credit", amountGroup: 1, merchantFallback: "Credit card payment", channel: "card",
    pattern: /received payment of Rs\.?\s?([\d,]+\.?\d*)\s+via\s+\S+\s+&\s+the same has been credited to your SBI Credit Card/i },

  // ── Pluxee (meal card) ─────────────────────────────────────────────────────────
  // ── Jupiter Edge CSB RuPay credit card ─────────────────────────────────────────
  { bankCode: "JTEDGE", bankName: "Edge CSB Bank", name: "card-paid", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /₹\s?([\d,]+\.?\d*)\s+paid from your Edge CSB Bank RuPay Credit Card to\s+(.+?)(?:\s+\S+\s+[A-Z]{2}IN)?\s+on\s+\d{4}-\d{2}-\d{2}/i },
  { bankCode: "JTEDGE", bankName: "Edge CSB Bank", name: "upi-on-card", txnType: "debit", amountGroup: 1, merchantFallback: "UPI payment (Edge CSB card)", channel: "card",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+debited to your Edge CSB (?:Bank )?RuPay Credit Card/i },

  // ── IDBI NETC FASTag ───────────────────────────────────────────────────────────
  { bankCode: "WLIDBI", bankName: "IDBI FASTag", name: "fastag-parking", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "wallet", category: "tolls",
    pattern: /FASTag linked vehicle no\.\s*\S+\s+has been debited with Rs\.?\s?([\d,]+\.?\d*)\/?-?\s+at\s+(.+?)\s+on\s+\d{2}-\d{2}-\d{4}/i },
  { bankCode: "WLIDBI", bankName: "IDBI FASTag", name: "fastag-toll", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "wallet", category: "tolls",
    pattern: /Rs\.?\s?([\d,]+\.?\d*)\s+toll debited for VRN-\S+\s+on\s+.*\s+at\s+(.+?)\s*\.\s*(?:Toll\s+)?Bal/i },

  { bankCode: "PLUXEE", bankName: "Pluxee", name: "spent", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "wallet",
    pattern: /Rs\.?\s?([\d,.]+)\s+spent from Pluxee\s+Meal wallet.*?at\s+(.+?)\s*\.\s*Avl bal/i },
  { bankCode: "PLUXEE", bankName: "Pluxee", name: "wallet-credited", txnType: "credit", amountGroup: 1, merchantFallback: "Pluxee wallet top-up", channel: "wallet",
    pattern: /Pluxee Card.*?credited with (?:Rs\.?|INR\s?)([\d,.]+)\s+(?:towards|on)/i },
];

// ── Bank-agnostic fallback ─────────────────────────────────────────────────────────────────────
// The table above is keyed on bank code, and the `senderUpper.includes(r.bankCode)` filter means a
// sender whose code isn't listed gets ZERO rules tried — however standard its wording is. Someone
// banking with Yes/PNB/Canara/Federal/Fi/Slice therefore had every historical transaction silently
// dropped by the regex-only inbox backfill (the LLM fallback is real-time only, so it can't rescue
// history). These structural patterns run only after every bank-specific rule missed.
//
// Deliberately conservative: a false positive invents a transaction the user has to hunt down and
// delete, which is worse than missing one. Hence the guards below, and merchant capture that never
// crosses a sentence boundary.
//
// KEEP IN SYNC with genericRules in android/.../data/sms/SmsRules.kt.
export const genericSmsRules: SmsRule[] = [
  // Debits — payee-capturing variants first, bare amount as the fallback.
  { bankCode: "", bankName: "Generic", name: "generic-debited-to", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /(?:Rs|INR)\.?\s?([\d,]+\.?\d*)\s+(?:has been |have been |is |was )?debited[^.]{0,60}?\b(?:towards|to|for)\s+([^.,;]{2,40}?)(?:\s+on\s|[.,;]|$)/i },
  { bankCode: "", bankName: "Generic", name: "generic-debited", txnType: "debit", amountGroup: 1, merchantFallback: "Bank debit", channel: "bank_transfer",
    pattern: /(?:Rs|INR)\.?\s?([\d,]+\.?\d*)\s+(?:has been |have been |is |was )?debited/i },
  { bankCode: "", bankName: "Generic", name: "generic-debited-by", txnType: "debit", amountGroup: 1, merchantFallback: "Bank debit", channel: "bank_transfer",
    pattern: /debited\s+(?:by|with|for)\s+(?:Rs|INR)\.?\s?([\d,]+\.?\d*)/i },
  { bankCode: "", bankName: "Generic", name: "generic-spent-at", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "card",
    pattern: /(?:Rs|INR)\.?\s?([\d,]+\.?\d*)\s+(?:has been |have been |is |was )?spent[^.]{0,60}?\bat\s+([^.,;]{2,40}?)(?:\s+on\s|[.,;]|$)/i },
  { bankCode: "", bankName: "Generic", name: "generic-spent", txnType: "debit", amountGroup: 1, merchantFallback: "Card spend", channel: "card",
    pattern: /(?:spent\s+(?:Rs|INR)\.?\s?([\d,]+\.?\d*)|(?:Rs|INR)\.?\s?([\d,]+\.?\d*)\s+spent)/i },
  { bankCode: "", bankName: "Generic", name: "generic-sent-to", txnType: "debit", amountGroup: 1, merchantGroup: 2, channel: "upi",
    pattern: /Sent\s+(?:Rs|INR)\.?\s?([\d,]+\.?\d*)[^.]{0,60}?\bto\s+([^.,;]{2,40}?)(?:\s+on\s|[.,;]|$)/i },
  { bankCode: "", bankName: "Generic", name: "generic-withdrawn", txnType: "debit", amountGroup: 1, merchantFallback: "Cash withdrawal", channel: "card",
    pattern: /(?:Rs|INR)\.?\s?([\d,]+\.?\d*)\s+(?:has been |is |was )?withdrawn/i },

  // Credits — a card-channel credit is a bill payment/refund clearing, not new income, so these
  // stay on bank_transfer/upi and let categoryForTxnType decide (see its doc comment).
  { bankCode: "", bankName: "Generic", name: "generic-credited-from", txnType: "credit", amountGroup: 1, merchantGroup: 2, channel: "bank_transfer",
    pattern: /(?:Rs|INR)\.?\s?([\d,]+\.?\d*)\s+(?:has been |have been |is |was )?credited[^.]{0,60}?\b(?:from|by)\s+([^.,;]{2,40}?)(?:\s+on\s|[.,;]|$)/i },
  { bankCode: "", bankName: "Generic", name: "generic-credited", txnType: "credit", amountGroup: 1, merchantFallback: "Bank credit", channel: "bank_transfer",
    pattern: /(?:Rs|INR)\.?\s?([\d,]+\.?\d*)\s+(?:has been |have been |is |was )?credited/i },
  { bankCode: "", bankName: "Generic", name: "generic-credited-by", txnType: "credit", amountGroup: 1, merchantFallback: "Bank credit", channel: "bank_transfer",
    pattern: /credited\s+(?:by|with)\s+(?:Rs|INR)\.?\s?([\d,]+\.?\d*)/i },
  { bankCode: "", bankName: "Generic", name: "generic-received", txnType: "credit", amountGroup: 1, merchantFallback: "Money received", channel: "upi",
    pattern: /Received\s+(?:Rs|INR)\.?\s?([\d,]+\.?\d*)/i },
];

// Phrases that mean "this is not a completed transaction", checked before the generic rules run.
// Every one of these otherwise matches a generic pattern and books money that never moved: an OTP
// quotes the amount it is authorising, an EMI reminder is future-tense, and a declined payment
// reads exactly like a successful one apart from the verb.
const NON_TRANSACTION_MARKERS = [
  "otp", "one time password", "one-time password", "do not share", "never share",
  "will be debited", "will be deducted", "will be credited", "due on", "is due", "due date",
  "scheduled", "declined", "failed", "unsuccessful", "not processed", "request for",
  "cashback of", "you can get", "apply now", "offer", "win ", "click", "eligible for",
  "convert now", "convert here", "convert to emi", "convert your", "to convert", "split into", "emi conversion", "could not process", "autopay facility has been",
];

function looksLikeCompletedTransaction(rawSms: string): boolean {
  const lower = rawSms.toLowerCase();
  return !NON_TRANSACTION_MARKERS.some((m) => lower.includes(m));
}

// A DLT bank header ("JM-HDFCBK-S", "AD-YESBNK") always carries letters. A plain 10-digit mobile
// number is a person, and "I spent 500 on dinner" from a friend must never become a transaction —
// the same "business senders only" line Walnut/axio draws.
function isLikelyBusinessSender(bankSender: string): boolean {
  const trimmed = bankSender.trim();
  return trimmed.length > 0 && !/^\+?\d{10,13}$/.test(trimmed);
}

function applyRule(rule: SmsRule, rawSms: string) {
  const match = rawSms.match(rule.pattern);
  if (!match) return null;
  // An alternation rule captures its amount in whichever branch fired, so take the first non-empty
  // group rather than assuming amountGroup is the populated one.
  const amountText = match[rule.amountGroup] || match.slice(1).find((g) => g && /^\d/.test(g));
  if (!amountText) return null;
  const amount = parseFloat(amountText.replace(/,/g, ""));
  if (Number.isNaN(amount)) return null;
  const captured = rule.merchantGroup ? match[rule.merchantGroup]?.trim() : undefined;
  const named = captured && captured.toLowerCase() !== "null" ? captured : null;
  const merchant = (named && rule.merchantTemplate ? rule.merchantTemplate.replace("%s", named) : named) || rule.merchantFallback || null;
  return { amount, merchant, txnType: rule.txnType, channel: rule.channel, refund: rule.refund === true, category: rule.category ?? null };
}

// Mirrors InstrumentExtractor.kt's credit-card / account checks, for the generic-credit guard below.
const CREDIT_CARD_SENDERS = ["RBLCRD", "BOBCRD", "AMEXIN", "SBICRD", "SBI_CARDS", "JTEDGE", "ONECRD", "SIBONE"];
const ACCOUNT_NUMBER = /(?:\ba\/c|\bacct\b|\baccount\b|\bac\b)\.?\s*(?:no\.?|ending)?\s*[:\-]?\s*(?:[xX*.]*\d*[xX*.]+\d{3,}|[xX*.]{2,}\d{3,}|\d{4,})|\bbank\s+[xX*]{2,}\d{4}\b|\bfrom\s+[xX*]{2,}\d{4}\b/i;
const GENERIC_MERCHANTS = new Set(["bank debit", "card spend", "bank credit", "money received", "emi"]);

function creditTarget(bankSender: string, rawSms: string): "card" | "account" | null {
  const sender = bankSender.toUpperCase();
  if (/fastag|toll (?:paid|debited)|\bVRN-/i.test(rawSms)) return null;
  if (sender.includes("PLUXEE") || /meal wallet|\b(?:via|from|your|in)\s+\w+\s+wallet\b|swiggy money/i.test(rawSms)) return null;
  if (/credit\s*card|bobcard|amex card/i.test(rawSms) || CREDIT_CARD_SENDERS.some((c) => sender.includes(c))) return "card";
  return ACCOUNT_NUMBER.test(rawSms) ? "account" : null;
}

export function tryParseWithRules(bankSender: string, rawSms: string) {
  const senderUpper = bankSender.toUpperCase();
  const candidates = smsRules.filter((r) => senderUpper.includes(r.bankCode));
  for (const rule of candidates) {
    const parsed = applyRule(rule, rawSms);
    if (parsed) return parsed;
  }

  if (!isLikelyBusinessSender(bankSender) || !looksLikeCompletedTransaction(rawSms)) return null;
  for (const rule of genericSmsRules) {
    const parsed = applyRule(rule, rawSms);
    if (!parsed) continue;
    if (parsed.txnType !== "credit") return parsed;
    // A generic "credited" is income only when it lands in a bank account. One on a credit card is a
    // bill payment or refund (card rail -> "transfer"). One naming neither is a wallet credit, store
    // cashback or a fee receipt — never income. Mirrors SmsRules.kt.
    const target = creditTarget(bankSender, rawSms);
    if (target === "card") {
      const m = parsed.merchant;
      const generic = !m || /^a\/c/i.test(m) || GENERIC_MERCHANTS.has(m.trim().toLowerCase());
      return { ...parsed, channel: "card" as PaymentChannel, merchant: generic ? "Credit card credit" : m };
    }
    return target === "account" ? parsed : null;
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
  refund = false,
  ruleCategory: string | null = null,
): string | null {
  if (ruleCategory) return ruleCategory;
  if (txnType === "credit") {
    return channel === "card" || refund ? "transfer" : "income";
  }
  return categorizeMerchant(merchant);
}
