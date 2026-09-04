// Registers every existing screen as a FeatureFlag row (all LIVE) so the admin console has a
// full, immediately-usable list to control from day one, instead of an empty list admins would
// have to populate by typing route keys blind. `key` is each screen's real Android nav route (see
// Screen.<X>.route in RupeeRadarNavHost.kt) — reusing the identifier that already exists rather
// than inventing a parallel naming scheme. Idempotent via upsert on key. Run with
// `npm run seed:feature-flags`.
import { prisma } from "../src/lib/prisma.js";

async function seedFeatureFlags() {
  const flags = [
    { key: "expenses", displayName: "Add Expense" },
    { key: "recurring", displayName: "Bills & Subscriptions" },
    { key: "loans", displayName: "Loan & EMI" },
    { key: "lending", displayName: "Lending" },
    { key: "networth", displayName: "Net Worth" },
    { key: "insights", displayName: "Insights" },
    { key: "budgets", displayName: "Budgets" },
    { key: "financial-review", displayName: "Financial Review" },
    { key: "safety-net", displayName: "Safety Net" },
    { key: "money-leaks", displayName: "Money Leaks" },
    { key: "goals", displayName: "Goals" },
    { key: "debt-freedom", displayName: "Debt Freedom" },
    { key: "spending-habits", displayName: "Spending Habits" },
    { key: "cashflow", displayName: "Cash Flow" },
    { key: "statement-analyzer", displayName: "Statement Analyzer" },
    { key: "credit-score", displayName: "Credit Score" },
    { key: "tax", displayName: "Tax Nudges" },
    { key: "household", displayName: "Family Vault" },
    { key: "benchmark", displayName: "Peer Comparison" },
    { key: "bank-link", displayName: "Link Bank" },
    { key: "bank-balances", displayName: "Bank Balances" },
    { key: "rewards", displayName: "Rewards" },
    { key: "offers", displayName: "Offers" },
    { key: "challenges", displayName: "Challenges" },
    { key: "wallet", displayName: "Wallet" },
    { key: "nearby", displayName: "Nearby" },
    { key: "mall-mode", displayName: "Mall Mode" },
    { key: "pro", displayName: "PRO" },
    { key: "settings", displayName: "Settings" },
    { key: "savings", displayName: "Savings Tracker" },
    { key: "ai_chat", displayName: "AI Assistant" },
    { key: "parking", displayName: "Parking & Tolls" },
    { key: "products", displayName: "Products & Warranty" },
    { key: "wishlist", displayName: "Wishlist" },
  ];

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      create: { key: flag.key, displayName: flag.displayName, status: "LIVE" },
      update: { displayName: flag.displayName },
    });
  }

  console.log(`Seeded ${flags.length} feature flags.`);
}

seedFeatureFlags()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
