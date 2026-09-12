import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

async function grantPro(userId: string) {
  await prisma.proEntitlement.upsert({
    where: { userId },
    create: { userId, productId: "test", status: "active", expiryAt: new Date(Date.now() + 86400_000) },
    update: { status: "active", expiryAt: new Date(Date.now() + 86400_000) },
  });
}

describe("Coupon Vault (/coupons)", () => {
  const uids: string[] = [];
  afterAll(async () => {
    await prisma.savedCoupon.deleteMany({ where: { userId: { in: uids } } });
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: uids } } });
    await prisma.user.deleteMany({ where: { id: { in: uids } } });
  });

  it("requires a token", async () => {
    expect((await request(app).get("/coupons")).status).toBe(401);
  });

  it("requires PRO even with a valid token", async () => {
    const user = await createAnonymousUser();
    uids.push(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const res = await request(app).get("/coupons").set(auth);
    expect(res.status).toBe(403);
    expect(res.body.proRequired).toBe(true);
  });

  it("rejects a coupon with no merchantName/title", async () => {
    const user = await createAnonymousUser();
    uids.push(user.userId);
    await grantPro(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const bad = await request(app).post("/coupons").set(auth).send({ code: "SAVE10" });
    expect(bad.status).toBe(400);
  });

  it("creates, lists, edits (with normalization) and dismisses a coupon", async () => {
    const user = await createAnonymousUser();
    uids.push(user.userId);
    await grantPro(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };

    const create = await request(app).post("/coupons").set(auth).send({
      id: "coupon-test-1",
      merchantName: "Amazon",
      title: "10% off electronics",
      code: "ELEC10",
      category: "SHOPPING", // deliberately mixed-case — should normalize to lowercase
      expiryDate: "2030-01-01T00:00:00.000Z",
    });
    expect(create.status).toBe(201);
    expect(create.body.id).toBe("coupon-test-1");
    expect(create.body.category).toBe("shopping");
    expect(create.body.status).toBe("ACTIVE");

    const list = await request(app).get("/coupons").set(auth);
    expect(list.body).toHaveLength(1);

    const markUsed = await request(app).put("/coupons/coupon-test-1").set(auth).send({
      merchantName: "Amazon",
      title: "10% off electronics",
      code: "ELEC10",
      category: "shopping",
      status: "USED",
    });
    expect(markUsed.status).toBe(200);
    expect(markUsed.body.status).toBe("USED");
    expect(markUsed.body.usedAt).not.toBeNull();

    expect((await request(app).delete("/coupons/coupon-test-1").set(auth)).status).toBe(204);
    // dismissed coupons drop out of the default list...
    expect((await request(app).get("/coupons").set(auth)).body).toHaveLength(0);
    // ...but the row itself still exists (soft delete), same convention as Goals/Wishlist.
    const stillThere = await prisma.savedCoupon.findUnique({ where: { id: "coupon-test-1" } });
    expect(stillThere?.status).toBe("DISMISSED");
  });

  it("rejects an unauthenticated user's attempt to edit someone else's coupon", async () => {
    const owner = await createAnonymousUser();
    uids.push(owner.userId);
    await grantPro(owner.userId);
    const other = await createAnonymousUser();
    uids.push(other.userId);
    await grantPro(other.userId);

    await request(app)
      .post("/coupons")
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ id: "coupon-test-2", merchantName: "Flipkart", title: "Big billion days" });

    const res = await request(app)
      .put("/coupons/coupon-test-2")
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ merchantName: "Flipkart", title: "hijacked" });
    expect(res.status).toBe(404);
  });

  it("rejects a non-image upload on /coupons/parse", async () => {
    const user = await createAnonymousUser();
    uids.push(user.userId);
    await grantPro(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const res = await request(app)
      .post("/coupons/parse")
      .set(auth)
      .attach("file", Buffer.from("not an image"), { filename: "note.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });

  it("requires a file on /coupons/parse", async () => {
    const user = await createAnonymousUser();
    uids.push(user.userId);
    await grantPro(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const res = await request(app).post("/coupons/parse").set(auth);
    expect(res.status).toBe(400);
  });
});
