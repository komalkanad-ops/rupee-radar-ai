// One-off seed for the launch-video demo account (see docs/marketing/video/ in the private
// android-app repo). NOT a permanent catalog seed like seedChangelog.ts etc. — creates/reuses a
// single clearly-tagged demo User and backfills 4 months of SmsTransaction / RecurringPayment /
// Budget / Goal / NetWorthSnapshot / UserCreditCard / ProEntitlement data so the real app screens
// (Money Leaks, Safety Net, Health Score, Budgets, Goals, Net Worth, Mall Mode) render genuine,
// internally-consistent numbers to screen-record for compositing — nothing in the video is a
// fabricated on-screen figure.
//
// Run:  DATABASE_URL=<prod> npx tsx seed/seedVideoDemo.ts
//
// The demo account signs in via the phone_custom / LoginBypassEntry path (see authRouter.ts) —
// no SMS gateway needed, the OTP is disclosed in the API response for this allowlisted number.
import { prisma } from "../src/lib/prisma.js";

const DEMO_PHONE = "+919999900001";
const DEMO_NAME = "Priya Demo";

// Real catalog cards for the wallet (Mall Mode / Card Hub) — HDFC Millennia + Cashback SBI Card,
// picked as two everyday-relatable reward cards.
const CARD_ID_MILLENNIA = "cmsxmj5860002i0ld0fapvrz7";
const CARD_ID_CASHBACK_SBI = "cmsxmj9ta003ti0ld509qniue";

function utc(y: number, m0: number, d: number): Date {
  return new Date(Date.UTC(y, m0, d, 10, 0, 0)); // 10:00 UTC so local-date math never rolls it over
}

let hashCounter = 0;
function hash(): string {
  hashCounter += 1;
  return `demo-${Date.now()}-${hashCounter}`;
}

