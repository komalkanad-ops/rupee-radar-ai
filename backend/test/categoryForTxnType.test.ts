import { describe, it, expect } from "vitest";
import { tryParseWithRules, categoryForTxnType } from "../src/modules/sms/smsRules";
import { categorizeMerchant } from "../src/modules/categorization/merchantCategorizer";

// Verifies the actual bug report this fix addresses: credit-type SMS (salary, refunds, transfers
// received) were never tagged "income" anywhere in the pipeline — category assignment only ever
// ran merchant-keyword matching, which can't recognize generic credit-alert text like "HDFC Bank
// credit", so these fell through to null and got silently counted as *expenses* (the Income/
// Expense/Savings filter is `category !== "income"`, and null !== "income" is true).
describe("categoryForTxnType", () => {
  it("tags a real bank-account credit (salary, transfer received) as income", () => {
    const r = tryParseWithRules("JM-HDFCBK-S", "Credit Alert! Rs.85000 credited to HDFC Bank A/c XX1234 on 01-01-26.");
    expect(r?.txnType).toBe("credit");
    expect(r?.channel).toBe("bank_transfer");
    expect(categoryForTxnType(r!.txnType, r!.channel, r!.merchant, categorizeMerchant)).toBe("income");
  });

  it("tags a UPI credit (money received) as income", () => {
    const r = tryParseWithRules("AD-KOTAKB-S", "Received Rs.2000.00 on 01-01-26 in your Kotak Bank A/C X5599.");
    expect(r?.txnType).toBe("credit");
    expect(categoryForTxnType(r!.txnType, r!.channel, r!.merchant, categorizeMerchant)).toBe("income");
  });

  it("tags a credit-card bill payment confirmation as transfer, NOT income", () => {
    const r = tryParseWithRules("JM-HDFCBK-S", "Payment of Rs.15000.00 was credited to your card ending 4848 on 01-01-26. Thank you.");
    expect(r?.txnType).toBe("credit");
    expect(r?.channel).toBe("card");
    expect(categoryForTxnType(r!.txnType, r!.channel, r!.merchant, categorizeMerchant)).toBe("transfer");
  });

  it("tags a refund credited to a card as transfer, NOT income", () => {
    const r = tryParseWithRules(
      "AX-RBLCRD-S",
      "Refund Alert! INR 499.00 was credited on your RBL Bank Credit Card XX1234 from Amazon on 01-01-26.",
    );
    expect(r?.txnType).toBe("credit");
    expect(r?.channel).toBe("card");
    expect(categoryForTxnType(r!.txnType, r!.channel, r!.merchant, categorizeMerchant)).toBe("transfer");
  });

  it("leaves debit transactions on ordinary merchant-keyword categorization, unaffected", () => {
    const r = tryParseWithRules("JM-HDFCBK-S", "Spent Rs.1300 On HDFC Bank Card 5848 At SWIGGY . On 2025-09-17:21:08:13.Not You?");
    expect(r?.txnType).toBe("debit");
    expect(categoryForTxnType(r!.txnType, r!.channel, r!.merchant, categorizeMerchant)).toBe("dining");
  });
});
