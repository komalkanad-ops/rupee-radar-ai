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
  ])("%s -> %s", (merchant, category) => {
    expect(categorizeMerchant(merchant)).toBe(category);
  });
});
