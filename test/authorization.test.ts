import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

// The single most valuable test in this codebase — a regression test for the Phase 0 security fix.
// Before that fix, any endpoint would trust a client-supplied userId with no verification at all.
describe("authorization enforcement", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.recurringPayment.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("rejects a user-scoped request with no Authorization header", async () => {
    const res = await request(app).get("/recurring");
    expect(res.status).toBe(401);
  });

  it("rejects a request with a garbage token", async () => {
    const res = await request(app).get("/recurring").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("a valid token can only ever see its own user's data, even if a different userId is supplied", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const createRes = await request(app)
      .post("/recurring")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ type: "SUBSCRIPTION", name: "TestSub", amount: 199, frequency: "monthly" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.userId).toBe(userA.userId); // server derived it from the token, not the (absent) body field

    // User B's token, but User A's id smuggled into the query string — must not leak User A's data.
    const spoofRes = await request(app)
      .get(`/recurring?userId=${userA.userId}`)
      .set("Authorization", `Bearer ${userB.token}`);
    expect(spoofRes.status).toBe(200);
    expect(spoofRes.body).toEqual([]);

    const ownRes = await request(app).get("/recurring").set("Authorization", `Bearer ${userA.token}`);
    expect(ownRes.status).toBe(200);
    expect(ownRes.body).toHaveLength(1);
    expect(ownRes.body[0].name).toBe("TestSub");
  });

  it("the anonymous /auth/session path cannot mint a token for a signed-in account", async () => {
    // A real user who signed in with Google/phone — their User.id is not a secret (a household
    // member sees it, etc.), so the anonymous path must refuse to hand back a session for it.
    const signedIn = await prisma.user.create({
      data: { id: `spoof-target-${Date.now()}`, authProvider: "google", email: `t${Date.now()}@example.com` },
    });
    createdUserIds.push(signedIn.id);

    const res = await request(app)
      .post("/auth/session")
      .send({ provider: "anonymous", deviceId: signedIn.id });

    expect(res.status).toBe(409);
    expect(res.body.token).toBeUndefined();
  });

  it("blocks mutating another user's row by id even with a valid token for a different user", async () => {
    const userA = await createAnonymousUser();
    const userB = await createAnonymousUser();
    createdUserIds.push(userA.userId, userB.userId);

    const createRes = await request(app)
      .post("/recurring")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ type: "EMI", name: "CarLoan", amount: 5000, frequency: "monthly" });
    const id = createRes.body.id;

    const deleteRes = await request(app).delete(`/recurring/${id}`).set("Authorization", `Bearer ${userB.token}`);
    expect(deleteRes.status).toBe(404);

    const stillThere = await prisma.recurringPayment.findUnique({ where: { id } });
    expect(stillThere?.active).toBe(true);
  });

  it("a brand-new anonymous device completes a full write without a foreign-key error (the bug this fix also closed)", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/recurring")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ type: "SIP", name: "First write ever", amount: 1000, frequency: "monthly" });
    expect(res.status).toBe(201);
  });
});
