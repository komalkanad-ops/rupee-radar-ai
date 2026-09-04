// Seeds synthetic peer-benchmarking data (CityIncomeBracketBenchmark) — plausible modeled spend-mix
// percentages across major Indian cities x income brackets x categories, NOT real aggregated user
// data. Every /benchmarks/compare response marks this isSynthetic: true so it's never presented as
// real. Run manually after a deploy (`npm run seed:benchmarks`), not on every boot — idempotent via
// upsert on the (city, incomeBracket, category) unique key.
import { prisma } from "../src/lib/prisma.js";

const CITIES = ["Mumbai", "Delhi", "Bengaluru", "Pune", "Hyderabad", "Chennai"];
// Extended upward at the user's request (2026-08-28) — the original four brackets stay (a
// meaningful share of users are still below 20L), with four new finer brackets added above them.
// These must exactly match ProfileScreen.kt's INCOME_BRACKETS on the Android side, since the two
// are joined by this exact string value (Profile's incomeBracket -> CityIncomeBracketBenchmark.
// incomeBracket), not an enum.
const INCOME_BRACKETS = ["<5L", "5-10L", "10-20L", "20-40L", "40-60L", "60-75L", "75L-1Cr", "1Cr+"];

// Baseline category spend-mix (% of total non-essential-adjacent spend), tuned per income bracket —
// higher brackets skew more toward dining/travel/shopping, less toward groceries/fuel as a share of
// total. City is currently just a light multiplier on dining/entertainment (metro dining culture) —
// deliberately simple, this is placeholder data, not a real economic model.
const BASE_MIX: Record<string, Record<string, number>> = {
  "<5L": { dining: 12, groceries: 30, shopping: 15, entertainment: 8, travel: 10, fuel: 25 },
  "5-10L": { dining: 16, groceries: 26, shopping: 18, entertainment: 10, travel: 13, fuel: 17 },
  "10-20L": { dining: 20, groceries: 20, shopping: 22, entertainment: 12, travel: 16, fuel: 10 },
  "20-40L": { dining: 26, groceries: 12, shopping: 28, entertainment: 15, travel: 20, fuel: 3.5 },
  "40-60L": { dining: 28, groceries: 10, shopping: 30, entertainment: 16, travel: 22, fuel: 3 },
  "60-75L": { dining: 30, groceries: 8, shopping: 32, entertainment: 17, travel: 25, fuel: 2.5 },
  "75L-1Cr": { dining: 32, groceries: 7, shopping: 34, entertainment: 18, travel: 28, fuel: 2 },
  "1Cr+": { dining: 35, groceries: 6, shopping: 36, entertainment: 20, travel: 32, fuel: 1.5 },
};

const METRO_DINING_MULTIPLIER: Record<string, number> = {
  Mumbai: 1.15,
  Delhi: 1.1,
  Bengaluru: 1.2,
  Pune: 1.05,
  Hyderabad: 1.0,
  Chennai: 1.0,
};

async function main() {
  const rows: { city: string; incomeBracket: string; category: string; avgSpendPct: number }[] = [];

  for (const city of CITIES) {
    for (const bracket of INCOME_BRACKETS) {
      const mix = BASE_MIX[bracket];
      for (const [category, pct] of Object.entries(mix)) {
        const adjusted = category === "dining" ? pct * (METRO_DINING_MULTIPLIER[city] ?? 1) : pct;
        rows.push({ city, incomeBracket: bracket, category, avgSpendPct: Math.round(adjusted * 10) / 10 });
      }
    }
  }

  for (const row of rows) {
    await prisma.cityIncomeBracketBenchmark.upsert({
      where: { city_incomeBracket_category: { city: row.city, incomeBracket: row.incomeBracket, category: row.category } },
      create: row,
      update: { avgSpendPct: row.avgSpendPct },
    });
  }

  console.log(`Seeded ${rows.length} synthetic benchmark rows across ${CITIES.length} cities x ${INCOME_BRACKETS.length} income brackets.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
