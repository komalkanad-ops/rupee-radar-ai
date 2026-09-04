import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

// Verifies the "dead weight" card-flagging money logic (fee-bearing + held over a year + stale
// usage), not just that the endpoint returns 200.
describe("GET /wallet/health", () => {
  const createdUserIds: string[] = [];
  let bankId: string;
  let feeCardId: string;
  let freeCardId: string;

  beforeAll(async () => {
    const bank = await prisma.bank.create({ data: { name: `TestBank-${Date.now()}`, type: "PRIVATE" } });
    bankId = bank.id;
    const feeCard = await prisma.creditCard.create({
      data: { bankId, name: "Fee Card", network: "VISA", category: "REWARDS", annualFeeInr: 5000, joiningFeeInr: 0 },
    });
    feeCardId = feeCard.id;
    const freeCard = await prisma.creditCard.create({
      data: { bankId, name: "Free Card", network: "VISA", category: "REWARDS", annualFeeInr: 0, joiningFeeInr: 0 },
    });
    freeCardId = freeCard.id;
  });

  afterAll(async () => {
    const entries = await prisma.userCreditCard.findMany({ where: { userId: { in: createdUserIds } } });
    await prisma.loungeVisit.deleteMany({ where: { userCreditCardId: { in: entries.map((e) => e.id) } } });
    await prisma.userCreditCard.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.creditCard.deleteMany({ where: { bankId } });
    await prisma.bank.delete({ where: { id: bankId } });
  });

  it("flags a fee-bearing card held over a year with no recent check-in as dead weight", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await prisma.userCreditCard.create({
      data: { userId: user.userId, cardId: feeCardId, acquiredAt: new Date(Date.now() - 400 * 86400000), status: "ACTIVE" },
    });

    const res = await request(app).get("/wallet/health").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].deadWeight).toBe(true);
    expect(res.body[0].suggestion).toBeTruthy();
    expect(res.body[0].protectCreditScoreNote).toBeTruthy();
  });

  it("does not flag a no-fee card even if unused for the same period", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await prisma.userCreditCard.create({
      data: { userId: user.userId, cardId: freeCardId, acquiredAt: new Date(Date.now() - 400 * 86400000), status: "ACTIVE" },
    });

    const res = await request(app).get("/wallet/health").set("Authorization", `Bearer ${user.token}`);
    expect(res.body[0].deadWeight).toBe(false);
  });

  it("does not flag a recently-acquired fee card (grace period before penalizing a new card)", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await prisma.userCreditCard.create({
      data: { userId: user.userId, cardId: feeCardId, acquiredAt: new Date(), status: "ACTIVE" },
    });

    const res = await request(app).get("/wallet/health").set("Authorization", `Bearer ${user.token}`);
    expect(res.body[0].deadWeight).toBe(false);
  });

  it("a recent check-in clears the dead-weight flag even on an old fee card", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const entry = await prisma.userCreditCard.create({
      data: { userId: user.userId, cardId: feeCardId, acquiredAt: new Date(Date.now() - 400 * 86400000), status: "ACTIVE" },
    });

    const checkinRes = await request(app).post(`/wallet/${entry.id}/checkin`).set("Authorization", `Bearer ${user.token}`);
    expect(checkinRes.status).toBe(200);

    const res = await request(app).get("/wallet/health").set("Authorization", `Bearer ${user.token}`);
    expect(res.body[0].deadWeight).toBe(false);
  });

  it("a user cannot check in on another user's wallet card", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const entry = await prisma.userCreditCard.create({
      data: { userId: userA.userId, cardId: feeCardId, acquiredAt: new Date(Date.now() - 400 * 86400000), status: "ACTIVE" },
    });

    const res = await request(app).post(`/wallet/${entry.id}/checkin`).set("Authorization", `Bearer ${userB.token}`);
    expect(res.status).toBe(404);

    const unchanged = await prisma.userCreditCard.findUnique({ where: { id: entry.id } });
    expect(unchanged?.lastConfirmedUsedAt).toBeNull();
  });

  it("PATCH credit-info updates limit/outstanding and it's reflected on the health endpoint", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const entry = await prisma.userCreditCard.create({
      data: { userId: user.userId, cardId: freeCardId, acquiredAt: new Date(), status: "ACTIVE" },
    });

    const patchRes = await request(app)
      .patch(`/wallet/${entry.id}/credit-info`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ creditLimitInr: 100000, currentOutstandingInr: 25000 });
    expect(patchRes.status).toBe(200);

    const healthRes = await request(app).get("/wallet/health").set("Authorization", `Bearer ${user.token}`);
    expect(healthRes.body[0].creditLimitInr).toBe(100000);
    expect(healthRes.body[0].currentOutstandingInr).toBe(25000);
  });

  it("a user cannot set credit-info on another user's wallet card", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const entry = await prisma.userCreditCard.create({
      data: { userId: userA.userId, cardId: freeCardId, acquiredAt: new Date(), status: "ACTIVE" },
    });

    const res = await request(app)
      .patch(`/wallet/${entry.id}/credit-info`)
      .set("Authorization", `Bearer ${userB.token}`)
      .send({ creditLimitInr: 999999 });
    expect(res.status).toBe(404);

    const unchanged = await prisma.userCreditCard.findUnique({ where: { id: entry.id } });
    expect(unchanged?.creditLimitInr).toBeNull();
  });

  it("POST lounge-visit logs a visit and the count shows up on the health endpoint", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const entry = await prisma.userCreditCard.create({
      data: { userId: user.userId, cardId: freeCardId, acquiredAt: new Date(), status: "ACTIVE" },
    });

    const visitRes = await request(app).post(`/wallet/${entry.id}/lounge-visit`).set("Authorization", `Bearer ${user.token}`);
    expect(visitRes.status).toBe(201);
    expect(visitRes.body.loungeVisitsThisQuarter).toBe(1);

    const healthRes = await request(app).get("/wallet/health").set("Authorization", `Bearer ${user.token}`);
    expect(healthRes.body[0].loungeVisitsThisQuarter).toBe(1);
  });

  it("a lounge visit from last quarter does not count toward this quarter's total", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const entry = await prisma.userCreditCard.create({
      data: { userId: user.userId, cardId: freeCardId, acquiredAt: new Date(), status: "ACTIVE" },
    });

    await prisma.loungeVisit.create({
      data: { userCreditCardId: entry.id, visitedAt: new Date(Date.now() - 120 * 86400000) },
    });

    const healthRes = await request(app).get("/wallet/health").set("Authorization", `Bearer ${user.token}`);
    expect(healthRes.body[0].loungeVisitsThisQuarter).toBe(0);
  });

  it("PATCH credit-info also updates reward points balance/expiry", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const entry = await prisma.userCreditCard.create({
      data: { userId: user.userId, cardId: freeCardId, acquiredAt: new Date(), status: "ACTIVE" },
    });

    const expiry = new Date(Date.now() + 15 * 86400000).toISOString();
    const patchRes = await request(app)
      .patch(`/wallet/${entry.id}/credit-info`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ rewardPointsBalance: 4500, rewardPointsExpiryDate: expiry });
    expect(patchRes.status).toBe(200);

    const healthRes = await request(app).get("/wallet/health").set("Authorization", `Bearer ${user.token}`);
    expect(healthRes.body[0].rewardPointsBalance).toBe(4500);
    expect(new Date(healthRes.body[0].rewardPointsExpiryDate).toISOString()).toBe(expiry);
  });
});