async function main() {
  // --- 1. User + login access -------------------------------------------------------------
  const user = await prisma.user.upsert({
    where: { phone: DEMO_PHONE },
    create: { phone: DEMO_PHONE, name: DEMO_NAME, authProvider: "phone_custom", persona: "SALARIED" },
    update: { name: DEMO_NAME, persona: "SALARIED" },
  });
  await prisma.loginBypassEntry.upsert({
    where: { phone: DEMO_PHONE },
    create: { phone: DEMO_PHONE, enabled: true, note: "Launch-video demo account — see docs/marketing/video/" },
    update: { enabled: true },
  });
  console.log(`User: ${user.id}  (${DEMO_PHONE})`);

  // Wipe any previous run's seeded rows so this script is safely re-runnable.
  await prisma.smsTransaction.deleteMany({ where: { userId: user.id } });
  await prisma.recurringPayment.deleteMany({ where: { userId: user.id } });
  await prisma.budget.deleteMany({ where: { userId: user.id } });
  await prisma.goal.deleteMany({ where: { userId: user.id } });
  await prisma.netWorthSnapshot.deleteMany({ where: { userId: user.id } });
  await prisma.userCreditCard.deleteMany({ where: { userId: user.id } });

  // --- 2. PRO entitlement (Money Leaks / Safety Net / Financial Review are PRO-gated) -------
  await prisma.proEntitlement.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      productId: "video_demo",
      status: "active",
      verifiedAt: new Date(),
      expiryAt: new Date(Date.now() + 365 * 86400_000),
    },
    update: { status: "active", expiryAt: new Date(Date.now() + 365 * 86400_000) },
  });

  // --- 3. Four months of SmsTransaction rows --------------------------------------------
  // Calendar months (UTC), 0-indexed: adjust MONTHS below if you re-run this in a different month.
  const now = new Date();
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth(); // current month
  const MONTHS = [m0 - 3, m0 - 2, m0 - 1, m0]; // oldest -> newest
  // Shopping (Amazon) is the category-creep series: each month >=15% over the last, last 3 in a row.
  const SHOPPING_BY_MONTH = [2000, 2400, 2900, 3500];

  type Txn = { amount: number; merchant: string; category: string; day: number; paymentMethod?: string };
  const rows: Array<Txn & { monthIdx: number }> = [];

  MONTHS.forEach((monthUtcIdx, i) => {
    const monthTxns: Txn[] = [
      // --- essential (~₹20,000/month total — feeds the Safety Net emergency-fund runway) ---
      { amount: 12000, merchant: "Rent Payment", category: "rent", day: 1, paymentMethod: "bank_transfer" },
      { amount: 1250, merchant: "BigBasket", category: "groceries", day: 3, paymentMethod: "upi" },
      { amount: 1250, merchant: "BigBasket", category: "groceries", day: 10, paymentMethod: "upi" },
      { amount: 1250, merchant: "BigBasket", category: "groceries", day: 17, paymentMethod: "upi" },
      { amount: 1250, merchant: "BigBasket", category: "groceries", day: 24, paymentMethod: "upi" },
      { amount: 599, merchant: "Airtel Postpaid", category: "utilities", day: 5, paymentMethod: "upi" },
      { amount: 1401, merchant: "BESCOM Electricity", category: "utilities", day: 12, paymentMethod: "upi" },
      { amount: 1000, merchant: "Indian Oil", category: "fuel", day: 8, paymentMethod: "card" },
      // --- income ---
      { amount: 75000, merchant: "Salary Credit", category: "income", day: 1, paymentMethod: "bank_transfer" },
      // --- discretionary: food (Swiggy/Zomato), ~₹4,000/month, weekend-skewed ---
      { amount: 420, merchant: "Swiggy", category: "food", day: 2, paymentMethod: "upi" },
      { amount: 610, merchant: "Zomato", category: "food", day: 6, paymentMethod: "upi" },
      { amount: 380, merchant: "Swiggy", category: "food", day: 9, paymentMethod: "upi" },
      { amount: 550, merchant: "Swiggy", category: "food", day: 13, paymentMethod: "upi" },
      { amount: 690, merchant: "Zomato", category: "food", day: 14, paymentMethod: "upi" },
      { amount: 340, merchant: "Swiggy", category: "food", day: 20, paymentMethod: "upi" },
      { amount: 480, merchant: "Zomato", category: "food", day: 21, paymentMethod: "upi" },
      { amount: 530, merchant: "Swiggy", category: "food", day: 27, paymentMethod: "upi" },
      // --- discretionary: travel (Uber), ~₹1,520/month ---
      { amount: 190, merchant: "Uber", category: "travel", day: 4, paymentMethod: "upi" },
      { amount: 210, merchant: "Uber", category: "travel", day: 7, paymentMethod: "upi" },
      { amount: 175, merchant: "Uber", category: "travel", day: 15, paymentMethod: "upi" },
      { amount: 195, merchant: "Ola", category: "travel", day: 19, paymentMethod: "upi" },
      { amount: 200, merchant: "Uber", category: "travel", day: 22, paymentMethod: "upi" },
      { amount: 220, merchant: "Uber", category: "travel", day: 26, paymentMethod: "upi" },
      { amount: 165, merchant: "Ola", category: "travel", day: 28, paymentMethod: "upi" },
      { amount: 165, merchant: "Uber", category: "travel", day: 29, paymentMethod: "upi" },
      // --- discretionary: entertainment ---
      { amount: 500, merchant: "BookMyShow", category: "entertainment", day: 18, paymentMethod: "card" },
      // --- discretionary: shopping (Amazon) — the category-creep series ---
      { amount: Math.round(SHOPPING_BY_MONTH[i] * 0.5), merchant: "Amazon", category: "shopping", day: 11, paymentMethod: "card" },
      { amount: Math.round(SHOPPING_BY_MONTH[i] * 0.5), merchant: "Amazon", category: "shopping", day: 23, paymentMethod: "card" },
    ];
    monthTxns.forEach((t) => rows.push({ ...t, monthIdx: monthUtcIdx }));
  });

  // --- 4. The two Money Leaks: a fee + a duplicate charge, in the current month (M0) ---
  const currentMonthRows: Txn[] = [
    { amount: 900, merchant: "HDFC Credit Card Annual Fee", category: "other", day: 6, paymentMethod: "card" },
    { amount: 1700, merchant: "Amazon", category: "shopping", day: 15, paymentMethod: "card" },
    { amount: 1700, merchant: "Amazon", category: "shopping", day: 15, paymentMethod: "card" }, // same merchant+amount+day -> flagged duplicate
  ];
  currentMonthRows.forEach((t) => rows.push({ ...t, monthIdx: m0 }));

  await prisma.smsTransaction.createMany({
    data: rows.map((r) => ({
      userId: user.id,
      rawSmsHash: hash(),
      bankSender: "HDFCBK",
      amount: r.amount,
      merchant: r.merchant,
      category: r.category,
      paymentMethod: r.paymentMethod ?? "upi",
      parsedVia: "regex",
      txnDate: utc(y, r.monthIdx, r.day),
    })),
  });
  console.log(`Seeded ${rows.length} SmsTransaction rows across ${MONTHS.length} months.`);

  // --- 5. Two flagged (unused) subscriptions — the biggest Money Leaks contributor ---------
  const oldDate = utc(y, m0 - 4, 1); // well past the 60-day "forgotten" threshold
  await prisma.recurringPayment.createMany({
    data: [
      {
        userId: user.id,
        type: "SUBSCRIPTION",
        name: "Netflix Premium",
        amount: 599,
        frequency: "monthly",
        nextDueDate: utc(y, m0, 28),
        autoDetected: true,
        usageTag: "NEVER",
        active: true,
        createdAt: oldDate,
      },
      {
        userId: user.id,
        type: "SUBSCRIPTION",
        name: "Fitness Membership",
        amount: 2499,
        frequency: "monthly",
        nextDueDate: utc(y, m0, 5),
        autoDetected: true,
        usageTag: "NEVER",
        active: true,
        createdAt: oldDate,
      },
      // One NOT flagged, so the screen shows a healthy row too, not just red flags.
      {
        userId: user.id,
        type: "SUBSCRIPTION",
        name: "Spotify Premium",
        amount: 119,
        frequency: "monthly",
        nextDueDate: utc(y, m0, 20),
        autoDetected: true,
        usageTag: "OFTEN",
        active: true,
        createdAt: oldDate,
      },
    ],
  });
  console.log("Seeded 3 RecurringPayment (subscription) rows — 2 flagged, 1 healthy.");

  // --- 6. Budget — Food & Dining, ~75% "on track" -----------------------------------------
  await prisma.budget.create({
    data: { userId: user.id, category: "food", monthlyLimitInr: 5300 },
  });

  // --- 7. Goal — Goa trip, 62% funded ------------------------------------------------------
  await prisma.goal.create({
    data: {
      userId: user.id,
      name: "Goa Trip",
      kind: "TRAVEL",
      targetAmountInr: 40000,
      currentAmountInr: 24800,
      targetDate: utc(y, m0 + 3, 15),
      active: true,
    },
  });

  // --- 8. Net Worth — 4 rising monthly snapshots; latest liquid assets = 4 months' runway --
  const NW = [
    { cash: 25000, bank: 45000, investments: 140000 },
    { cash: 27000, bank: 47000, investments: 150000 },
    { cash: 28000, bank: 49000, investments: 165000 },
    { cash: 30000, bank: 50000, investments: 180000 }, // latest: liquid = 80,000 -> /20,000 essential = 4.0 months
  ];
  for (let i = 0; i < MONTHS.length; i++) {
    const assets = { cash: NW[i].cash, bank: NW[i].bank, liquidInvestments: 0, investments: NW[i].investments };
    const totalNetWorth = NW[i].cash + NW[i].bank + NW[i].investments;
    await prisma.netWorthSnapshot.upsert({
      where: { userId_month: { userId: user.id, month: utc(y, MONTHS[i], 1) } },
      create: {
        userId: user.id,
        month: utc(y, MONTHS[i], 1),
        assets,
        liabilities: {},
        totalNetWorth,
        monthlyIncomeInr: 75000,
      },
      update: { assets, liabilities: {}, totalNetWorth, monthlyIncomeInr: 75000 },
    });
  }
  console.log("Seeded 4 NetWorthSnapshot rows, ₹2.1L -> ₹2.6L, latest liquid assets ₹80,000.");

  // --- 9. Wallet cards (Mall Mode "in your wallet" section) --------------------------------
  await prisma.userCreditCard.createMany({
    data: [
      { userId: user.id, cardId: CARD_ID_MILLENNIA, status: "ACTIVE", acquiredAt: oldDate },
      { userId: user.id, cardId: CARD_ID_CASHBACK_SBI, status: "ACTIVE", acquiredAt: oldDate },
    ],
  });

  console.log("\nDone. Sign in on-device with:");
  console.log(`  Phone: ${DEMO_PHONE}  (use the app's phone login; OTP is disclosed via the`);
  console.log(`  allowlisted LoginBypassEntry — check POST /auth/phone/request-otp's devCode,`);
  console.log(`  or the debug build's "Trouble signing in?" bypass.)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
