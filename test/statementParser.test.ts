import { describe, it, expect } from "vitest";
import {
  detectHiddenFees, extractTransactionsFromText, extractTransactionsFromCsv, detectStatementKind, statementPeriod,
} from "../src/modules/statements/statementParser.js";

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

// Synthetic lines shaped like real statements' pdf-parse output (no real data).
describe("extractTransactionsFromText — bank account statements", () => {
  const text = [
    "Savings Account Statement",
    "Date Narration Withdrawal (Dr.) Deposit (Cr.) Balance",
    "Opening Balance 10,000.00",
    "1 01 Mar 2026 UPI/SOME CAFE/123456789012/UPI",
    "UPI-123456789012 250.00 9,750.00",
    "2 02 Mar 2026 Recd:IMPS/123456789012/EMPLOYER",
    "IMPS-123456789012 50,000.00 59,750.00",
    "3 05 Mar 2026 UPI/GROCER/123456789012/Payment from Phone UPI-123456789012 1,200.50 58,549.50",
    "Closing Balance 58,549.50",
  ].join("\n");

  it("reads rows that wrap onto the next line, and tells credit from debit by the balance", () => {
    expect(detectStatementKind(text)).toBe("account");
    const tx = extractTransactionsFromText(text);
    expect(tx).toEqual([
      { date: "2026-03-01", description: "UPI/SOME CAFE/123456789012/UPI UPI-123456789012", amount: 250, type: "debit" },
      { date: "2026-03-02", description: "Recd:IMPS/123456789012/EMPLOYER IMPS-123456789012", amount: 50000, type: "credit" },
      { date: "2026-03-05", description: "UPI/GROCER/123456789012/Payment from Phone UPI-123456789012", amount: 1200.5, type: "debit" },
    ]);
  });
});

describe("extractTransactionsFromText — credit card statements", () => {
  it("reads the last amount, with Cr / '+' / payment wording as money in", () => {
    const text = [
      "Credit Card Statement",
      "Statement Period 01/03/2026 to 31/03/2026",
      "Total Amount Due 5,000.00",
      "03/03/2026| 14:05 SWIGGY BANGALORE C 450.00 l",
      "04/03/2026| 09:10 REFUND AMAZON + C 1,299.00 l",
      "05/03/2026 FLIPKART PAYMENTS 2,499.00 Dr",
      "06/03/2026 PAYMENT RECEIVED - BBPS 10,000.00",
      "07/03/2026 CASHBACK CREDIT 50.00 Cr",
      "15-Dec-25 Purchase of Groceries ₹ 2000",
      "Minimum Amount Due 250.00",
    ].join("\n");
    expect(detectStatementKind(text)).toBe("card");
    const tx = extractTransactionsFromText(text);
    expect(tx.map((t) => [t.date, t.amount, t.type])).toEqual([
      ["2026-03-03", 450, "debit"],
      ["2026-03-04", 1299, "credit"],
      ["2026-03-05", 2499, "debit"],
      ["2026-03-06", 10000, "credit"],
      ["2026-03-07", 50, "credit"],
    ]);
    expect(tx[0].description).toBe("SWIGGY BANGALORE");
  });

  it("takes an amount from the next line when the dated line has none", () => {
    const text = "Credit Card Statement\n12 Mar 26\n15:30 12 Mar 26 NETFLIX.COM MUMBAI\n649.00\n13 Mar 26 UBER INDIA 312.40";
    const tx = extractTransactionsFromText(text);
    expect(tx).toEqual([
      { date: "2026-03-12", description: "NETFLIX.COM MUMBAI", amount: 649, type: "debit" },
      { date: "2026-03-13", description: "UBER INDIA", amount: 312.4, type: "debit" },
    ]);
  });

  it("ignores summary lines that happen to start with a date", () => {
    const text = "Credit Card Statement\n10/03/2026 Statement Date Total Amount Due : ₹ 12,345.67\n11/03/2026 ZOMATO 300.00";
    expect(extractTransactionsFromText(text).map((t) => t.amount)).toEqual([300]);
  });

  it("rejects impossible dates", () => {
    expect(extractTransactionsFromText("Credit Card Statement\n31/02/2026 SOMETHING 100.00")).toEqual([]);
  });
});

describe("statementPeriod", () => {
  it("reads numeric and month-name periods", () => {
    expect(statementPeriod("Statement Period 01-03-2026 to 31-03-2026")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(statementPeriod("Billing Period: 15 Feb 2026 - 14 Mar 2026")).toEqual({ from: "2026-02-15", to: "2026-03-14" });
    expect(statementPeriod("no period here")).toBeNull();
  });
});

describe("extractTransactionsFromCsv", () => {
  it("keeps quoted amounts with commas intact", () => {
    const csv = 'Date,Description,Debit,Credit\n01/03/2026,"RENT, MARCH","25,000.00",\n02/03/2026,SALARY,,"80,000.00"';
    expect(extractTransactionsFromCsv(csv)).toEqual([
      { date: "2026-03-01", description: "RENT, MARCH", amount: 25000, type: "debit" },
      { date: "2026-03-02", description: "SALARY", amount: 80000, type: "credit" },
    ]);
  });
});
