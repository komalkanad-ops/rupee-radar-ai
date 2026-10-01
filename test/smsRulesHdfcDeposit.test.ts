import { describe, it, expect } from "vitest";
import { tryParseWithRules, categoryForTxnType } from "../src/modules/sms/smsRules";
import { categorizeMerchant } from "../src/modules/categorization/merchantCategorizer";

// Mirrors android SmsRulesHdfcDepositTest — same cases, same expectations. Synthetic messages in
// HDFC's real "deposited in" shape (salary credits were never parsed before this rule).
describe("HDFC deposit credits", () => {
  it("parses an HDFC NEFT salary deposit as income from the remitter", () => {
    const r = tryParseWithRules(
      "JM-HDFCBK-S",
      "Update! INR 2,51,438.00 deposited in HDFC Bank A/c XX1234 on 30-JUL-26 for NEFT Cr-ABCD0XYZ001-Salary Acme Software India Pvt. Ltd-TEST USER-ABCDN12345.Avl bal INR 3,10,000.00. Cheque deposits in A/C are subject to clearing",
    );
    expect(r?.amount).toBe(251438);
    expect(r?.txnType).toBe("credit");
    expect(r?.channel).toBe("bank_transfer");
    expect(r?.merchant).toBe("Salary Acme Software India Pvt. Ltd");
    expect(categoryForTxnType(r!.txnType, r!.channel, r!.merchant, categorizeMerchant, r!.refund)).toBe("income");
  });

  it("parses an HDFC deposit without a NEFT descriptor using the fallback label", () => {
    const r = tryParseWithRules("AD-HDFCBK-S", "Update! INR 5,000.00 deposited in HDFC Bank A/c XX1234 on 02-AUG-26 by cash.Avl bal INR 9,000.00");
    expect(r?.amount).toBe(5000);
    expect(r?.txnType).toBe("credit");
    expect(r?.merchant).toBe("HDFC Bank deposit");
  });
});
