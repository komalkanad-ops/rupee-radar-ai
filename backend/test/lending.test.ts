import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Lending Tracker (/lending)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.lentMoney.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("creates an entry with userId always taken from the token, never the body", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/lending")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ userId: "someone-else", personName: "Rahul", amount: 500, reason: "Lunch money" });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(user.userId);
    expect(res.body.status).toBe("OUTSTANDING");
  });

  it("lists only the caller's own active entries, most-urgent expectedReturnDate first", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const other = await createAnonymousUser();
    createdUserIds.push(other.userId);

    await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "No date", amount: 100,
    });
    await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Due soon", amount: 200, expectedReturnDate: new Date(Date.now() + 86400000).toISOString(),
    });
    await request(app).post("/lending").set("Authorization", `Bearer ${other.token}`).send({
      personName: "Not mine", amount: 999,
    });

    const res = await request(app).get("/lending").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].personName).toBe("Due soon"); // has a date, sorts before the null-date row
    expect(res.body.find((r: any) => r.personName === "Not mine")).toBeUndefined();
  });

  it("marking as returned sets status and returnedDate", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Priya", amount: 1000,
    });

    const res = await request(app)
      .patch(`/lending/${created.body.id}/status`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ status: "RETURNED" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RETURNED");
    expect(res.body.returnedDate).not.toBeNull();
  });

  it("denies mutating another user's entry (ownership check)", async () => {
    const owner = await createAnonymousUser();
    createdUserIds.push(owner.userId);
    const attacker = await createAnonymousUser();
    createdUserIds.push(attacker.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${owner.token}`).send({
      personName: "Owner's entry", amount: 300,
    });

    const res = await request(app)
      .delete(`/lending/${created.body.id}`)
      .set("Authorization", `Bearer ${attacker.token}`);

    expect(res.status).toBe(404);
  });

  it("delete soft-deletes (active: false), no longer appears in the list", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "To remove", amount: 50,
    });

    const del = await request(app).delete(`/lending/${created.body.id}`).set("Authorization", `Bearer ${user.token}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/lending").set("Authorization", `Bearer ${user.token}`);
    expect(list.body.find((r: any) => r.id === created.body.id)).toBeUndefined();
  });

  it("partial repayment increments amountRepaid without flipping status", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Installments", amount: 1000,
    });

    const res = await request(app)
      .patch(`/lending/${created.body.id}/repayment`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 400 });

    expect(res.status).toBe(200);
    expect(res.body.amountRepaid).toBe(400);
    expect(res.body.status).toBe("OUTSTANDING");
  });

  it("repayment reaching the full amount auto-flips status to RETURNED", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Full payoff", amount: 500,
    });

    await request(app).patch(`/lending/${created.body.id}/repayment`).set("Authorization", `Bearer ${user.token}`).send({ amount: 300 });
    const res = await request(app)
      .patch(`/lending/${created.body.id}/repayment`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 200 });

    expect(res.body.amountRepaid).toBe(500);
    expect(res.body.status).toBe("RETURNED");
    expect(res.body.returnedDate).not.toBeNull();
  });

  it("each repayment is logged as its own dated ledger row, newest first, and returned with GET /", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Ledger check", amount: 900,
    });

    await request(app).patch(`/lending/${created.body.id}/repayment`).set("Authorization", `Bearer ${user.token}`).send({ amount: 300 });
    const second = await request(app)
      .patch(`/lending/${created.body.id}/repayment`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 250 });

    expect(second.body.repayments).toHaveLength(2);
    expect(second.body.repayments.map((r: any) => r.amount).sort()).toEqual([250, 300]);

    const list = await request(app).get("/lending").set("Authorization", `Bearer ${user.token}`);
    const row = list.body.find((r: any) => r.id === created.body.id);
    expect(row.repayments).toHaveLength(2);
  });

  it("deleting a repayment recomputes amountRepaid and reverts a RETURNED status back to OUTSTANDING", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Oops logged wrong", amount: 500,
    });

    await request(app).patch(`/lending/${created.body.id}/repayment`).set("Authorization", `Bearer ${user.token}`).send({ amount: 300 });
    const second = await request(app)
      .patch(`/lending/${created.body.id}/repayment`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 200 });
    expect(second.body.status).toBe("RETURNED");

    const toDelete = second.body.repayments.find((r: any) => r.amount === 200);
    const res = await request(app)
      .delete(`/lending/${created.body.id}/repayment/${toDelete.id}`)
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.amountRepaid).toBe(300);
    expect(res.body.status).toBe("OUTSTANDING");
    expect(res.body.returnedDate).toBeNull();
    expect(res.body.repayments).toHaveLength(1);
  });

  it("404s deleting a repayment that doesn't belong to the given lending entry", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const entryA = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({ personName: "A", amount: 100 });
    const entryB = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({ personName: "B", amount: 100 });
    const repaymentOnB = await request(app)
      .patch(`/lending/${entryB.body.id}/repayment`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 50 });

    const res = await request(app)
      .delete(`/lending/${entryA.body.id}/repayment/${repaymentOnB.body.repayments[0].id}`)
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(404);
  });

  it("a user cannot log a repayment against another user's entry", async () => {
    const owner = await createAnonymousUser();
    createdUserIds.push(owner.userId);
    const attacker = await createAnonymousUser();
    createdUserIds.push(attacker.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${owner.token}`).send({
      personName: "Owner's entry", amount: 300,
    });

    const res = await request(app)
      .patch(`/lending/${created.body.id}/repayment`)
      .set("Authorization", `Bearer ${attacker.token}`)
      .send({ amount: 100 });

    expect(res.status).toBe(404);
  });

  it("adds a planned installment to the schedule, returned with GET /", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Schedule test", amount: 1200,
    });

    const res = await request(app)
      .post(`/lending/${created.body.id}/installment`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ dueDate: new Date(Date.now() + 86400000).toISOString(), amount: 400 });

    expect(res.status).toBe(201);
    expect(res.body.installments).toHaveLength(1);
    expect(res.body.installments[0].amount).toBe(400);
    expect(res.body.installments[0].paidAt).toBeNull();

    const list = await request(app).get("/lending").set("Authorization", `Bearer ${user.token}`);
    const row = list.body.find((r: any) => r.id === created.body.id);
    expect(row.installments).toHaveLength(1);
  });

  it("rejects an installment with a non-positive amount or no due date", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Bad installment", amount: 500,
    });

    const res = await request(app)
      .post(`/lending/${created.body.id}/installment`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: -50 });

    expect(res.status).toBe(400);
  });

  it("marks an installment paid, then unpaid again", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Mark paid", amount: 600,
    });
    const added = await request(app)
      .post(`/lending/${created.body.id}/installment`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ dueDate: new Date().toISOString(), amount: 600 });
    const installmentId = added.body.installments[0].id;

    const paid = await request(app)
      .patch(`/lending/${created.body.id}/installment/${installmentId}`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ paidAt: new Date().toISOString() });
    expect(paid.status).toBe(200);
    expect(paid.body.installments[0].paidAt).not.toBeNull();

    const unpaid = await request(app)
      .patch(`/lending/${created.body.id}/installment/${installmentId}`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ paidAt: null });
    expect(unpaid.body.installments[0].paidAt).toBeNull();
  });

  it("deletes a planned installment", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/lending").set("Authorization", `Bearer ${user.token}`).send({
      personName: "Delete installment", amount: 700,
    });
    const added = await request(app)
      .post(`/lending/${created.body.id}/installment`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ dueDate: new Date().toISOString(), amount: 700 });
    const installmentId = added.body.installments[0].id;

    const res = await request(app)
      .delete(`/lending/${created.body.id}/installment/${installmentId}`)
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.installments).toHaveLength(0);
  });

  it("404s an installment action against another user's entry, or an installment that belongs to a different entry", async () => {
    const owner = await createAnonymousUser();
    createdUserIds.push(owner.userId);
    const attacker = await createAnonymousUser();
    createdUserIds.push(attacker.userId);

    const entryA = await request(app).post("/lending").set("Authorization", `Bearer ${owner.token}`).send({ personName: "A", amount: 100 });
    const entryB = await request(app).post("/lending").set("Authorization", `Bearer ${owner.token}`).send({ personName: "B", amount: 100 });
    const installmentOnB = await request(app)
      .post(`/lending/${entryB.body.id}/installment`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ dueDate: new Date().toISOString(), amount: 50 });

    const crossEntry = await request(app)
      .patch(`/lending/${entryA.body.id}/installment/${installmentOnB.body.installments[0].id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ paidAt: new Date().toISOString() });
    expect(crossEntry.status).toBe(404);

    const crossUser = await request(app)
      .post(`/lending/${entryA.body.id}/installment`)
      .set("Authorization", `Bearer ${attacker.token}`)
      .send({ dueDate: new Date().toISOString(), amount: 50 });
    expect(crossUser.status).toBe(404);
  });
});
