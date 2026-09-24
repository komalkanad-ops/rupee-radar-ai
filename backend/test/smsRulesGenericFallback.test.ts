import { describe, it, expect } from "vitest";
import { tryParseWithRules } from "../src/modules/sms/smsRules";

// The bank-specific rule table is keyed on DLT bank code, so a sender whose code isn't listed
// previously got zero rules tried and was silently dropped by the regex-only inbox backfill. These
// cover the generic structural fallback that now runs after every bank-specific rule misses.
//
// The false-positive cases matter more than the match cases: an invented transaction is worse than
// a missed one, because the user has to find and delete it.
describe("tryParseWithRules — generic fallback for unlisted banks", () => {
  it("parses a debit from a bank with no specific rules (Yes Bank)", () => {
    const r = tryParseWithRules("AD-YESBNK-S", "Rs 2,500.00 debited from A/c XX4432 towards SWIGGY on 12-09-25. Avl Bal Rs 18,220.10");
    expect(r?.amount).toBe(2500);
    expect(r?.txnType).toBe("debit");
    expect(r?.merchant).toBe("SWIGGY");
  });

  it("parses a debit with no payee using the generic fallback label", () => {
    const r = tryParseWithRules("VM-PNBSMS-S", "INR 899.00 debited from your account XX1122 on 03-09-25.");
    expect(r?.amount).toBe(899);
    expect(r?.txnType).toBe("debit");
    expect(r?.merchant).toBe("Bank debit");
  });

  it("parses the 'debited by' word order", () => {
    const r = tryParseWithRules("AX-CANBNK-S", "A/c XX8890 debited by Rs 1,250.50 on 04-09-25. Avl Bal Rs 9,100.00");
    expect(r?.amount).toBe(1250.5);
    expect(r?.txnType).toBe("debit");
  });

  it("parses a card spend and classifies it as card", () => {
    const r = tryParseWithRules("JM-FEDBNK-S", "Rs 450.00 spent on your card XX7788 at BLUE TOKAI on 11-09-25");
    expect(r?.amount).toBe(450);
    expect(r?.channel).toBe("card");
    expect(r?.merchant).toBe("BLUE TOKAI");
  });

  it("parses a UPI 'Sent' from an unlisted bank as upi", () => {
    const r = tryParseWithRules("AD-BANDHN-S", "Sent Rs.300.00 from A/c XX1234 to ramesh@ybl on 09-09-25. UPI Ref 4455");
    expect(r?.channel).toBe("upi");
    expect(r?.txnType).toBe("debit");
    expect(r?.merchant).toBe("ramesh@ybl");
  });

  it("parses a credit and treats it as income, not a card clearing", () => {
    const r = tryParseWithRules("VM-IOBCHN-S", "Rs 45,000.00 credited to A/c XX9900 from ACME PAYROLL on 01-09-25");
    expect(r?.amount).toBe(45000);
    expect(r?.txnType).toBe("credit");
    expect(r?.channel).toBe("bank_transfer");
  });

  it("still prefers a bank-specific rule over the generic one", () => {
    // HDFC has its own rule for this. If the generic "spent" rule won instead, the merchant would
    // degrade to the "Card spend" fallback — that regression is what this guards against.
    const r = tryParseWithRules("JM-HDFCBK-S", "Spent Rs.1300 On HDFC Bank Card 5848 At _PRO LIFE CHEMIST . On 2025-09-17:21:08:13.Not You?");
    expect(r?.merchant).toContain("_PRO LIFE CHEMIST");
    expect(r?.merchant).not.toBe("Card spend");
  });

  // ── Must NOT parse ───────────────────────────────────────────────────────────────────────────
  it("ignores an OTP message that quotes the amount it authorises", () => {
    const r = tryParseWithRules("VM-SBIOTP-S", "OTP is 445566 for a transaction of Rs 5,000.00 on your card. Do not share it with anyone.");
    expect(r).toBeNull();
  });

  it("ignores a future-tense EMI reminder", () => {
    const r = tryParseWithRules("AD-LOANCO-S", "Your EMI of Rs 12,500.00 will be debited from A/c XX1234 on 05-10-25.");
    expect(r).toBeNull();
  });

  it("ignores a declined transaction", () => {
    const r = tryParseWithRules("AD-AUBANK-S", "Transaction of Rs 2,000.00 on your card was declined due to insufficient balance.");
    expect(r).toBeNull();
  });

  it("ignores a promotional offer", () => {
    const r = tryParseWithRules("VM-PROMOS-S", "Get cashback of Rs 500 when you spend Rs 2,000 this weekend. Click to know more.");
    expect(r).toBeNull();
  });

  it("ignores a message from a personal mobile number", () => {
    const r = tryParseWithRules("+919876543210", "I spent Rs 500 on dinner yesterday, send me your share");
    expect(r).toBeNull();
  });

  it("ignores a plain balance enquiry with no transaction verb", () => {
    const r = tryParseWithRules("AD-UNIONB-S", "Your account XX3344 balance as on 12-09-25 is Rs 22,150.75");
    expect(r).toBeNull();
  });
});
