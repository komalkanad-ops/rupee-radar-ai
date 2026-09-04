import { describe, it, expect } from "vitest";
import { extractAvailableBalance } from "../src/modules/sms/smsRules";

describe("extractAvailableBalance", () => {
  it("extracts HDFC's 'Avl bal:INR' phrasing", () => {
    const sms =
      "UPDATE: INR 32,362.00 debited from HDFC Bank XX9115 on 06-JUL-25. Info: EMI 155653270 Chq S155653270110 0725155653270. Avl bal:INR 48,320.26";
    expect(extractAvailableBalance(sms)).toBe(48320.26);
  });

  it("extracts Kotak's 'Avl Bal Rs' phrasing", () => {
    const sms = "You've withdrawn Rs8000.00 thru Kotak Bank Debit Card XX7694 on 01/01/2026 at ATM. Avl Bal Rs1000.00";
    expect(extractAvailableBalance(sms)).toBe(1000);
  });

  it("extracts SBI's 'Avl Balance INR' phrasing", () => {
    const sms = "A/C X1234 Debited INR 5000.00 on 01/01/26 -Transferred to JOHN DOE. Avl Balance INR 10000.00";
    expect(extractAvailableBalance(sms)).toBe(10000);
  });

  it("extracts Pluxee's 'Avl bal Rs.' phrasing (meal wallet, not a bank account)", () => {
    const sms = "Rs. 115.50 spent from Pluxee  Meal wallet, card no.xx0505 on 21-05-2025 14:11:22 at TOBOX VENTU . Avl bal Rs.4493.94. Not you call 18002106919";
    expect(extractAvailableBalance(sms)).toBe(4493.94);
  });

  it("does NOT match 'Avl Limit'/'Avl Lmt' — a credit limit, not the actual current balance", () => {
    const sms = "INR 2,204.00 spent using ICICI Bank Card XX0005 on 21-Jun-25 on IND*Amazon. Avl Limit: INR 59,140.48.";
    expect(extractAvailableBalance(sms)).toBeNull();
  });

  it("returns null when the SMS has no balance phrasing at all", () => {
    const sms = "Spent Rs.1300 On HDFC Bank Card 5848 At SWIGGY . On 2025-09-17:21:08:13.Not You?";
    expect(extractAvailableBalance(sms)).toBeNull();
  });
});
