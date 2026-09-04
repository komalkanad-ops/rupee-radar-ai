import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

// Verifies GET /recurring/detect actually gates on date spacing (day-of-month + interval window),
// not just merchant+amount — the bug this rewrite fixes was that two unrelated same-merchant/
// amount purchases months apart got flagged as "recurring" purely because there were 2+ of them.
describe("GET /recurring/detect", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  async function seedTransactions(userId: string, dates: Date[], amount: number, merchant: string, category?: string) {
    await prisma.smsTransaction.createMany({
      data: dates.map((txnDate, i) => ({
        userId,
        rawSmsHash: `test-${userId}-${merchant}-${i}`,
        amount,
        merchant,
        category,
        txnDate,
        parsedVia: "regex",
      })),
    });
  }

  it("does NOT flag two same-merchant/amount purchases 70 days apart as recurring", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await seedTransactions(
      user.userId,
      [new Date(Date.UTC(2026, 0, 5)), new Date(Date.UTC(2026, 2, 16))], // 70 days apart
      499,
      "AMAZON ONE-OFF",
    );

    const res = await request(app).get("/recurring/detect").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.find((c: any) => c.merchant === "AMAZON ONE-OFF")).toBeUndefined();
  });

  it("flags consistent ~monthly same-day charges as recurring, with frequency and evidence", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await seedTransactions(
      user.userId,
      [
        new Date(Date.UTC(2026, 0, 6)),
        new Date(Date.UTC(2026, 1, 6)),
        new Date(Date.UTC(2026, 2, 6)),
      ],
      499,
      "NETFLIX",
    );

    const res = await request(app).get("/recurring/detect").set("Authorization", `Bearer ${user.token}`);
    const candidate = res.body.find((c: any) => c.merchant === "NETFLIX");
    expect(candidate).toBeDefined();
    expect(candidate.frequency).toBe("monthly");
    expect(candidate.occurrences).toBe(3);
    expect(candidate.transactions).toHaveLength(3);
    expect(candidate.transactions[0]).toHaveProperty("txnDate");
    expect(candidate.transactions[0]).toHaveProperty("amount", 499);
  });

  it("does not group a monthly run with a later unrelated same-merchant/amount charge that breaks the day-of-month pattern", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await seedTransactions(
      user.userId,
      [
        new Date(Date.UTC(2026, 0, 6)),
        new Date(Date.UTC(2026, 1, 6)),
        new Date(Date.UTC(2026, 5, 20)), // far off both the interval window and the day-of-month
      ],
      499,
      "SPOTIFY",
    );

    const res = await request(app).get("/recurring/detect").set("Authorization", `Bearer ${user.token}`);
    const candidate = res.body.find((c: any) => c.merchant === "SPOTIFY");
    expect(candidate).toBeDefined();
    expect(candidate.occurrences).toBe(2); // only the two consistent monthly charges
  });

  it("does NOT flag a same-day-of-month, same-amount dining/grocery/shopping-category merchant as recurring — everyday repeat spend, not a real bill", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    // Same interval/day-of-month pattern real subscriptions match — the only thing that should
    // disqualify these is the category, proving the exclusion isn't accidentally also gated on
    // timing (which is already covered by the tests above).
    const dates = [new Date(Date.UTC(2026, 0, 6)), new Date(Date.UTC(2026, 1, 6)), new Date(Date.UTC(2026, 2, 6))];
    await seedTransactions(user.userId, dates, 850, "SWIGGY", "dining");
    await seedTransactions(user.userId, dates, 3200, "BIGBASKET", "groceries");
    await seedTransactions(user.userId, dates, 1500, "UBER", "transport");

    const res = await request(app).get("/recurring/detect").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.find((c: any) => c.merchant === "SWIGGY")).toBeUndefined();
    expect(res.body.find((c: any) => c.merchant === "BIGBASKET")).toBeUndefined();
    expect(res.body.find((c: any) => c.merchant === "UBER")).toBeUndefined();
  });

  it("still flags a same-day-of-month, same-amount utilities/entertainment-category merchant as recurring", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const dates = [new Date(Date.UTC(2026, 0, 6)), new Date(Date.UTC(2026, 1, 6)), new Date(Date.UTC(2026, 2, 6))];
    await seedTransactions(user.userId, dates, 399, "JIO RECHARGE", "utilities");

    const res = await request(app).get("/recurring/detect").set("Authorization", `Bearer ${user.token}`);
    const candidate = res.body.find((c: any) => c.merchant === "JIO RECHARGE");
    expect(candidate).toBeDefined();
    expect(candidate.occurrences).toBe(3);
  });

  it("does NOT flag two PVR/BookMyShow ticket purchases ~90 days apart as recurring, even though they're categorized 'entertainment' alongside real subscriptions", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    // 88-90 day gaps — deliberately inside the quarterly window, same shape as a real complaint:
    // two coincidental same-price movie outings read as a "quarterly subscription" without this fix.
    await seedTransactions(
      user.userId,
      [new Date(Date.UTC(2026, 0, 6)), new Date(Date.UTC(2026, 3, 4)), new Date(Date.UTC(2026, 5, 30))],
      450,
      "PVR CINEMAS",
      "entertainment",
    );
    await seedTransactions(
      user.userId,
      [new Date(Date.UTC(2026, 0, 10)), new Date(Date.UTC(2026, 3, 8))],
      600,
      "BOOKMYSHOW",
      "entertainment",
    );

    const res = await request(app).get("/recurring/detect").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.find((c: any) => c.merchant === "PVR CINEMAS")).toBeUndefined();
    expect(res.body.find((c: any) => c.merchant === "BOOKMYSHOW")).toBeUndefined();
  });

  it("requires 3+ occurrences for a quarterly candidate even for an otherwise-eligible merchant", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    // Two charges 88 days apart (inside the 80-100 quarterly window) but only 2 data points —
    // should NOT be enough evidence on its own now, regardless of category.
    await seedTransactions(
      user.userId,
      [new Date(Date.UTC(2026, 0, 6)), new Date(Date.UTC(2026, 3, 4))],
      999,
      "GENERIC QUARTERLY CO",
      "utilities",
    );

    const res = await request(app).get("/recurring/detect").set("Authorization", `Bearer ${user.token}`);
    expect(res.body.find((c: any) => c.merchant === "GENERIC QUARTERLY CO")).toBeUndefined();
  });
});

