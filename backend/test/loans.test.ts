import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Loans (/loans)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.loan.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  const baseLoan = {
    type: "HOME",
    bankName: "HDFC Bank",
    principal: 3000000,
    roiAnnualPct: 8.5,
    startDate: "2024-01-01T00:00:00.000Z",
    tenureMonths: 240,
    emiAmount: 26035,
  };

  it("creates a loan with userId always taken from the token, never the body", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/loans")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ ...baseLoan, userId: "someone-else" });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(user.userId);
    expect(res.body.bankName).toBe("HDFC Bank");
    expect(res.body.active).toBe(true);
  });

  it("rejects a create missing required fields", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/loans")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ type: "CAR", bankName: "ICICI Bank" });
    expect(res.status).toBe(400);
  });

  it("lists only the caller's own active loans", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    await request(app).post("/loans").set("Authorization", `Bearer ${userA.token}`).send({ ...baseLoan, bankName: "A's Bank" });
    await request(app).post("/loans").set("Authorization", `Bearer ${userB.token}`).send({ ...baseLoan, bankName: "B's Bank" });

    const res = await request(app).get("/loans").set("Authorization", `Bearer ${userA.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].bankName).toBe("A's Bank");
  });

  it("a second token can't update or delete another user's loan", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const created = await request(app).post("/loans").set("Authorization", `Bearer ${userA.token}`).send(baseLoan);
    const id = created.body.id;

    const crossUpdate = await request(app)
      .put(`/loans/${id}`)
      .set("Authorization", `Bearer ${userB.token}`)
      .send({ bankName: "Hijacked" });
    expect(crossUpdate.status).toBe(404);

    const crossDelete = await request(app).delete(`/loans/${id}`).set("Authorization", `Bearer ${userB.token}`);
    expect(crossDelete.status).toBe(404);
  });

  it("update edits fields; delete soft-deactivates rather than hard-deleting", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/loans").set("Authorization", `Bearer ${user.token}`).send(baseLoan);
    const id = created.body.id;

    const updated = await request(app)
      .put(`/loans/${id}`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ emiAmount: 27000 });
    expect(updated.status).toBe(200);
    expect(updated.body.emiAmount).toBe(27000);

    const del = await request(app).delete(`/loans/${id}`).set("Authorization", `Bearer ${user.token}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/loans").set("Authorization", `Bearer ${user.token}`);
    expect(list.body.find((l: any) => l.id === id)).toBeUndefined();
  });

  it("confirm-payment stamps lastPaymentConfirmedAt and is ownership-checked", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const created = await request(app).post("/loans").set("Authorization", `Bearer ${userA.token}`).send(baseLoan);
    const id = created.body.id;
    expect(created.body.lastPaymentConfirmedAt).toBeNull();

    const crossAttempt = await request(app)
      .patch(`/loans/${id}/confirm-payment`)
      .set("Authorization", `Bearer ${userB.token}`);
    expect(crossAttempt.status).toBe(404);

    const res = await request(app).patch(`/loans/${id}/confirm-payment`).set("Authorization", `Bearer ${userA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.lastPaymentConfirmedAt).not.toBeNull();
  });

  it("foreclose stamps foreclosedAt, is ownership-checked, and the loan stays active/visible", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const created = await request(app).post("/loans").set("Authorization", `Bearer ${userA.token}`).send(baseLoan);
    const id = created.body.id;
    expect(created.body.foreclosedAt).toBeNull();

    const crossAttempt = await request(app).patch(`/loans/${id}/foreclose`).set("Authorization", `Bearer ${userB.token}`);
    expect(crossAttempt.status).toBe(404);

    const res = await request(app).patch(`/loans/${id}/foreclose`).set("Authorization", `Bearer ${userA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.foreclosedAt).not.toBeNull();
    expect(res.body.active).toBe(true);

    const list = await request(app).get("/loans").set("Authorization", `Bearer ${userA.token}`);
    expect(list.body.find((l: any) => l.id === id)).toBeTruthy();
  });

  it("stores part-payments cleaned: bad rows dropped, sorted by date, notes trimmed", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/loans")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        ...baseLoan,
        prepayments: [
          { date: "2025-06-10", amount: 200000, note: "  bonus  " },
          { date: "2025-02-30", amount: 5000 }, // not a real date
          { date: "2025-01-15", amount: -1 }, // non-positive
          { date: "2024-12-01", amount: 50000.555 },
          "junk",
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.prepayments).toEqual([
      { date: "2024-12-01", amount: 50000.56 },
      { date: "2025-06-10", amount: 200000, note: "bonus" },
    ]);
  });

  it("rejects prepayments that aren't a list", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/loans")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ ...baseLoan, prepayments: { date: "2025-01-01", amount: 1 } });
    expect(res.status).toBe(400);
  });

  it("PUT updates part-payments and ignores fields outside the allowlist", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const created = await request(app).post("/loans").set("Authorization", `Bearer ${user.token}`).send(baseLoan);
    const id = created.body.id;

    const res = await request(app)
      .put(`/loans/${id}`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        ...baseLoan,
        bankName: "HDFC Ltd",
        prepayments: [{ date: "2025-03-01", amount: 100000 }],
        // None of these may be written through PUT, and unknown keys must not 500.
        active: false,
        foreclosedAt: "2025-01-01T00:00:00.000Z",
        userId: "someone-else",
        notAColumn: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.bankName).toBe("HDFC Ltd");
    expect(res.body.prepayments).toEqual([{ date: "2025-03-01", amount: 100000 }]);
    expect(res.body.active).toBe(true);
    expect(res.body.foreclosedAt).toBeNull();
    expect(res.body.userId).toBe(user.userId);

    // An empty list clears them.
    const cleared = await request(app)
      .put(`/loans/${id}`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ prepayments: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.prepayments).toEqual([]);
  });

  it("PUT can't touch another user's loan", async () => {
    const owner = await createAnonymousUser();
    const other = await createAnonymousUser();
    createdUserIds.push(owner.userId, other.userId);
    const created = await request(app).post("/loans").set("Authorization", `Bearer ${owner.token}`).send(baseLoan);
    const res = await request(app)
      .put(`/loans/${created.body.id}`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ prepayments: [{ date: "2025-03-01", amount: 1 }] });
    expect(res.status).toBe(404);
  });
});
