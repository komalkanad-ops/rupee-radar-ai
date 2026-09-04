import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Goals (/goals)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("requires a token", async () => {
    expect((await request(app).get("/goals")).status).toBe(401);
  });

  it("rejects a goal with no name or bad target date", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };
    const bad = await request(app).post("/goals").set(auth).send({ targetAmountInr: 100000, targetDate: "not-a-date" });
    expect(bad.status).toBe(400);
  });

  it("creates, lists, updates and soft-deletes a goal", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const auth = { Authorization: `Bearer ${user.token}` };

    const create = await request(app).post("/goals").set(auth).send({
      id: "goal-test-1",
      name: "House down payment",
      kind: "house",
      targetAmountInr: 2000000,
      currentAmountInr: 250000,
      monthlyContributionInr: 40000,
      targetDate: "2030-01-01T00:00:00.000Z",
    });
    expect(create.status).toBe(201);
    expect(create.body.kind).toBe("HOUSE"); // normalized upper-case
    expect(create.body.id).toBe("goal-test-1");

    const list = await request(app).get("/goals").set(auth);
    expect(list.body).toHaveLength(1);

    const update = await request(app).put("/goals/goal-test-1").set(auth).send({
      name: "House down payment",
      kind: "HOUSE",
      targetAmountInr: 2000000,
      currentAmountInr: 500000,
      targetDate: "2030-01-01T00:00:00.000Z",
    });
    expect(update.status).toBe(200);
    expect(update.body.currentAmountInr).toBe(500000);
    expect(update.body.monthlyContributionInr).toBeNull();

    expect((await request(app).delete("/goals/goal-test-1").set(auth)).status).toBe(204);
    expect((await request(app).get("/goals").set(auth)).body).toHaveLength(0);
    // row still exists (soft delete) so a re-sync can't resurrect it
    expect(await prisma.goal.findUnique({ where: { id: "goal-test-1" } })).not.toBeNull();
  });

  it("won't let one user touch another user's goal", async () => {
    const a = await createAnonymousUser();
    const b = await createAnonymousUser();
    createdUserIds.push(a.userId, b.userId);
    await request(app).post("/goals").set({ Authorization: `Bearer ${a.token}` }).send({
      id: "goal-owned-by-a",
      name: "A's goal",
      targetAmountInr: 100000,
      targetDate: "2031-01-01T00:00:00.000Z",
    });
    const asB = await request(app).put("/goals/goal-owned-by-a").set({ Authorization: `Bearer ${b.token}` }).send({
      name: "hijack", targetAmountInr: 1, targetDate: "2031-01-01T00:00:00.000Z",
    });
    expect(asB.status).toBe(404);
  });
});
