import { describe, it, expect } from "vitest";
import { tryParseWithRules, categoryForTxnType } from "../src/modules/sms/smsRules";

// Mirrors android SmsRulesTransfersCardsTest — message shapes that were unparsed or mis-filed in a
// real ~17k SMS export (texts anonymised). KEEP IN SYNC with SmsRules.kt.
const cat = (r: NonNullable<ReturnType<typeof tryParseWithRules>>) =>
  categoryForTxnType(r.txnType, r.channel, r.merchant, () => null, r.refund, r.category);

describe("tryParseWithRules — transfers, cards and FASTag", () => {
  it("HDFC IMPS to an account number is a transfer", () => {
    const r = tryParseWithRules("CP-HDFCBK", "IMPS INR 1,00,000.00\nsent from HDFC Bank A/c XX1111 on 30-03-25\nTo A/c xxxxxx2222\nRef-508901320655\nNot you?Call 18002586161")!;
    expect(r.amount).toBe(100000);
    expect(r.merchant).toBe("IMPS to A/c ••2222");
    expect(cat(r)).toBe("transfer");
  });

  it("HDFC online-banking transfer and IMPS-info debit are transfers", () => {
    expect(cat(tryParseWithRules("JD-HDFCBK", "Amt Deducted!\nRs.30000 from your HDFC Bank A/c XX1111 for Money Transfer via HDFC Bank Online Banking.")!)).toBe("transfer");
    const info = tryParseWithRules("JM-HDFCBK-S", "UPDATE: INR 5,500.00 debited from HDFC Bank XX1111 on 15-SEP-25. Info: IMPS-525723965911-SOME PERSON-HDFC-xxxxxxxxxx3562-. Avl bal:INR 168.32")!;
    expect(info.merchant).toBe("SOME PERSON");
    expect(cat(info)).toBe("transfer");
  });

  it("HDFC Received IMPS credit names the remitter; null falls back", () => {
    const r = tryParseWithRules("JM-HDFCBK-S", "Received!\nINR 9,550.00 in HDFC Bank A/c xx1111\nOn 25-08-25\nFor IMPS -ACME PAYMENTS ES- 523721898668\nAvl bal INR 73,977.32")!;
    expect(r.txnType).toBe("credit");
    expect(r.merchant).toBe("ACME PAYMENTS ES");
    expect(tryParseWithRules("JM-HDFCBK-S", "Received!\nINR 13,000.00 in HDFC Bank A/c XX1111\nOn 10-09-25\nFor IMPS -null- 525314984422\nAvl bal INR 1")!.merchant).toBe("HDFC Bank credit");
  });

  it("HDFC loan EMI names the loan; an ACH to a bank is an EMI, to a fund house is not", () => {
    const emi = tryParseWithRules("JM-HDFCBK-S", "UPDATE: INR 63,127.00 debited from HDFC Bank XX1111 on 07-SEP-26. Info: EMI 467841402 Chq S4678414020061 0926467841402. Avl bal:INR 1,206.08")!;
    expect(emi.merchant).toBe("HDFC Bank loan ••1402");
    expect(cat(emi)).toBe("emi");
    const ach = tryParseWithRules("JM-HDFCBK-S", "UPDATE: INR 35,784.00 debited from HDFC Bank XX1111 on 10-FEB-26. Info: ACH D- UNION BANK OF INDIA-A2Q3531831744. Avl bal:INR 5,248.47")!;
    expect(ach.merchant).toBe("UNION BANK OF INDIA");
    expect(cat(ach)).toBe("emi");
    const sip = tryParseWithRules("JM-HDFCBK-S", "UPDATE: INR 5,000.00 debited from HDFC Bank XX1111 on 10-FEB-26. Info: ACH D- ACME MUTUAL FUND-A2Q3531831744. Avl bal:INR 5,248.47")!;
    expect(sip.merchant).toBe("ACME MUTUAL FUND");
    expect(sip.category).toBeNull();
  });

  it("HDFC ATM withdrawal and Smart Pay bill", () => {
    expect(tryParseWithRules("AD-HDFCBK-S", "Withdrawn Rs.20000 From HDFC Bank Card x1234 At +SOME BR On 2026-09-05:13:00:30 Bal Rs.286333.08")!.merchant).toBe("Cash withdrawal");
    expect(tryParseWithRules("JD-HDFCBK", "Dear Smart Pay Customer,We have successfully debited your HDFC Bank Credit card ending 1234 to pay your SpayBBPS  17068 bill for the amount Rs 1080")!.amount).toBe(1080);
  });

  it("Edge CSB credit-card swipes and UPI-on-card are card spend", () => {
    const swipe = tryParseWithRules("AD-JTEDGE", "₹7543.06 paid from your Edge CSB Bank RuPay Credit Card to Avenue Supermarts Ltd PUNE MHIN on 2025-04-01 08:09. To raise an issue, call 8655055086.")!;
    expect(swipe.merchant).toBe("Avenue Supermarts Ltd");
    expect(swipe.channel).toBe("card");
    expect(tryParseWithRules("TM-JTEDGE", "Rs 140.00 debited to your Edge CSB RuPay Credit Card ending 1234 on 2/7/25, 10:08 PM - (UPI Ref no. 503871825778).")!.channel).toBe("card");
  });

  it("IDBI FASTag parking and tolls are tolls; FASTag recharge is a transfer", () => {
    const p = tryParseWithRules("JD-WLIDBI-S", "Dear Customer, Your IDBI BANK NETC FASTag linked vehicle no. MH00AA0000, has been debited with Rs. 80/- at Phoenix Marketcity on 25-02-2026 22:20:17 for entry at 25-02-2026 20:45:39.")!;
    expect(p.merchant).toBe("Phoenix Marketcity");
    expect(cat(p)).toBe("tolls");
    expect(tryParseWithRules("JM-WLIDBI-T", "Rs.240 toll debited for VRN-XX0000 on 02-08-26 at 12:17 at Talegaon Toll Plaza .Toll Bal : Rs.743.")!.merchant).toBe("Talegaon Toll Plaza");
    expect(cat(tryParseWithRules("BP-IDFCFB-S", "Dear Customer, IDFC FIRST Bank FASTag on MH00AA0000 credited with Rs.1000.0 on 10/02/2026 15:57 via online payment. Ref:605975638561562100")!)).toBe("transfer");
  });

  it("a generic credit needs a bank account or a card", () => {
    expect(tryParseWithRules("BH-VAAHAN-G", "Received Rs.313317/- against new registration fee vide receipt no MH00X0000 . MoRTH.")).toBeNull();
    expect(tryParseWithRules("JD-MLKBKT-S", "Dear Customer, your top-up was successful! Your account has been credited with Rs. 1000.0 on 2025-11-13 16:29:40.")).toBeNull();
    const card = tryParseWithRules("AX-KOTAKB-S", "Payment of INR 15567 is credited to your Kotak Bank Credit Card x9124 on 05-OCT-2026. Available Credit limit is INR 221005.12.")!;
    expect(card.channel).toBe("card");
    expect(cat(card)).toBe("transfer");
    expect(cat(tryParseWithRules("VM-IOBCHN-S", "Rs 45,000.00 credited to A/c XX9900 from ACME PAYROLL on 01-09-25")!)).toBe("income");
  });
});
