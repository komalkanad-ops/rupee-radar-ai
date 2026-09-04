// Loads researched credit-card JSON (backend/seed/data/*.json) into the database.
// Each data file is a flat JSON array of card objects using the snake_case schema described in
// docs/credit-card-research-sources.md. Re-running this script is idempotent: it upserts banks
// by name and cards by (bank name + card name).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

type RawCard = {
  bank: string;
  bank_type: string;
  card_name: string;
  network: string;
  category: string;
  is_cashback_card?: boolean;
  joining_fee_inr?: number;
  annual_fee_inr?: number;
  fee_waiver_condition?: string | null;
  reward_rate?: string | null;
  reward_point_value_est_inr?: number | null;
  welcome_benefits?: string[];
  milestone_benefits?: string[];
  lounge_access?: string | null;
  fuel_surcharge_waiver?: string | null;
  merchant_bonus_categories?: string[];
  eligibility_notes?: string | null;
  source_urls?: string[];
  last_verified_note?: string | null;
};

const VALID_CATEGORIES = new Set([
  "REWARDS", "CASHBACK", "TRAVEL", "FUEL", "LIFESTYLE", "PREMIUM", "BUSINESS", "CO_BRAND",
]);
const VALID_BANK_TYPES = new Set(["PRIVATE", "PSU", "FOREIGN", "NBFC", "FINTECH"]);

async function loadCardFile(path: string) {
  const raw = readFileSync(path, "utf-8");
  let cards: RawCard[];
  try {
    cards = JSON.parse(raw);
  } catch (err) {
    console.error(`  Skipping ${path}: invalid JSON (${(err as Error).message})`);
    return { ok: 0, skipped: 0 };
  }

  let ok = 0;
  let skipped = 0;

  for (const c of cards) {
    if (!c.bank || !c.card_name) {
      skipped++;
      continue;
    }
    const bankType = VALID_BANK_TYPES.has((c.bank_type ?? "").toUpperCase())
      ? (c.bank_type!.toUpperCase() as any)
      : "PRIVATE";
    const category = VALID_CATEGORIES.has((c.category ?? "").toUpperCase())
      ? (c.category!.toUpperCase() as any)
      : "REWARDS";

    const bank = await prisma.bank.upsert({
      where: { name: c.bank },
      create: { name: c.bank, type: bankType },
      update: {},
    });

    const existing = await prisma.creditCard.findFirst({
      where: { bankId: bank.id, name: c.card_name },
    });

    const data = {
      bankId: bank.id,
      name: c.card_name,
      network: c.network ?? "Unknown",
      category,
      isCashbackCard: !!c.is_cashback_card,
      joiningFeeInr: c.joining_fee_inr ?? 0,
      annualFeeInr: c.annual_fee_inr ?? 0,
      feeWaiverCondition: c.fee_waiver_condition ?? null,
      rewardSpendPerPoint: c.reward_rate ?? null,
      rewardPointValueEstInr: c.reward_point_value_est_inr ?? null,
      welcomeBenefits: c.welcome_benefits ?? [],
      milestoneBenefits: c.milestone_benefits ?? [],
      loungeAccess: c.lounge_access ?? null,
      fuelSurchargeWaiver: c.fuel_surcharge_waiver ?? null,
      merchantBonusCategories: c.merchant_bonus_categories ?? [],
      eligibilityNotes: c.eligibility_notes ?? null,
      sourceUrls: c.source_urls ?? [],
      lastVerifiedAt: new Date(),
    };

    if (existing) {
      await prisma.creditCard.update({ where: { id: existing.id }, data });
    } else {
      await prisma.creditCard.create({ data });
    }
    ok++;
  }

  return { ok, skipped };
}

async function loadPortalsFile(path: string) {
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, "utf-8");
  let parsed: { portals?: { name: string; url: string; notes?: string; applicable_banks?: string[] }[] };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`  Skipping ${path}: invalid JSON (${(err as Error).message})`);
    return 0;
  }
  let count = 0;
  for (const p of parsed.portals ?? []) {
    await prisma.redemptionPortal.create({
      data: { name: p.name, url: p.url, notes: p.notes ?? null, applicableBankNames: p.applicable_banks ?? [] },
    });
    count++;
  }
  return count;
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log(`No seed data directory at ${DATA_DIR} yet — run the research step first.`);
    return;
  }

  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  let totalOk = 0;
  let totalSkipped = 0;

  for (const file of files) {
    const path = join(DATA_DIR, file);
    if (file === "redemption-portals.json") {
      const count = await loadPortalsFile(path);
      console.log(`  ${file}: ${count} redemption portals loaded`);
      continue;
    }
    const { ok, skipped } = await loadCardFile(path);
    console.log(`  ${file}: ${ok} cards loaded, ${skipped} skipped`);
    totalOk += ok;
    totalSkipped += skipped;
  }

  console.log(`\nDone. ${totalOk} cards total, ${totalSkipped} skipped.`);

  await seedDefaultAppLinks();
}

// Default admin-editable app links — placeholders until you fill in the real URLs from the admin
// console (Links page). Safe to re-run: only creates keys that don't exist yet.
async function seedDefaultAppLinks() {
  const defaults: { key: string; label: string; url: string; category: string }[] = [
    { key: "play_store", label: "Google Play Store listing", url: "https://play.google.com/store/apps/details?id=com.rupeeradarai.app", category: "app" },
    { key: "website", label: "Rupee Radar AI website", url: "https://rupeeradarai.com", category: "app" },
    { key: "support", label: "Support / contact", url: "https://rupeeradarai.com/support", category: "support" },
    { key: "terms", label: "Terms of Service", url: "https://rupeeradarai.com/terms", category: "legal" },
    { key: "privacy", label: "Privacy Policy", url: "https://rupeeradarai.com/privacy", category: "legal" },
  ];

  let created = 0;
  for (const link of defaults) {
    const existing = await prisma.appLink.findUnique({ where: { key: link.key } });
    if (existing) continue;
    await prisma.appLink.create({ data: link });
    created++;
  }
  console.log(`  app links: ${created} default entries created (edit real URLs in the admin console)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
