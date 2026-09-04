import { describe, it, expect } from "vitest";
import { detectHiddenFees } from "../src/modules/statements/statementParser.js";

describe("detectHiddenFees", () => {
  it("flags a finance charge line with its rupee amount", () => {
    const text = "Statement Summary\nFinance Charge 458.20\nTotal Due 12,450.00";
    const fees = detectHiddenFees(text);
    expect(fees).toContainEqual({ type: "finance_charge", description: "Finance Charge 458.20", amountInr: 458.2 });
  });

  it("flags a late payment fee", () => {
    const fees = detectHiddenFees("Late Payment Fee: Rs. 750.00 applied on 12/03/2026");
    expect(fees[0].type).toBe("late_payment");
    expect(fees[0].amountInr).toBe(750);
  });

  it("flags GST on charges", () => {
    const fees = detectHiddenFees("IGST @18% 82.48");
    expect(fees.some((f) => f.type === "gst")).toBe(true);
  });

  it("flags forex markup wording", () => {
    const fees = detectHiddenFees("Cross-Currency Markup Fee 199.00");
    expect(fees[0].type).toBe("forex_markup");
    expect(fees[0].amountInr).toBe(199);
  });

  it("flags an APR mention with a nearby percentage, captures no rupee amount", () => {
    const fees = detectHiddenFees("Annual Percentage Rate (APR) applicable: 42.00% per annum");
    expect(fees[0].type).toBe("apr");
    expect(fees[0].amountInr).toBeNull();
  });

  it("does not flag a bare 'apr' mention with no percentage nearby", () => {
    const fees = detectHiddenFees("Payment received in April, thank you.");
    expect(fees).toHaveLength(0);
  });

  it("returns an empty array for a clean statement with no fee lines", () => {
    const fees = detectHiddenFees("Swiggy 450.00\nAmazon 1200.00\nTotal Due 1650.00");
    expect(fees).toHaveLength(0);
  });

  it("only matches once per line even if multiple keywords could apply", () => {
    const fees = detectHiddenFees("Finance Charge (incl. GST) 500.00");
    expect(fees).toHaveLength(1);
  });
});