// POST /recurring upserts (rather than duplicates) rows the app auto-creates from a parsed SMS,
// keyed on (type, name) — a fresh credit-card statement each month refreshes the amount + due date
// on the same row. Manually-added rows always create.
describe("POST /recurring auto-detected upsert", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.recurringPayment.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("a second auto-detected POST with the same type+name updates the existing row", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const base = {
      type: "CREDIT_CARD_BILL",
      name: "HDFC Bank ••1234 statement",
      frequency: "monthly",
      autoDetected: true,
    };

    const first = await request(app).post("/recurring").set("Authorization", `Bearer ${user.token}`)
      .send({ ...base, amount: 45320, nextDueDate: "2026-09-18T00:00:00.000Z" });
    expect(first.status).toBe(201);

    const second = await request(app).post("/recurring").set("Authorization", `Bearer ${user.token}`)
      .send({ ...base, amount: 51200, nextDueDate: "2026-10-18T00:00:00.000Z" });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.amount).toBe(51200);

    const list = await request(app).get("/recurring").set("Authorization", `Bearer ${user.token}`);
    expect(list.body.filter((r: any) => r.name === base.name)).toHaveLength(1);
  });

  it("manual rows (autoDetected not true) still create duplicates", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const body = { type: "EMI", name: "Car loan", amount: 8000, frequency: "monthly" };
    const a = await request(app).post("/recurring").set("Authorization", `Bearer ${user.token}`).send(body);
    const b = await request(app).post("/recurring").set("Authorization", `Bearer ${user.token}`).send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
  });

  it("bumps detectedCount and keeps the earliest firstDetectedAt across repeated auto-detected POSTs", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const base = { type: "EMI", name: "Bajaj Finserv EMI", amount: 4599, frequency: "monthly", autoDetected: true };

    const first = await request(app).post("/recurring").set("Authorization", `Bearer ${user.token}`)
      .send({ ...base, firstDetectedAt: "2026-03-05T00:00:00.000Z" });
    expect(first.status).toBe(201);
    expect(first.body.detectedCount).toBe(1);

    const second = await request(app).post("/recurring").set("Authorization", `Bearer ${user.token}`)
      .send({ ...base, firstDetectedAt: "2026-01-05T00:00:00.000Z" });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.detectedCount).toBe(2);
    expect(new Date(second.body.firstDetectedAt).getTime()).toBe(Date.parse("2026-01-05T00:00:00.000Z"));
  });

  it("a dismissed auto-detected row is not resurrected by a later SMS, just its detectedCount ticks", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const base = { type: "EMI", name: "SomeShop No-Cost EMI", amount: 1999, frequency: "monthly", autoDetected: true };

    const created = await request(app).post("/recurring").set("Authorization", `Bearer ${user.token}`).send(base);
    expect(created.status).toBe(201);

    const dismissed = await request(app).patch(`/recurring/${created.body.id}/dismiss`).set("Authorization", `Bearer ${user.token}`);
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.active).toBe(false);
    expect(dismissed.body.dismissedAt).toBeTruthy();

    const again = await request(app).post("/recurring").set("Authorization", `Bearer ${user.token}`).send(base);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(created.body.id);
    expect(again.body.active).toBe(false);
    expect(again.body.dismissedAt).toBeTruthy();
    expect(again.body.detectedCount).toBe(2);

    const list = await request(app).get("/recurring").set("Authorization", `Bearer ${user.token}`);
    expect(list.body.find((r: any) => r.name === base.name)).toBeUndefined();
  });

  it("PATCH /:id/dismiss 404s for another user's row", async () => {
    const owner = await createAnonymousUser();
    const stranger = await createAnonymousUser();
    createdUserIds.push(owner.userId, stranger.userId);
    const row = await request(app).post("/recurring").set("Authorization", `Bearer ${owner.token}`)
      .send({ type: "EMI", name: "X EMI", amount: 100, frequency: "monthly", autoDetected: true });
    const res = await request(app).patch(`/recurring/${row.body.id}/dismiss`).set("Authorization", `Bearer ${stranger.token}`);
    expect(res.status).toBe(404);
  });
});
