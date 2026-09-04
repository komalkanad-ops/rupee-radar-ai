import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Savings (/savings)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.savingsContribution.deleteMany({ where: { instrument: { userId: { in: createdUserIds } } } });
    await prisma.savingsInstrument.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("creates a savings instrument with userId always taken from the token, never the body", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/savings")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ type: "GOLD_SCHEME", name: "Tanishq Gold Savings", institution: "Tanishq", userId: "someone-else" });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(user.userId);
    expect(res.body.principalInr).toBe(0);
    expect(res.body.active).toBe(true);
  });

  it("rejects a create missing required fields", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app).post("/savings").set("Authorization", `Bearer ${user.token}`).send({ name: "No type" });
    expect(res.status).toBe(400);
  });

  it("logging a contribution bumps the running principalInr and quantityGrams totals", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app)
      .post("/savings")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ type: "GOLD_COIN", name: "Gold coins" });

    const res = await request(app)
      .post(`/savings/${created.body.id}/contributions`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amountInr: 5000, quantity: 1.5 });

    expect(res.status).toBe(201);
    expect(res.body.principalInr).toBe(5000);
    expect(res.body.quantityGrams).toBe(1.5);
    expect(res.body.contributions).toHaveLength(1);
    expect(res.body.contributions[0].amountInr).toBe(5000);

    const second = await request(app)
      .post(`/savings/${created.body.id}/contributions`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amountInr: 3000, quantity: 0.8 });

    expect(second.body.principalInr).toBe(8000);
    expect(second.body.quantityGrams).toBe(2.3);
    expect(second.body.contributions).toHaveLength(2);
  });

  it("a STOCKS/MUTUAL_FUND contribution's quantity accumulates into quantityUnits, not quantityGrams", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app)
      .post("/savings")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ type: "MUTUAL_FUND", name: "Axis Bluechip SIP", contributionSchedule: "MONTHLY" });

    const res = await request(app)
      .post(`/savings/${created.body.id}/contributions`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amountInr: 2000, quantity: 12.34 });

    expect(res.body.quantityUnits).toBe(12.34);
    expect(res.body.quantityGrams).toBeNull();
  });

  it("converting a transaction (sourceTransactionId) re-tags its category to savings", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const txn = await prisma.smsTransaction.create({
      data: { userId: user.userId, rawSmsHash: "hash-1", amount: 2000, merchant: "Tanishq", category: "shopping", txnDate: new Date() },
    });

    const instrument = await request(app)
      .post("/savings")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ type: "GOLD_SCHEME", name: "Tanishq Gold Savings" });

    const res = await request(app)
      .post(`/savings/${instrument.body.id}/contributions`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amountInr: 2000, sourceTransactionId: txn.id });

    expect(res.status).toBe(201);
    expect(res.body.contributions[0].sourceTransactionId).toBe(txn.id);

    const updatedTxn = await prisma.smsTransaction.findUnique({ where: { id: txn.id } });
    expect(updatedTxn?.category).toBe("savings");
  });

  it("rejects converting a transaction that belongs to another user", async () => {
    const owner = await createAnonymousUser();
    const attacker = await createAnonymousUser();
    createdUserIds.push(owner.userId, attacker.userId);

    const txn = await prisma.smsTransaction.create({
      data: { userId: owner.userId, rawSmsHash: "hash-2", amount: 1000, category: "shopping", txnDate: new Date() },
    });

    const instrument = await request(app)
      .post("/savings")
      .set("Authorization", `Bearer ${attacker.token}`)
      .send({ type: "GOLD_SCHEME", name: "Attacker's instrument" });

    const res = await request(app)
      .post(`/savings/${instrument.body.id}/contributions`)
      .set("Authorization", `Bearer ${attacker.token}`)
      .send({ amountInr: 500, sourceTransactionId: txn.id });

    expect(res.status).toBe(400);
    const untouched = await prisma.smsTransaction.findUnique({ where: { id: txn.id } });
    expect(untouched?.category).toBe("shopping");
  });

  it("deletes (soft) a savings instrument", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app)
      .post("/savings")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ type: "FIXED_DEPOSIT", name: "SBI FD" });

    const del = await request(app).delete(`/savings/${created.body.id}`).set("Authorization", `Bearer ${user.token}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/savings").set("Authorization", `Bearer ${user.token}`);
    expect(list.body.find((r: any) => r.id === created.body.id)).toBeUndefined();
  });

  it("a user cannot log a contribution against another user's instrument", async () => {
    const owner = await createAnonymousUser();
    const attacker = await createAnonymousUser();
    createdUserIds.push(owner.userId, attacker.userId);

    const created = await request(app)
      .post("/savings")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ type: "GOLD_COIN", name: "Owner's gold" });

    const res = await request(app)
      .post(`/savings/${created.body.id}/contributions`)
      .set("Authorization", `Bearer ${attacker.token}`)
      .send({ amountInr: 1000 });

    expect(res.status).toBe(404);
  });
});
