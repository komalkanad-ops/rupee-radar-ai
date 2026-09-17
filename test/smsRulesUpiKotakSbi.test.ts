import { describe, it, expect } from "vitest";
import { tryParseWithRules, categoryForTxnType } from "../src/modules/sms/smsRules";

// Kotak + SBI UPI/IMPS formats found missing in a real ~17k-message export (templated here with
// fake names/handles/numbers). Before these rules, SBI UPI debits, SBI IMPS credits, Kotak 811
// (KOTAKD) messages and SBI Card BBPS payments didn't parse at all, and reversed UPI debits counted
// as income.
const cat = (m: string | null) => (m ? "other" : null);

describe("tryParseWithRules — Kotak/SBI UPI formats", () => {
  it("Kotak received names the payer handle", () => {
    const r = tryParseWithRules("VM-KOTAKB-S", "Received Rs.450.00 in your Kotak Bank AC X1234 from test.user@okaxis on 12-08-25.UPI Ref:512345678901.");
    expect(r).toMatchObject({ amount: 450, merchant: "test.user@okaxis", txnType: "credit", channel: "upi" });
  });

  it("Kotak IMPS received (no handle) still parses", () => {
    const r = tryParseWithRules("VM-KOTAKB-S", "Received Rs. 2000.00 on 01-05-25 in your Kotak Bank A/C x1234 by an A/C linked to mobile x999. IMPS Ref no 512345678901.");
    expect(r).toMatchObject({ amount: 2000, txnType: "credit" });
  });

  it("Kotak UPI reversal is a refund, not income", () => {
    const r = tryParseWithRules("VM-KOTAKB-S", "Rs.250.00 is credited to Kotak Bank a/c no. XXXX1234 on 03-04-25 as a reversal of debit transaction (UPI Ref no 512345678901).");
    expect(r).toMatchObject({ amount: 250, txnType: "credit", refund: true });
    expect(categoryForTxnType(r!.txnType, r!.channel, r!.merchant, cat, r!.refund)).toBe("transfer");
  });

  it("Kotak 811 (KOTAKD) sent and received", () => {
    const sent = tryParseWithRules("AD-KOTAKD-S", "Sent Rs.320.00 from XXXXXX1234 to TEST STORE NAME on 14/08/25. UPI ref no. 512345678901. Not you? Tap https://kotk.in/KOTAKD/abc to report -Kotak");
    expect(sent).toMatchObject({ amount: 320, merchant: "TEST STORE NAME", txnType: "debit", channel: "upi" });
    const recv = tryParseWithRules("AD-KOTAKD-S", "Received Rs.1500.00 from TEST PERSON in your Kotak811 a/c XXXXXX1234 on 14/08/25. UPI ref no. 512345678901. View balance: https://kotk.in/KOTAKD/x -Kotak");
    expect(recv).toMatchObject({ amount: 1500, merchant: "TEST PERSON", txnType: "credit", channel: "upi" });
  });

  it("SBI UPI debit, both reference styles", () => {
    const a = tryParseWithRules("VM-SBIUPI-S", "Dear UPI user A/C X1234 debited by 60.0 on date 12Nov25 trf to TEST PERSON NA Refno 512345678901 If not u? call-1800111109 for other services-18001234-SBI");
    expect(a).toMatchObject({ amount: 60, merchant: "TEST PERSON NA", txnType: "debit", channel: "upi" });
    const b = tryParseWithRules("VM-SBIUPI-S", "Dear UPI user A/C X1234 debited by 1200.0 on date 03Feb25 trf to TEST SHOP 512345678901. If not u? call 1800111109. -SBI");
    expect(b).toMatchObject({ amount: 1200, merchant: "TEST SHOP", txnType: "debit" });
  });

  it("Kotak 811 with a month-name date, and SBI UPI credit", () => {
    const sent = tryParseWithRules("AD-KOTAKD-S", "Sent Rs.899.00 from XX1234 to TEST CLINIC on 14-Aug-25. UPI ref no. 512345678901. Not you? Tap https://kotk.in/KOTAKD/x to report -Kotak");
    expect(sent).toMatchObject({ amount: 899, merchant: "TEST CLINIC", txnType: "debit" });
    const recv = tryParseWithRules("VM-SBIUPI-S", "Dear SBI User, your A/c X1234-credited by Rs.5000 on 12Mar25 transfer from TEST PERSON Ref No 512345678901 -SBI");
    expect(recv).toMatchObject({ amount: 5000, merchant: "TEST PERSON", txnType: "credit", channel: "upi" });
  });

  it("SBI UPI reversal is a refund", () => {
    const r = tryParseWithRules("VM-SBIUPI-S", "Dear SBI UPI User, ur A/cX1234 credited with Rs500 on 10Aug25 against reversal of txn (Ref no 512345678901)");
    expect(r).toMatchObject({ amount: 500, txnType: "credit", refund: true });
  });

  it("SBI IMPS credit names the sender", () => {
    for (const sender of ["VM-SBIINB-S", "JD-SBIPSG-T"]) {
      const r = tryParseWithRules(sender, "Dear Customer, Your a/c no. XXXXXXXX1234 is credited by Rs.25000.00 on 05-06-25 by a/c linked to mobile 9XXXXXX999- TEST PERSON (IMPS Ref no 512345678901).If not done by you, call 1800. -SBI");
      expect(r).toMatchObject({ amount: 25000, merchant: "TEST PERSON", txnType: "credit" });
    }
  });

  it("SBI debit by transfer", () => {
    const r = tryParseWithRules("VM-CBSSBI-S", "Dear Customer, Your A/C XXXXX123456 has a debit by transfer of Rs 12,500.00 on 02/03/25. Avl Bal Rs 40,000.00.-SBI");
    expect(r).toMatchObject({ amount: 12500, txnType: "debit", channel: "bank_transfer" });
  });

  it("SBI Card BBPS payment is a card credit (transfer), SMS or RCS sender", () => {
    const text = "We have received payment of Rs.9,500.00 via BBPS & the same has been credited to your SBI Credit Card. Your available limit is Rs.90,000.00.";
    for (const sender of ["VM-SBICRD-S", "SIP:SBI_CARDS_AND_PAYMENT_SERVICES_TEST@RBM.GOOG"]) {
      const r = tryParseWithRules(sender, text);
      expect(r).toMatchObject({ amount: 9500, txnType: "credit", channel: "card" });
      expect(categoryForTxnType(r!.txnType, r!.channel, r!.merchant, cat, r!.refund)).toBe("transfer");
    }
  });

  it("existing Kotak sent rule still wins for KOTAKB", () => {
    const r = tryParseWithRules("AD-KOTAKB-S", "Sent Rs.150.00 from Kotak Bank AC X1234 to test.shop@ybl on 03-07-25.UPI Ref 512345678901. Not you, https://kotak.com/KBANKT/Fraud");
    expect(r).toMatchObject({ amount: 150, merchant: "test.shop@ybl", txnType: "debit", refund: false });
  });
});
