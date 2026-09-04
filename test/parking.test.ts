import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Parking tickets (/parking)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.parkingTicket.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("creates a ticket with userId always taken from the token, never the body", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/parking")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        userId: "someone-else",
        location: "FC Road, Pune",
        vehicleNumber: "MH12AB1234",
        amount: 500,
        issuedDate: "2026-08-20T00:00:00.000Z",
        dueDate: "2026-09-05T00:00:00.000Z",
      });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(user.userId);
    expect(res.body.status).toBe("UNPAID");
    expect(res.body.location).toBe("FC Road, Pune");
  });

  it("lists only the caller's own active tickets", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    await request(app).post("/parking").set("Authorization", `Bearer ${userA.token}`)
      .send({ location: "MG Road", amount: 200, issuedDate: "2026-08-01T00:00:00.000Z" });
    await request(app).post("/parking").set("Authorization", `Bearer ${userB.token}`)
      .send({ location: "Other user's spot", amount: 100, issuedDate: "2026-08-01T00:00:00.000Z" });

    const res = await request(app).get("/parking").set("Authorization", `Bearer ${userA.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].location).toBe("MG Road");
  });

  it("marking PAID sets paidAt; a second token can't touch another user's ticket", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const created = await request(app).post("/parking").set("Authorization", `Bearer ${userA.token}`)
      .send({ location: "JM Road", amount: 700, issuedDate: "2026-08-10T00:00:00.000Z" });
    const id = created.body.id;

    const crossUser = await request(app).patch(`/parking/${id}/status`)
      .set("Authorization", `Bearer ${userB.token}`).send({ status: "PAID" });
    expect(crossUser.status).toBe(404);

    const paid = await request(app).patch(`/parking/${id}/status`)
      .set("Authorization", `Bearer ${userA.token}`).send({ status: "PAID" });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("PAID");
    expect(paid.body.paidAt).not.toBeNull();

    const bad = await request(app).patch(`/parking/${id}/status`)
      .set("Authorization", `Bearer ${userA.token}`).send({ status: "BOGUS" });
    expect(bad.status).toBe(400);
  });

  it("accepts a PARKING/TOLL kind and rejects anything else; lists newest spend first", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const bad = await request(app).post("/parking").set("Authorization", `Bearer ${user.token}`)
      .send({ kind: "FINE", location: "x", amount: 10, issuedDate: "2026-08-01T00:00:00.000Z" });
    expect(bad.status).toBe(400);

    await request(app).post("/parking").set("Authorization", `Bearer ${user.token}`)
      .send({ kind: "PARKING", location: "Older", amount: 40, issuedDate: "2026-08-01T00:00:00.000Z" });
    const toll = await request(app).post("/parking").set("Authorization", `Bearer ${user.token}`)
      .send({ kind: "TOLL", location: "Khalapur Plaza", amount: 120, issuedDate: "2026-08-20T00:00:00.000Z" });
    expect(toll.status).toBe(201);
    expect(toll.body.kind).toBe("TOLL");

    const list = await request(app).get("/parking").set("Authorization", `Bearer ${user.token}`);
    expect(list.body[0].location).toBe("Khalapur Plaza"); // newest issuedDate first
  });

  it("delete is a soft delete — the ticket drops out of the list but the row stays", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const created = await request(app).post("/parking").set("Authorization", `Bearer ${user.token}`)
      .send({ location: "Baner", amount: 300, issuedDate: "2026-08-15T00:00:00.000Z" });
    const id = created.body.id;

    const del = await request(app).delete(`/parking/${id}`).set("Authorization", `Bearer ${user.token}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/parking").set("Authorization", `Bearer ${user.token}`);
    expect(list.body.find((t: any) => t.id === id)).toBeUndefined();

    const row = await prisma.parkingTicket.findUnique({ where: { id } });
    expect(row?.active).toBe(false);
  });
});
