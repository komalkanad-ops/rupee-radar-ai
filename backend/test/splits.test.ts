import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

const validBody = (over: Record<string, unknown> = {}) => ({
  title: "Goa trip dinner",
  totalAmount: 1500,
  paidBy: "Me",
  expenseDate: "2026-09-20T18:30:00.000Z",
  note: "Beach shack",
  participants: [
    { name: "Me", share: 500, settled: true },
    { name: "Ravi", share: 500, settled: false },
    { name: "Priya", share: 500, settled: false },
  ],
  ...over,
});

describe("Splits (/splits)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.splitExpense.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  async function newUser() {
    const u = await createAnonymousUser();
    createdUserIds.push(u.userId);
    return u;
  }

  const post = (token: string, body: unknown) =>
    request(app).post("/splits").set("Authorization", `Bearer ${token}`).send(body as object);

  describe("auth", () => {
    it("every route requires a token", async () => {
      expect((await request(app).get("/splits")).status).toBe(401);
      expect((await request(app).post("/splits").send(validBody())).status).toBe(401);
      expect((await request(app).put("/splits/x").send(validBody())).status).toBe(401);
      expect((await request(app).delete("/splits/x")).status).toBe(401);
    });
  });

  describe("create + read", () => {
    it("creates a split, takes userId from the token, and returns participants as a parsed array", async () => {
      const user = await newUser();
      const res = await post(user.token, validBody({ userId: "someone-else", active: false }));

      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(user.userId);
      expect(res.body.active).toBe(true);
      expect(res.body.title).toBe("Goa trip dinner");
      expect(res.body.totalAmount).toBe(1500);
      expect(res.body.paidBy).toBe("Me");
      expect(res.body.note).toBe("Beach shack");
      expect(res.body.participants).toEqual([
        { name: "Me", share: 500, settled: true },
        { name: "Ravi", share: 500, settled: false },
        { name: "Priya", share: 500, settled: false },
      ]);
      expect(JSON.parse(res.body.participantsJson)).toEqual(res.body.participants);
    });

    it("stores paidBy in the participant's own spelling, matched case-insensitively", async () => {
      const user = await newUser();
      const res = await post(user.token, validBody({ paidBy: "  rAVI " }));
      expect(res.status).toBe(201);
      expect(res.body.paidBy).toBe("Ravi");
    });

    it("trims the title and participant names, and a blank note becomes null", async () => {
      const user = await newUser();
      const res = await post(
        user.token,
        validBody({
          title: "  Lunch  ",
          note: "   ",
          paidBy: "Me",
          participants: [
            { name: " Me ", share: 100, settled: true },
            { name: " Ravi ", share: 100, settled: false },
          ],
          totalAmount: 200,
        }),
      );
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Lunch");
      expect(res.body.note).toBeNull();
      expect(res.body.participants.map((p: any) => p.name)).toEqual(["Me", "Ravi"]);
    });

    it("accepts a client-supplied id and rejects reuse of it with 409", async () => {
      const user = await newUser();
      const id = `split_${Date.now()}`;
      const first = await post(user.token, validBody({ id }));
      expect(first.status).toBe(201);
      expect(first.body.id).toBe(id);

      const again = await post(user.token, validBody({ id }));
      expect(again.status).toBe(409);
    });

    it("does not let another user claim an existing id", async () => {
      const a = await newUser();
      const b = await newUser();
      const id = `split_owned_${Date.now()}`;
      await post(a.token, validBody({ id }));
      const res = await post(b.token, validBody({ id, title: "Hijack" }));
      expect(res.status).toBe(409);
      const row = await prisma.splitExpense.findUnique({ where: { id } });
      expect(row?.userId).toBe(a.userId);
      expect(row?.title).toBe("Goa trip dinner");
    });

    it("lists only the caller's own active splits, newest expenseDate first", async () => {
      const a = await newUser();
      const b = await newUser();
      await post(a.token, validBody({ title: "Older", expenseDate: "2026-01-01T00:00:00.000Z" }));
      await post(a.token, validBody({ title: "Newer", expenseDate: "2026-06-01T00:00:00.000Z" }));
      await post(b.token, validBody({ title: "Someone else's" }));

      const res = await request(app).get("/splits").set("Authorization", `Bearer ${a.token}`);
      expect(res.status).toBe(200);
      expect(res.body.map((s: any) => s.title)).toEqual(["Newer", "Older"]);
      expect(res.body[0].participants).toHaveLength(3);
    });
  });

  describe("update", () => {
    it("PUT replaces fields and re-validates", async () => {
      const user = await newUser();
      const created = await post(user.token, validBody());
      const res = await request(app)
        .put(`/splits/${created.body.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ title: "Renamed", note: null });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Renamed");
      expect(res.body.note).toBeNull();
      expect(res.body.participants).toHaveLength(3);
    });

    it("a partial update can toggle one participant's settled flag", async () => {
      const user = await newUser();
      const created = await post(user.token, validBody());
      const participants = created.body.participants.map((p: any) => (p.name === "Ravi" ? { ...p, settled: true } : p));
      const res = await request(app)
        .put(`/splits/${created.body.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ participants });
      expect(res.status).toBe(200);
      expect(res.body.participants.find((p: any) => p.name === "Ravi").settled).toBe(true);
      expect(res.body.participants.find((p: any) => p.name === "Priya").settled).toBe(false);
    });

    it("a partial update that breaks consistency with stored values is rejected (total no longer matches shares)", async () => {
      const user = await newUser();
      const created = await post(user.token, validBody());
      const res = await request(app)
        .put(`/splits/${created.body.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ totalAmount: 9999 });
      expect(res.status).toBe(400);
      const row = await prisma.splitExpense.findUnique({ where: { id: created.body.id } });
      expect(row?.totalAmount).toBe(1500);
    });

    it("removing the current payer from the participants is rejected", async () => {
      const user = await newUser();
      const created = await post(user.token, validBody());
      const res = await request(app)
        .put(`/splits/${created.body.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({
          totalAmount: 1000,
          participants: [
            { name: "Ravi", share: 500, settled: false },
            { name: "Priya", share: 500, settled: false },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/paidBy/);
    });

    it("cannot change userId, id, or active through the body", async () => {
      const user = await newUser();
      const created = await post(user.token, validBody());
      const res = await request(app)
        .put(`/splits/${created.body.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ userId: "someone-else", id: "other-id", active: false, title: "Still mine" });
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(user.userId);
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.active).toBe(true);
    });
  });

  describe("ownership isolation", () => {
    it("another user's PUT and DELETE get 404 and the row is untouched", async () => {
      const owner = await newUser();
      const other = await newUser();
      const created = await post(owner.token, validBody());
      const id = created.body.id;

      const put = await request(app).put(`/splits/${id}`).set("Authorization", `Bearer ${other.token}`).send({ title: "Hijacked" });
      expect(put.status).toBe(404);
      const del = await request(app).delete(`/splits/${id}`).set("Authorization", `Bearer ${other.token}`);
      expect(del.status).toBe(404);

      const row = await prisma.splitExpense.findUnique({ where: { id } });
      expect(row?.title).toBe("Goa trip dinner");
      expect(row?.active).toBe(true);
    });

    it("a non-existent id is a 404, not a 500", async () => {
      const user = await newUser();
      expect((await request(app).put("/splits/nope").set("Authorization", `Bearer ${user.token}`).send(validBody())).status).toBe(404);
      expect((await request(app).delete("/splits/nope").set("Authorization", `Bearer ${user.token}`)).status).toBe(404);
    });
  });

  describe("soft delete", () => {
    it("DELETE returns 204, hides the row from GET, and keeps it in the table as inactive", async () => {
      const user = await newUser();
      const created = await post(user.token, validBody());
      const id = created.body.id;

      const del = await request(app).delete(`/splits/${id}`).set("Authorization", `Bearer ${user.token}`);
      expect(del.status).toBe(204);

      const list = await request(app).get("/splits").set("Authorization", `Bearer ${user.token}`);
      expect(list.body.find((s: any) => s.id === id)).toBeUndefined();

      const row = await prisma.splitExpense.findUnique({ where: { id } });
      expect(row).not.toBeNull();
      expect(row?.active).toBe(false);
    });

    it("a soft-deleted split cannot be edited back to life", async () => {
      const user = await newUser();
      const created = await post(user.token, validBody());
      await request(app).delete(`/splits/${created.body.id}`).set("Authorization", `Bearer ${user.token}`);
      const put = await request(app).put(`/splits/${created.body.id}`).set("Authorization", `Bearer ${user.token}`).send({ title: "Zombie" });
      expect(put.status).toBe(404);
    });
  });

  describe("validation", () => {
    const p = (name: string, share: number, settled = false) => ({ name, share, settled });
    const two = [p("Me", 50, true), p("Ravi", 50)];

    const cases: [string, Record<string, unknown>][] = [
      ["missing title", { title: undefined }],
      ["blank title", { title: "   " }],
      ["non-string title", { title: 42 }],
      ["title over 100 chars", { title: "x".repeat(101) }],
      ["zero total", { totalAmount: 0, participants: [p("Me", 0, true), p("Ravi", 0)] }],
      ["negative total", { totalAmount: -100 }],
      ["numeric-string total", { totalAmount: "100" }],
      ["total over 1e9", { totalAmount: 2e9, participants: [p("Me", 1e9, true), p("Ravi", 1e9)] }],
      ["missing total", { totalAmount: undefined }],
      ["note over 500 chars", { note: "n".repeat(501) }],
      ["non-string note", { note: 5 }],
      ["missing expenseDate", { expenseDate: undefined }],
      ["invalid expenseDate", { expenseDate: "not-a-date" }],
      ["boolean expenseDate", { expenseDate: true }],
      ["missing participants", { participants: undefined }],
      ["participants not an array", { participants: "Me,Ravi" }],
      ["only one participant", { totalAmount: 100, participants: [p("Me", 100, true)] }],
      ["21 participants", { totalAmount: 21, participants: Array.from({ length: 21 }, (_, i) => p(i === 0 ? "Me" : `P${i}`, 1, i === 0)) }],
      ["participant that is not an object", { participants: ["Me", "Ravi"] }],
      ["participant with blank name", { participants: [p("Me", 50, true), p("  ", 50)] }],
      ["participant name over 40 chars", { participants: [p("Me", 50, true), p("x".repeat(41), 50)] }],
      ["participant with negative share", { totalAmount: 100, participants: [p("Me", 150, true), p("Ravi", -50)] }],
      ["participant with string share", { participants: [p("Me", 50, true), { name: "Ravi", share: "50", settled: false }] }],
      ["participant share over 1e9", { totalAmount: 1e9, participants: [p("Me", 1e9, true), p("Ravi", 2e9)] }],
      ["participant missing settled", { participants: [p("Me", 50, true), { name: "Ravi", share: 50 }] }],
      ["participant with string settled", { participants: [p("Me", 50, true), { name: "Ravi", share: 50, settled: "no" }] }],
      ["duplicate names differing only by case", { participants: [p("Ravi", 50, true), p("ravi", 50)], paidBy: "Ravi" }],
      ["duplicate names differing only by whitespace", { participants: [p("Ravi", 50, true), p(" Ravi ", 50)], paidBy: "Ravi" }],
      ["paidBy not a participant", { totalAmount: 100, paidBy: "Stranger", participants: two }],
      ["missing paidBy", { totalAmount: 100, paidBy: undefined, participants: two }],
      ["shares summing more than a rupee under the total", { totalAmount: 100, participants: [p("Me", 49, true), p("Ravi", 49.5)] }],
      ["shares summing more than a rupee over the total", { totalAmount: 100, participants: [p("Me", 51, true), p("Ravi", 50.5)] }],
      ["client id with illegal characters", { id: "bad id!" }],
      ["client id over 40 chars", { id: "a".repeat(41) }],
      ["client id that is not a string", { id: 12345 }],
    ];

    for (const [label, over] of cases) {
      it(`rejects ${label} with 400`, async () => {
        const user = await newUser();
        const body: Record<string, unknown> = { ...validBody({ totalAmount: 100, participants: two }), ...over };
        for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
        const res = await post(user.token, body);
        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe("string");
        expect(await prisma.splitExpense.count({ where: { userId: user.userId } })).toBe(0);
      });
    }

    it("accepts shares that differ from the total by less than a rupee (rounding slack)", async () => {
      const user = await newUser();
      const res = await post(user.token, validBody({ totalAmount: 100, participants: [p("Me", 33.33, true), p("Ravi", 33.33), p("Priya", 33.33)] }));
      expect(res.status).toBe(201);
    });

    it("accepts a zero share for someone who isn't part of the bill", async () => {
      const user = await newUser();
      const res = await post(user.token, validBody({ totalAmount: 100, participants: [p("Me", 100, true), p("Ravi", 0, true)] }));
      expect(res.status).toBe(201);
    });

    it("accepts the boundary sizes (2 and 20 participants, 100-char title, 500-char note)", async () => {
      const user = await newUser();
      const twenty = Array.from({ length: 20 }, (_, i) => p(i === 0 ? "Me" : `P${i}`, 5, i === 0));
      const res = await post(user.token, validBody({ title: "t".repeat(100), note: "n".repeat(500), totalAmount: 100, participants: twenty }));
      expect(res.status).toBe(201);
      expect(res.body.participants).toHaveLength(20);
    });
  });

  describe("account deletion", () => {
    it("DELETE /auth/me removes the user's split rows (including soft-deleted ones) without an FK error", async () => {
      const user = await createAnonymousUser();
      const live = await post(user.token, validBody());
      const gone = await post(user.token, validBody({ title: "Deleted one" }));
      await request(app).delete(`/splits/${gone.body.id}`).set("Authorization", `Bearer ${user.token}`);
      expect(await prisma.splitExpense.count({ where: { userId: user.userId } })).toBe(2);

      const res = await request(app).delete("/auth/me").set("Authorization", `Bearer ${user.token}`);
      expect(res.status).toBe(204);

      expect(await prisma.splitExpense.count({ where: { userId: user.userId } })).toBe(0);
      expect(await prisma.splitExpense.findUnique({ where: { id: live.body.id } })).toBeNull();
      expect(await prisma.user.findUnique({ where: { id: user.userId } })).toBeNull();
    });
  });
});
