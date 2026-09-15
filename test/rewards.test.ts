import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser, createRealUser } from "./helpers.js";

let deviceCounter = 0;
function testDeviceId(): string {
  deviceCounter += 1;
  return `test-referral-device-${Date.now()}-${deviceCounter}-${Math.random().toString(36).slice(2)}`;
}

describe("referrals + coins + voucher redemption", () => {
  const createdUserIds: string[] = [];
  const createdVoucherIds: string[] = [];
  const createdDeviceIds: string[] = [];

  afterAll(async () => {
    await prisma.voucherRedemption.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.coinLedgerEntry.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.referralConversion.deleteMany({ where: { referrerUserId: { in: createdUserIds } } });
    await prisma.referralDeviceClaim.deleteMany({ where: { deviceIdentifier: { in: createdDeviceIds } } });
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
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
    expect(first.body.totalProDaysEarned).toBe(0);
    expect(first.body.conversions).toEqual([]);
  });

  it("redeeming a valid code credits the referrer 500 coins + 1 day PRO, and the new user 100 coins", async () => {
    const referrer = await createRealUser();
    const newUser = await createRealUser();
    createdUserIds.push(referrer.userId, newUser.userId);
    const deviceId = testDeviceId();
    createdDeviceIds.push(deviceId);

    const meRes = await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`);
    const code = meRes.body.referralCode;

    const redeemRes = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${newUser.token}`)
      .send({ code, deviceIdentifier: deviceId });
    expect(redeemRes.status).toBe(201);
    expect(redeemRes.body.coinsAwarded).toBe(100);

    const referrerBalance = await request(app).get("/rewards/balance").set("Authorization", `Bearer ${referrer.token}`);
    const newUserBalance = await request(app).get("/rewards/balance").set("Authorization", `Bearer ${newUser.token}`);
    expect(referrerBalance.body.balance).toBe(500);
    expect(newUserBalance.body.balance).toBe(100);

    const referrerMe = await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`);
    expect(referrerMe.body.referralCount).toBe(1);
    expect(referrerMe.body.totalCoinsEarned).toBe(500);
    expect(referrerMe.body.totalProDaysEarned).toBe(1);
    expect(referrerMe.body.conversions).toHaveLength(1);
    expect(referrerMe.body.conversions[0].coinsAwarded).toBe(500);
    expect(referrerMe.body.conversions[0].proDaysAwarded).toBe(1);
    expect(referrerMe.body.conversions[0].completedAt).toBeTruthy();

    const proStatus = await request(app).get("/billing/status").set("Authorization", `Bearer ${referrer.token}`);
    expect(proStatus.body.isPro).toBe(true);
    const entitlement = await prisma.proEntitlement.findUniqueOrThrow({ where: { userId: referrer.userId } });
    expect(entitlement.expiryAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("stacks on top of an existing PRO entitlement instead of overwriting it", async () => {
    const referrer = await createRealUser();
    const newUser = await createRealUser();
    createdUserIds.push(referrer.userId, newUser.userId);
    const deviceId = testDeviceId();
    createdDeviceIds.push(deviceId);

    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.proEntitlement.create({
      data: { userId: referrer.userId, productId: "voucher_yearly", expiryAt: farFuture, verifiedAt: new Date(), status: "active" },
    });

    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;
    await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${newUser.token}`)
      .send({ code, deviceIdentifier: deviceId });

    const entitlement = await prisma.proEntitlement.findUniqueOrThrow({ where: { userId: referrer.userId } });
    expect(entitlement.expiryAt!.getTime()).toBeGreaterThan(farFuture.getTime());
  });

  it("blocks redemption by an anonymous (not-yet-signed-in) account", async () => {
    const referrer = await createRealUser();
    const anon = await createAnonymousUser();
    createdUserIds.push(referrer.userId, anon.userId);
    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;

    const res = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${anon.token}`)
      .send({ code, deviceIdentifier: testDeviceId() });
    expect(res.status).toBe(403);
  });

  it("blocks redemption of a code whose owner (the referrer) is still anonymous — closes the unbounded-farming gap", async () => {
    const anonymousReferrer = await createAnonymousUser();
    const user = await createRealUser();
    createdUserIds.push(anonymousReferrer.userId, user.userId);
    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${anonymousReferrer.token}`)).body.referralCode;

    const res = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code, deviceIdentifier: testDeviceId() });
    expect(res.status).toBe(404);
  });

  it("caps how many conversions one referrer can be credited with per day", async () => {
    const referrer = await createRealUser();
    createdUserIds.push(referrer.userId);
    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;

    // Seed 30 (the cap) conversions directly rather than making 30 real HTTP round-trips.
    const seededUserIds: string[] = [];
    for (let i = 0; i < 30; i++) {
      const seeded = await createRealUser();
      seededUserIds.push(seeded.userId);
      await prisma.referralConversion.create({
        data: { referrerUserId: referrer.userId, referredUserId: seeded.userId, coinsAwarded: 500, proDaysAwarded: 1 },
      });
    }
    createdUserIds.push(...seededUserIds);

    const newUser = await createRealUser();
    createdUserIds.push(newUser.userId);
    const deviceId = testDeviceId();
    createdDeviceIds.push(deviceId);

    const res = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${newUser.token}`)
      .send({ code, deviceIdentifier: deviceId });
    expect(res.status).toBe(429);

    // The cap is checked before the device claim is ever created — the 31st friend's device slot
    // and their own would-be welcome bonus are both untouched by someone else's daily cap.
    const claim = await prisma.referralDeviceClaim.findUnique({ where: { deviceIdentifier: deviceId } });
    expect(claim).toBeNull();
    const newUserBalance = await request(app).get("/rewards/balance").set("Authorization", `Bearer ${newUser.token}`);
    expect(newUserBalance.body.balance).toBe(0);
  });

  it("blocks a second account from redeeming on a device that already completed a referral, and flags it", async () => {
    const referrerA = await createRealUser();
    const referrerB = await createRealUser();
    const firstUser = await createRealUser();
    const secondUser = await createRealUser();
    createdUserIds.push(referrerA.userId, referrerB.userId, firstUser.userId, secondUser.userId);
    const sharedDeviceId = testDeviceId();
    createdDeviceIds.push(sharedDeviceId);

    const codeA = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrerA.token}`)).body.referralCode;
    const codeB = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrerB.token}`)).body.referralCode;

    const first = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${firstUser.token}`)
      .send({ code: codeA, deviceIdentifier: sharedDeviceId });
    expect(first.status).toBe(201);

    // Same device, a DIFFERENT account, a DIFFERENT referrer — must still be blocked.
    const second = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${secondUser.token}`)
      .send({ code: codeB, deviceIdentifier: sharedDeviceId });
    expect(second.status).toBe(409);

    const referrerBBalance = await request(app).get("/rewards/balance").set("Authorization", `Bearer ${referrerB.token}`);
    expect(referrerBBalance.body.balance).toBe(0);

    const claim = await prisma.referralDeviceClaim.findUniqueOrThrow({ where: { deviceIdentifier: sharedDeviceId } });
    expect(claim.referrerUserId).toBe(referrerA.userId);
    expect(claim.rejectedAttempts).toBe(1);
    expect(claim.lastRejectedAt).toBeTruthy();
  });

  it("does NOT flag the device when the SAME account that owns the claim retries (e.g. a network blip, or the Android app's own resume-triggered replay)", async () => {
    const referrer = await createRealUser();
    const user = await createRealUser();
    createdUserIds.push(referrer.userId, user.userId);
    const deviceId = testDeviceId();
    createdDeviceIds.push(deviceId);
    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;

    const first = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code, deviceIdentifier: deviceId });
    expect(first.status).toBe(201);

    // Same account, same device, retrying (e.g. after already succeeding) — not abuse.
    const retry = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code, deviceIdentifier: deviceId });
    expect(retry.status).toBe(409);

    const claim = await prisma.referralDeviceClaim.findUniqueOrThrow({ where: { deviceIdentifier: deviceId } });
    expect(claim.rejectedAttempts).toBe(0);
    expect(claim.lastRejectedAt).toBeNull();
  });

  it("two concurrent redemptions on the same device: exactly one succeeds", async () => {
    const referrer = await createRealUser();
    const userA = await createRealUser();
    const userB = await createRealUser();
    createdUserIds.push(referrer.userId, userA.userId, userB.userId);
    const sharedDeviceId = testDeviceId();
    createdDeviceIds.push(sharedDeviceId);
    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;

    const [resA, resB] = await Promise.all([
      request(app).post("/referrals/redeem").set("Authorization", `Bearer ${userA.token}`).send({ code, deviceIdentifier: sharedDeviceId }),
      request(app).post("/referrals/redeem").set("Authorization", `Bearer ${userB.token}`).send({ code, deviceIdentifier: sharedDeviceId }),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const referrerMe = await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`);
    expect(referrerMe.body.referralCount).toBe(1);
  });

  it("the device lock survives DELETE /auth/me — deleting and recreating the same real identity can't re-redeem", async () => {
    const referrer = await createRealUser();
    createdUserIds.push(referrer.userId);
    const deviceId = testDeviceId();
    createdDeviceIds.push(deviceId);
    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;

    const firstAccount = await createRealUser();
    const firstEmail = (await prisma.user.findUniqueOrThrow({ where: { id: firstAccount.userId } })).email!;

    const firstRedeem = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${firstAccount.token}`)
      .send({ code, deviceIdentifier: deviceId });
    expect(firstRedeem.status).toBe(201);

    // Real DELETE /auth/me, not a manual prisma delete — this is the exact transaction the schema
    // comment on ReferralDeviceClaim (and the matching comment in authRouter.ts) warns must never
    // be extended to include that table.
    const del = await request(app).delete("/auth/me").set("Authorization", `Bearer ${firstAccount.token}`);
    expect(del.status).toBe(204);

    // A fresh account signs in with the SAME real identity (email freed up by the deletion above).
    const secondAccount = await createRealUser();
    createdUserIds.push(secondAccount.userId);
    await prisma.user.update({ where: { id: secondAccount.userId }, data: { email: firstEmail } });

    const secondRedeem = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${secondAccount.token}`)
      .send({ code, deviceIdentifier: deviceId });
    expect(secondRedeem.status).toBe(409);

    // Known, accepted artifact: DELETE /auth/me also deletes the first ReferralConversion row (it
    // has an FK, unlike ReferralDeviceClaim), so the referrer's *displayed* history/count drops back
    // to 0 even though the 500 coins + 1 PRO day they already earned from it are untouched (coins
    // are a separate append-only CoinLedgerEntry, and the ProEntitlement isn't clawed back either).
    // What this test actually guards is that the SECOND redeem attempt above still 409s instead of
    // granting a duplicate reward — not that the display stays accurate after a deletion.
    const referrerMe = await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`);
    expect(referrerMe.body.referralCount).toBe(0);
    const referrerBalance = await request(app).get("/rewards/balance").set("Authorization", `Bearer ${referrer.token}`);
    expect(referrerBalance.body.balance).toBe(500);
  });

  it("blocks self-referral", async () => {
    const user = await createRealUser();
    createdUserIds.push(user.userId);
    const meRes = await request(app).get("/referrals/me").set("Authorization", `Bearer ${user.token}`);

    const res = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: meRes.body.referralCode, deviceIdentifier: testDeviceId() });
    expect(res.status).toBe(400);
  });

  it("blocks a user redeeming a second referral code after already redeeming one, and releases the wasted device claim", async () => {
    const referrerA = await createRealUser();
    const referrerB = await createRealUser();
    const newUser = await createRealUser();
    createdUserIds.push(referrerA.userId, referrerB.userId, newUser.userId);
    const deviceA = testDeviceId();
    const deviceB = testDeviceId();
    createdDeviceIds.push(deviceA, deviceB);

    const codeA = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrerA.token}`)).body.referralCode;
    const codeB = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrerB.token}`)).body.referralCode;

    const first = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${newUser.token}`)
      .send({ code: codeA, deviceIdentifier: deviceA });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${newUser.token}`)
      .send({ code: codeB, deviceIdentifier: deviceB });
    expect(second.status).toBe(409);

    // deviceB was claimed then rolled back since the conversion itself failed — must be free again.
    const claim = await prisma.referralDeviceClaim.findUnique({ where: { deviceIdentifier: deviceB } });
    expect(claim).toBeNull();
  });

  it("rejects an unknown referral code", async () => {
    const user = await createRealUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "NOTAREALCODE", deviceIdentifier: testDeviceId() });
    expect(res.status).toBe(404);
  });

  it("rejects a redeem call with no deviceIdentifier", async () => {
    const referrer = await createRealUser();
    const user = await createRealUser();
    createdUserIds.push(referrer.userId, user.userId);
    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;

    const res = await request(app).post("/referrals/redeem").set("Authorization", `Bearer ${user.token}`).send({ code });
    expect(res.status).toBe(400);
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
    const referrer = await createRealUser();
    const newUser = await createRealUser();
    createdUserIds.push(referrer.userId, newUser.userId);
    const deviceId = testDeviceId();
    createdDeviceIds.push(deviceId);
    const code = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;
    await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${newUser.token}`)
      .send({ code, deviceIdentifier: deviceId });

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
    const referrer = await createRealUser();
    const user = await createRealUser();
    createdUserIds.push(referrer.userId, user.userId);
    const deviceId = testDeviceId();
    createdDeviceIds.push(deviceId);
    const refCode = (await request(app).get("/referrals/me").set("Authorization", `Bearer ${referrer.token}`)).body.referralCode;
    await request(app)
      .post("/referrals/redeem")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: refCode, deviceIdentifier: deviceId });

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
