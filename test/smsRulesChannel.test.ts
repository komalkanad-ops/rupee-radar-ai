import { describe, it, expect } from "vitest";
import { tryParseWithRules } from "../src/modules/sms/smsRules";

// Verifies payment-channel classification against a representative real sample per bank/pattern —
// channel is inferred from which rule matched, so a wrong classification here means the wrong
// bar in the Spend Breakdown screen's payment-method chart.
describe("tryParseWithRules — payment channel classification", () => {
  it("classifies HDFC card spend as card", () => {
    const r = tryParseWithRules("JM-HDFCBK-S", "Spent Rs.1300 On HDFC Bank Card 5848 At _PRO LIFE CHEMIST . On 2025-09-17:21:08:13.Not You?");
    expect(r?.channel).toBe("card");
  });

  it("classifies HDFC loan EMI debit as bank_transfer", () => {
    const r = tryParseWithRules("JM-HDFCBK-S", "UPDATE: INR 32,362.00 debited from HDFC Bank XX9115 on 06-JUL-25. Info: EMI 155653270 Chq S155653270110 0725155653270. Avl bal:INR 48,320.26");
    expect(r?.channel).toBe("bank_transfer");
  });

  it("classifies ICICI card spend as card", () => {
    const r = tryParseWithRules("JD-ICICIT-S", "INR 2,204.00 spent using ICICI Bank Card XX0005 on 21-Jun-25 on IND*Amazon. Avl Limit: INR 59,140.48.");
    expect(r?.channel).toBe("card");
  });

  it("classifies Kotak 'Sent Rs...to' as upi", () => {
    const r = tryParseWithRules("AD-KOTAKB-S", "Sent Rs.150.00 from Kotak Bank AC X5599 to ghanasham.25-2@okicici on 03-07-25.UPI Ref 555022317709. Not you, https://kotak.com/KBANKT/Fraud");
    expect(r?.channel).toBe("upi");
  });

  it("classifies Kotak NACH auto-debit as bank_transfer", () => {
    const r = tryParseWithRules("AD-KOTAKB-S", "INR 26,312.00 is debited to your Account XXXXXX5599 on 03/10/2025 towards NACH-10-NEWTAPFINANCEPRIVAT Kotak Bank");
    expect(r?.channel).toBe("bank_transfer");
  });

  it("classifies Kotak debit-card withdrawal as card", () => {
    const r = tryParseWithRules("AD-KOTAKB-S", "You've withdrawn Rs8000.00 thru Kotak Bank Debit Card XX7694 on 01/01/2026 at ATM. Avl Bal Rs1000.00");
    expect(r?.channel).toBe("card");
  });

  it("classifies IndusInd generic A/C debit as bank_transfer", () => {
    const r = tryParseWithRules("VM-INDUSB-S", "INR 990.00 debited from your A/C XX0947 towards NEFT. Avl Lmt: INR 10,000");
    expect(r?.channel).toBe("bank_transfer");
  });

  it("classifies IndusInd card spend as card", () => {
    const r = tryParseWithRules("VM-INDUSB-S", "INR 327.00 spent on IndusInd Card XX0947 on 08-12-2025 03:14:59 pm at UPI PRO LIFE CHEMIST. Avl Lmt: INR 11,935.93.");
    expect(r?.channel).toBe("card");
  });

  it("classifies Pluxee meal-wallet spend as wallet", () => {
    const r = tryParseWithRules("JX-PLUXEE-S", "Rs. 115.50 spent from Pluxee  Meal wallet, card no.xx0505 on 21-05-2025 14:11:22 at TOBOX VENTU . Avl bal Rs.4493.94. Not you call 18002106919");
    expect(r?.channel).toBe("wallet");
  });

  it("classifies IDFC FIRST FASTag recharge as wallet", () => {
    const r = tryParseWithRules("VM-IDFCFB-S", "FASTag account credited with Rs.500.00 Ref 12345 on 01-01-2026");
    expect(r?.channel).toBe("wallet");
  });

  it("classifies SBI transfer as bank_transfer", () => {
    const r = tryParseWithRules("AD-CBSSBI-S", "A/C X1234 Debited INR 5000.00 on 01/01/26 -Transferred to JOHN DOE. Avl Balance INR 10000.00");
    expect(r?.channel).toBe("bank_transfer");
  });
});
