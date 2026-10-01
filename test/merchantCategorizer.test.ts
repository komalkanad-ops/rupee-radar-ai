import { describe, expect, it } from "vitest";
import { categorizeMerchant } from "../src/modules/categorization/merchantCategorizer.js";

// Mirror of the Android MerchantCategorizerTest case: legal/parent entity names -> consumer brand category.
describe("merchantCategorizer learned aliases", () => {
  it.each([
    ["JUBILANT FOODWORKS LTD", "dining"],
    ["INNOVATIVE RETAIL CONCEPTS PVT LTD", "groceries"],
    ["BLINK COMMERCE PRIVATE LIMITED", "groceries"],
    ["KIRANAKART TECHNOLOGIES", "groceries"],
    ["BUNDL TECHNOLOGIES PVT LTD", "dining"],
    ["HARDCASTLE RESTAURANTS", "dining"],
    ["ANI TECHNOLOGIES PVT LTD", "transport"],
    ["FSN E-COMMERCE VENTURES", "shopping"],
    ["BIGTREE ENTERTAINMENT", "entertainment"],
    ["MSEDC ELECTRICITY BILL", "utilities"],
    ["INTERGLOBE AVIATION", "travel"],
    ["API HOLDINGS LIMITED", "medical"],
    ["TOLL", "tolls"],
    ["UDAY FUEL SERVICES", "fuel"],
    ["NHAI TOLL PLAZA", "tolls"],
    ["INDIAN OIL PETROL PUMP", "fuel"],
  ])("%s -> %s", (merchant, category) => {
    expect(categorizeMerchant(merchant)).toBe(category);
  });
});

// Mirror of the Android MerchantCategorizerTest case: the old bare "vi " keyword matched inside "Ravi Kumar".
describe("merchantCategorizer Vodafone Vi keyword", () => {
  it("does not file a person named Ravi as a Vi utility bill", () => {
    expect(categorizeMerchant("RAVI KUMAR")).toBeNull();
    expect(categorizeMerchant("Kavi Shah")).toBeNull();
    expect(categorizeMerchant("Vi Prepaid Recharge")).toBe("utilities");
  });
});
