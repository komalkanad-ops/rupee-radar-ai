// Seeds the Challenge/Badge/SubscriptionProvider catalogs — all three have been empty in
// production since the features that read them shipped (Sessions 2-3), a known gap tracked in
// CLAUDE.md ever since. Deliberately does NOT seed MerchantOffer: that model represents specific
// bank promotional offers (a real discount %, a real validity window) presented to end users as
// live, actionable data — fabricating plausible-looking numbers there would mean showing users
// promotions that aren't real, a materially different risk from Challenges/Badges/
// SubscriptionProvider (which are genuinely just app mechanics/well-known public URLs, not
// financial claims). Seed MerchantOffer separately once real bank-offer data is sourced.
//
// Idempotent via upsert on each model's unique key (Challenge.key, Badge.key,
// SubscriptionProvider has no unique key so it upserts on merchantPattern instead via a manual
// find-then-create/update). Run with `npm run seed:challenges`.
import { prisma } from "../src/lib/prisma.js";

async function seedChallenges() {
  const challenges = [
    {
      key: "no-spend-weekend",
      title: "No-Spend Weekend",
      description: "Avoid all discretionary spending (dining, shopping, entertainment) for one full weekend.",
      type: "NO_SPEND_WEEKEND" as const,
      targetAmount: null,
      durationDays: 2,
      active: true,
    },
    {
      key: "save-2000-week",
      title: "Save ₹2,000 This Week",
      description: "Spend at least ₹2,000 less than your usual weekly average.",
      type: "SAVE_AMOUNT" as const,
      targetAmount: 2000,
      durationDays: 7,
      active: true,
    },
    {
      key: "save-5000-month",
      title: "Save ₹5,000 This Month",
      description: "Spend at least ₹5,000 less than your usual monthly average.",
      type: "SAVE_AMOUNT" as const,
      targetAmount: 5000,
      durationDays: 30,
      active: true,
    },
  ];

  for (const c of challenges) {
    await prisma.challenge.upsert({ where: { key: c.key }, create: c, update: c });
  }
  console.log(`Seeded ${challenges.length} challenges.`);
}

async function seedBadges() {
  // Badge.key matches the Challenge.key it's awarded for (challengesRouter.ts's
  // awardBadgeIfAny looks up a badge by the completed challenge's key) — every badge here is
  // genuinely awardable, not decorative.
  const badges = [
    { key: "no-spend-weekend", title: "Frugal Weekend", iconKey: "weekend_savings" },
    { key: "save-2000-week", title: "Weekly Saver", iconKey: "piggy_bank" },
    { key: "save-5000-month", title: "Monthly Saver", iconKey: "trophy" },
  ];

  for (const b of badges) {
    await prisma.badge.upsert({ where: { key: b.key }, create: b, update: b });
  }
  console.log(`Seeded ${badges.length} badges.`);
}

async function seedSubscriptionProviders() {
  // Real, well-known account-management/cancel pages for the same brands MerchantCategorizer's
  // taxonomy already recognizes — public URLs, not fabricated data.
  const providers = [
    { merchantPattern: "netflix", providerName: "Netflix", cancelUrl: "https://www.netflix.com/cancelplan", downgradeUrl: "https://www.netflix.com/changeplan" },
    { merchantPattern: "amazon prime", providerName: "Amazon Prime", cancelUrl: "https://www.amazon.in/gp/primecentral", downgradeUrl: null },
    { merchantPattern: "spotify", providerName: "Spotify", cancelUrl: "https://www.spotify.com/in-en/account/subscription/", downgradeUrl: "https://www.spotify.com/in-en/account/subscription/" },
    { merchantPattern: "hotstar", providerName: "Disney+ Hotstar", cancelUrl: "https://www.hotstar.com/in/subscription", downgradeUrl: null },
    { merchantPattern: "jiocinema", providerName: "JioCinema", cancelUrl: "https://www.jiocinema.com/subscriptions", downgradeUrl: null },
    { merchantPattern: "zee5", providerName: "ZEE5", cancelUrl: "https://www.zee5.com/subscription", downgradeUrl: null },
    { merchantPattern: "sonyliv", providerName: "SonyLIV", cancelUrl: "https://www.sonyliv.com/subscribe", downgradeUrl: null },
    { merchantPattern: "youtube premium", providerName: "YouTube Premium", cancelUrl: "https://www.youtube.com/paid_memberships", downgradeUrl: null },
    { merchantPattern: "youtube music", providerName: "YouTube Music Premium", cancelUrl: "https://www.youtube.com/paid_memberships", downgradeUrl: null },
  ];

  for (const p of providers) {
    const existing = await prisma.subscriptionProvider.findFirst({ where: { merchantPattern: p.merchantPattern } });
    if (existing) {
      await prisma.subscriptionProvider.update({ where: { id: existing.id }, data: p });
    } else {
      await prisma.subscriptionProvider.create({ data: p });
    }
  }
  console.log(`Seeded ${providers.length} subscription providers.`);
}

async function main() {
  await seedChallenges();
  await seedBadges();
  await seedSubscriptionProviders();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
