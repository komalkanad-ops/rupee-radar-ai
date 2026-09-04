import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Wishlist items (/wishlist)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.wishlistItem.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("creates an item with userId always taken from the token, never the body", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/wishlist")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        userId: "someone-else",
        name: "Sony A7 IV",
        targetAmount: 240000,
        savedAmount: 60000,
        link: "https://example.com/sony-a7iv",
        notes: "Birthday goal.",
      });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(user.userId);
    expect(res.body.name).toBe("Sony A7 IV");
    expect(res.body.savedAmount).toBe(60000);
    expect(res.body.active).toBe(true);
  });

  it("lists only the caller's own active items, newest first", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    await request(app).post("/wishlist").set("Authorization", `Bearer ${userA.token}`)
      .send({ name: "First", targetAmount: 1000 });
    await request(app).post("/wishlist").set("Authorization", `Bearer ${userA.token}`)
      .send({ name: "Second", targetAmount: 2000 });
    await request(app).post("/wishlist").set("Authorization", `Bearer ${userB.token}`)
      .send({ name: "Other user's item", targetAmount: 5000 });

    const res = await request(app).get("/wishlist").set("Authorization", `Bearer ${userA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((w: any) => w.name)).toEqual(["Second", "First"]);
  });

  it("PUT updates only your own item; another user's token gets a 404", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const created = await request(app).post("/wishlist").set("Authorization", `Bearer ${userA.token}`)
      .send({ name: "Headphones", targetAmount: 30000 });
    const id = created.body.id;

    const crossUser = await request(app).put(`/wishlist/${id}`)
      .set("Authorization", `Bearer ${userB.token}`).send({ name: "Hijacked" });
    expect(crossUser.status).toBe(404);

    const ok = await request(app).put(`/wishlist/${id}`)
      .set("Authorization", `Bearer ${userA.token}`).send({ savedAmount: 12000 });
    expect(ok.status).toBe(200);
    expect(ok.body.savedAmount).toBe(12000);
  });

  it("delete is a soft delete — the item drops out of the list but the row stays", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/wishlist").set("Authorization", `Bearer ${user.token}`)
      .send({ name: "Watch", targetAmount: 45000 });
    const id = created.body.id;

    const del = await request(app).delete(`/wishlist/${id}`).set("Authorization", `Bearer ${user.token}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/wishlist").set("Authorization", `Bearer ${user.token}`);
    expect(list.body.find((w: any) => w.id === id)).toBeUndefined();

    const row = await prisma.wishlistItem.findUnique({ where: { id } });
    expect(row?.active).toBe(false);
  });
});
