import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Todo (/todo)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.todoItem.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("creates an item with userId always taken from the token, never the body", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/todo")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ userId: "someone-else", title: "Claim ₹20,000 for vaccination", type: "CLAIM", amount: 20000 });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(user.userId);
    expect(res.body.status).toBe("OPEN");
  });

  it("lists only the caller's own active items", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    await request(app).post("/todo").set("Authorization", `Bearer ${userA.token}`).send({ title: "Pay electricity bill", type: "BILL" });
    await request(app).post("/todo").set("Authorization", `Bearer ${userB.token}`).send({ title: "Other user's item", type: "OTHER" });

    const res = await request(app).get("/todo").set("Authorization", `Bearer ${userA.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Pay electricity bill");
  });

  it("marking DONE sets completedAt; a second token can't touch another user's item", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const created = await request(app)
      .post("/todo")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ title: "Raise a claim for medicines", type: "CLAIM" });
    const id = created.body.id;

    const crossUserAttempt = await request(app)
      .patch(`/todo/${id}/status`)
      .set("Authorization", `Bearer ${userB.token}`)
      .send({ status: "DONE" });
    expect(crossUserAttempt.status).toBe(404);

    const res = await request(app)
      .patch(`/todo/${id}/status`)
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ status: "DONE" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DONE");
    expect(res.body.completedAt).not.toBeNull();
  });

  it("delete soft-deactivates rather than hard-deleting", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app)
      .post("/todo")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ title: "Pay internet bill", type: "BILL" });

    const del = await request(app).delete(`/todo/${created.body.id}`).set("Authorization", `Bearer ${user.token}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/todo").set("Authorization", `Bearer ${user.token}`);
    expect(list.body.find((t: any) => t.id === created.body.id)).toBeUndefined();
  });
});
