import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("referrals + coins + voucher redemption", () => {
  const createdUserIds: string[] = [];
  const createdVoucherIds: string[] = [];

  afterAll(async () => {
    await prisma.voucherRedemption.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.coinLedgerEntry.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.referralConversion.deleteMany({ where: { referrerUserId: { in: createdUserIds } } });
    await prisma.voucher.deleteMany({ where: { id: { in: createdVoucherIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("GET /referrals/me generates a code lazily and it's stable across calls", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };

    const first = await request(app).get("/referrals/me").set(auth);
    const second = await request(app).get("/referrals/me").set(auth);
    expect(first.body.referralCode).toBeTruthy();
    expect(first.body.referralCode).toBe(second.body.referralCode);
    expect(first.body.referralCount).toBe(0);
  });

  it("redeeming a valid code credits both the referrer and the new user", async () => {
    const referrer = await createAnonymousUser();
    const newUser = await createAnonymousUser();
    createdUserIds.push(referrer.userId, newUser.userId);

    const meRes = await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`);
    const code = meRes.body.referralCode;

    const redeemRes = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${newUser.token}`)
      .send({ code });
    expect(redeemRes.status).toBe(201);
    expect(redeemRes.body.coinsAwarded).toBe(100);

    const referrerBalance = await request(app).get("/rewards/balance").set("Authorization", `Bearer ${referrer.token}`);
    const newUserBalance = await request(app).get("/rewards/balance").set("Authorization", `Bearer ${newUser.token}`);
    expect(referrerBalance.body.balance).toBe(100);
    expect(newUserBalance.body.balance).toBe(100);
  });

  it("blocks self-referral", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const meRes = await request(app).get("/referrals/me").set("Authorization", `Bearer ${user.token}`);

    const res = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: meRes.body.referralCode });
    expect(res.status).toBe(400);
  });

  it("blocks a user redeeming a second referral code after already redeeming one", async () => {
    const referrerA = await createAnonymousUser();
    const referrerB = await createAnonymousUser();
    const newUser = await createAnonymousUser();
    createdUserIds.push(referrerA.userId, referrerB.userId, newUser.userId);

    const codeA = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrerA.token}`)).body.referralCode;
    const codeB = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrerB.token}`)).body.referralCode;

    const first = await request(app).post("/referrals/redeem").set("Authorization", `Bearer ${newUser.token}`).send({ code: codeA });
    expect(first.status).toBe(201);

    const second = await request(app).post("/referrals/redeem").set("Authorization", `Bearer ${newUser.token}`).send({ code: codeB });
    expect(second.status).toBe(409);
  });

  it("rejects an unknown referral code", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "NOTAREALCODE" });
    expect(res.status).toBe(404);
  });

  it("voucher redemption is blocked when the user doesn't have enough coins", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const voucher = await prisma.voucher.create({ data: { title: "₹500 Amazon voucher", coinCost: 5000, active: true } });
    createdVoucherIds.push(voucher.id);

    const res = await request(app)
      .post(`/rewards/vouchers/${voucher.id}/redeem`)
      .set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(402);
  });

  it("voucher redemption succeeds, deducts coins, and decrements stock", async () => {
    const referrer = await createAnonymousUser();
    const newUser = await createAnonymousUser();
    createdUserIds.push(referrer.userId, newUser.userId);
    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;
    await request(app).post("/referrals/redeem").set("Authorization", `Bearer ${newUser.token}`).send({ code });

    const voucher = await prisma.voucher.create({ data: { title: "₹50 voucher", coinCost: 50, stockRemaining: 1, active: true } });
    createdVoucherIds.push(voucher.id);

    const redeemRes = await request(app)
      .post(`/rewards/vouchers/${voucher.id}/redeem`)
      .set("Authorization", `Bearer ${newUser.token}`);
    expect(redeemRes.status).toBe(201);
    expect(redeemRes.body.status).toBe("PENDING_FULFILLMENT");

    const balanceRes = await request(app).get("/rewards/balance").set("Authorization", `Bearer ${newUser.token}`);
    expect(balanceRes.body.balance).toBe(50); // 100 earned - 50 spent

    const updatedVoucher = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updatedVoucher.stockRemaining).toBe(0);

    const secondRedeemRes = await request(app)
      .post(`/rewards/vouchers/${voucher.id}/redeem`)
      .set("Authorization", `Bearer ${newUser.token}`);
    expect(secondRedeemRes.status).toBe(409); // out of stock
  });

  it("an instant voucher (admin pre-loaded code) is fulfilled immediately and reveals code+pin", async () => {
    const referrer = await createAnonymousUser();
    const user = await createAnonymousUser();
    createdUserIds.push(referrer.userId, user.userId);
    const refCode = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;
    await request(app).post("/referrals/redeem").set("Authorization", `Bearer ${user.token}`).send({ code: refCode });

    const voucher = await prisma.voucher.create({
      data: { title: "₹20 instant", coinCost: 20, active: true, code: "AMZ-TEST-123", pin: "9988" },
    });
    createdVoucherIds.push(voucher.id);

    // The public catalog must never leak the code.
    const catalog = await request(app).get("/rewards/vouchers").set("Authorization", `Bearer ${user.token}`);
    const listed = catalog.body.find((v: any) => v.id === voucher.id);
    expect(listed.code).toBeUndefined();
    expect(listed.pin).toBeUndefined();
    expect(listed.instant).toBe(true);

    const redeem = await request(app).post(`/rewards/vouchers/${voucher.id}/redeem`).set("Authorization", `Bearer ${user.token}`);
    expect(redeem.status).toBe(201);
    expect(redeem.body.status).toBe("FULFILLED");
    expect(redeem.body.code).toBe("AMZ-TEST-123");
    expect(redeem.body.pin).toBe("9988");

    const history = await request(app).get("/rewards/redemptions").set("Authorization", `Bearer ${user.token}`);
    expect(history.body[0].code).toBe("AMZ-TEST-123");
    expect(history.body[0].status).toBe("FULFILLED");
  });
});
