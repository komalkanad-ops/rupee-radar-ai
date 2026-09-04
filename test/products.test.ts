import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Product records (/products)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.productRecord.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("creates a record with userId always taken from the token, never the body", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        userId: "someone-else",
        name: "Sony WH-1000XM5",
        brand: "Sony",
        category: "Electronics",
        purchaseDate: "2026-08-01T00:00:00.000Z",
        pricePaid: 26990,
        seller: "Amazon",
        warrantyMonths: 12,
        warrantyExpiry: "2027-08-01T00:00:00.000Z",
        serialNumber: "SN-ABC-123",
        notes: "Bought during the sale. Box + invoice in the drawer.",
      });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(user.userId);
    expect(res.body.name).toBe("Sony WH-1000XM5");
    expect(res.body.active).toBe(true);
  });

  it("lists only the caller's own active records, soonest-expiring first", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    await request(app).post("/products").set("Authorization", `Bearer ${userA.token}`)
      .send({ name: "Fridge", purchaseDate: "2026-01-01T00:00:00.000Z", warrantyExpiry: "2031-01-01T00:00:00.000Z" });
    await request(app).post("/products").set("Authorization", `Bearer ${userA.token}`)
      .send({ name: "Kettle", purchaseDate: "2026-06-01T00:00:00.000Z", warrantyExpiry: "2027-06-01T00:00:00.000Z" });
    await request(app).post("/products").set("Authorization", `Bearer ${userA.token}`)
      .send({ name: "No-warranty mug", purchaseDate: "2026-06-01T00:00:00.000Z" });
    await request(app).post("/products").set("Authorization", `Bearer ${userB.token}`)
      .send({ name: "Other user's TV", purchaseDate: "2026-01-01T00:00:00.000Z" });

    const res = await request(app).get("/products").set("Authorization", `Bearer ${userA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((p: any) => p.name)).toEqual(["Kettle", "Fridge", "No-warranty mug"]);
  });

  it("PUT updates only your own record; another user's token gets a 404", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const created = await request(app).post("/products").set("Authorization", `Bearer ${userA.token}`)
      .send({ name: "Laptop", purchaseDate: "2026-08-10T00:00:00.000Z" });
    const id = created.body.id;

    const crossUser = await request(app).put(`/products/${id}`)
      .set("Authorization", `Bearer ${userB.token}`).send({ name: "Hijacked" });
    expect(crossUser.status).toBe(404);

    const ok = await request(app).put(`/products/${id}`)
      .set("Authorization", `Bearer ${userA.token}`).send({ name: "Laptop (work)", warrantyMonths: 24 });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("Laptop (work)");
    expect(ok.body.warrantyMonths).toBe(24);
  });

  it("delete is a soft delete — the record drops out of the list but the row stays", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/products").set("Authorization", `Bearer ${user.token}`)
      .send({ name: "Blender", purchaseDate: "2026-08-15T00:00:00.000Z" });
    const id = created.body.id;

    const del = await request(app).delete(`/products/${id}`).set("Authorization", `Bearer ${user.token}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/products").set("Authorization", `Bearer ${user.token}`);
    expect(list.body.find((p: any) => p.id === id)).toBeUndefined();

    const row = await prisma.productRecord.findUnique({ where: { id } });
    expect(row?.active).toBe(false);
  });
});
