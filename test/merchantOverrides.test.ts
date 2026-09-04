import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Merchant category overrides (/merchant-overrides)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.merchantCategoryOverride.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/merchant-overrides");
    expect(res.status).toBe(401);
  });

  it("returns an empty list for a fresh user", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app).get("/merchant-overrides").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("creates an override, scoped to the caller's own userId regardless of what's in the body", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/merchant-overrides")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ normalizedMerchant: "amazon", category: "shopping", userId: "someone-else" });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(user.userId);
    expect(res.body.normalizedMerchant).toBe("amazon");
    expect(res.body.category).toBe("shopping");
  });

  it("re-posting the same normalizedMerchant upserts instead of duplicating", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await request(app)
      .post("/merchant-overrides")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ normalizedMerchant: "zomato", category: "dining" });

    const second = await request(app)
      .post("/merchant-overrides")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ normalizedMerchant: "zomato", category: "food" });
    expect(second.status).toBe(201);
    expect(second.body.category).toBe("food");

    const list = await request(app).get("/merchant-overrides").set("Authorization", `Bearer ${user.token}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].category).toBe("food");
  });

  it("rejects a create missing normalizedMerchant or category", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const missingMerchant = await request(app)
      .post("/merchant-overrides")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ category: "shopping" });
    expect(missingMerchant.status).toBe(400);

    const missingCategory = await request(app)
      .post("/merchant-overrides")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ normalizedMerchant: "amazon" });
    expect(missingCategory.status).toBe(400);
  });

  it("one user never sees another user's overrides", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    await request(app)
      .post("/merchant-overrides")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ normalizedMerchant: "swiggy", category: "dining" });

    const bList = await request(app).get("/merchant-overrides").set("Authorization", `Bearer ${userB.token}`);
    expect(bList.body).toEqual([]);
  });
});
