import { describe, it, expect } from "vitest";
import { extractPaymentApp } from "../src/modules/sms/smsRules";

describe("extractPaymentApp", () => {
  it("recognizes a Paytm VPA handle", () => {
    const sms = "Sent Rs.500.00 from Paytm Bank A/c to merchantname@paytm on 21-08-26. UPI Ref 123456789012.";
    expect(extractPaymentApp(sms)).toBe("Paytm");
  });

  it("recognizes PhonePe's @ybl handle", () => {
    const sms = "Rs.250 paid to 9876543210@ybl via UPI from A/c XX1234 on 21-08-26.";
    expect(extractPaymentApp(sms)).toBe("PhonePe");
  });

  it("recognizes PhonePe's @ibl and @axl backup handles", () => {
    expect(extractPaymentApp("paid to merchant@ibl")).toBe("PhonePe");
    expect(extractPaymentApp("paid to merchant@axl")).toBe("PhonePe");
  });

  it("recognizes Google Pay's @okhdfcbank / @okicici / @okaxis / @oksbi handles", () => {
    expect(extractPaymentApp("paid to shop@okhdfcbank")).toBe("Google Pay");
    expect(extractPaymentApp("paid to shop@okicici")).toBe("Google Pay");
    expect(extractPaymentApp("paid to shop@okaxis")).toBe("Google Pay");
    expect(extractPaymentApp("paid to shop@oksbi")).toBe("Google Pay");
  });

  it("recognizes Amazon Pay's @apl handle", () => {
    expect(extractPaymentApp("paid to amazon@apl")).toBe("Amazon Pay");
  });

  it("recognizes Jupiter's @jupiteraxis handle", () => {
    expect(extractPaymentApp("paid to friend@jupiteraxis")).toBe("Jupiter");
  });

  it("is case-insensitive on the handle", () => {
    expect(extractPaymentApp("paid to shop@PAYTM")).toBe("Paytm");
  });

  it("returns null for a VPA with an unrecognized handle rather than guessing", () => {
    expect(extractPaymentApp("paid to shop@somebank")).toBeNull();
  });

  it("returns null when the SMS has no VPA at all (e.g. a plain card transaction)", () => {
    const sms = "Spent Rs.1300 On HDFC Bank Card 5848 At SWIGGY . On 2025-09-17:21:08:13.Not You?";
    expect(extractPaymentApp(sms)).toBeNull();
  });

  it("does not misfire on a real email address in the SMS", () => {
    expect(extractPaymentApp("Contact support@hdfcbank.com for help")).toBeNull();
  });
});
