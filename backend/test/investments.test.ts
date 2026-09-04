import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Investments (/investments)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.investment.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("requires a token", async () => {
    expect((await request(app).get("/investments")).status).toBe(401);
  });

  it("rejects a holding with no label", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const bad = await request(app)
      .post("/investments")
      .set({ Authorization: `Bearer ${user.token}` })
      .send({ investedInr: 100000 });
    expect(bad.status).toBe(400);
  });

  it("creates, lists, updates and soft-deletes a holding; normalizes kind", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };

    const create = await request(app).post("/investments").set(auth).send({
      id: "inv-test-1",
      kind: "banana", // invalid -> defaults to MUTUAL_FUND
      label: "Parag Parikh Flexi Cap",
      investedInr: 345000,
      currentValueInr: 388000,
      returnPct: 12.4,
    });
    expect(create.status).toBe(201);
    expect(create.body.kind).toBe("MUTUAL_FUND");
    expect(create.body.id).toBe("inv-test-1");

    expect((await request(app).get("/investments").set(auth)).body).toHaveLength(1);

    const update = await request(app).put("/investments/inv-test-1").set(auth).send({
      kind: "STOCKS",
      label: "Parag Parikh Flexi Cap",
      investedInr: 345000,
      currentValueInr: 400000,
    });
    expect(update.status).toBe(200);
    expect(update.body.kind).toBe("STOCKS");
    expect(update.body.currentValueInr).toBe(400000);
    expect(update.body.returnPct).toBeNull();

    expect((await request(app).delete("/investments/inv-test-1").set(auth)).status).toBe(204);
    expect((await request(app).get("/investments").set(auth)).body).toHaveLength(0);
    expect(await prisma.investment.findUnique({ where: { id: "inv-test-1" } })).not.toBeNull();
  });

  it("won't let one user touch another user's holding", async () => {
    const a = await createAnonymousUser();
    const b = await createAnonymousUser();
    createdUserIds.push(a.userId, b.userId);
    await request(app)
      .post("/investments")
      .set({ Authorization: `Bearer ${a.token}` })
      .send({ id: "inv-owned-by-a", label: "A's fund", investedInr: 100000 });
    const asB = await request(app)
      .put("/investments/inv-owned-by-a")
      .set({ Authorization: `Bearer ${b.token}` })
      .send({ label: "hijack", investedInr: 1 });
    expect(asB.status).toBe(404);
  });
});
