import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

async function grantPro(token: string) {
  await request(app)
    .post("/billing/redeem-test-code")
    .set("Authorization", `Bearer ${token}`)
    .send({ code: process.env.PRO_TEST_REDEEM_CODE ?? "" });
}

describe("Household Vault (/household)", () => {
  const createdUserIds: string[] = [];
  const createdHouseholdIds: string[] = [];
  const originalCode = process.env.PRO_TEST_REDEEM_CODE;

  beforeAll(() => {
    process.env.PRO_TEST_REDEEM_CODE = "TEST-CODE-HOUSEHOLD";
  });

  afterAll(async () => {
    process.env.PRO_TEST_REDEEM_CODE = originalCode;
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.householdMember.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("creates a household and joins via invite code", async () => {
    const owner = await createAnonymousUser();
    const member = await createAnonymousUser();
    createdUserIds.push(owner.userId, member.userId);
    await grantPro(owner.token);
    await grantPro(member.token);

    const created = await request(app).post("/household").set("Authorization", `Bearer ${owner.token}`).send({ name: "The Jadhavs" });
    expect(created.status).toBe(201);
    createdHouseholdIds.push(created.body.id);

    const joined = await request(app)
      .post("/household/join")
      .set("Authorization", `Bearer ${member.token}`)
      .send({ inviteCode: created.body.inviteCode });
    expect(joined.status).toBe(201);
  });

  it("GET /spend pools grocery/utility totals only for opted-in members, hiding the rest", async () => {
    const owner = await createAnonymousUser();
    const member = await createAnonymousUser();
    createdUserIds.push(owner.userId, member.userId);
    await grantPro(owner.token);
    await grantPro(member.token);

    const created = await request(app).post("/household").set("Authorization", `Bearer ${owner.token}`).send({ name: "Spend Test" });
    createdHouseholdIds.push(created.body.id);
    await request(app).post("/household/join").set("Authorization", `Bearer ${member.token}`).send({ inviteCode: created.body.inviteCode });

    const month = new Date().toISOString().slice(0, 7);
    const txnDate = new Date(`${month}-15T00:00:00.000Z`);
    await prisma.smsTransaction.create({
      data: { userId: owner.userId, rawSmsHash: `owner-groceries-${Date.now()}`, amount: 2000, category: "groceries", txnDate },
    });
    await prisma.smsTransaction.create({
      data: { userId: owner.userId, rawSmsHash: `owner-dining-${Date.now()}`, amount: 5000, category: "dining", txnDate },
    });
    await prisma.smsTransaction.create({
      data: { userId: member.userId, rawSmsHash: `member-groceries-${Date.now()}`, amount: 1500, category: "groceries", txnDate },
    });

    // Owner opts in, member does not.
    await request(app)
      .patch("/household/spend-sharing")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ householdId: created.body.id, enabled: true });

    const res = await request(app).get(`/household/spend?month=${month}`).set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual(["groceries", "utilities"]);
    expect(res.body.total.groceries).toBe(2000); // only the opted-in owner's groceries, not member's or owner's dining
    expect(res.body.total.utilities).toBe(0);

    // Members are identified only by `isSelf` + display name — never a raw user id / email / phone.
    const ownerRow = res.body.members.find((m: any) => m.isSelf === true);
    const memberRow = res.body.members.find((m: any) => m.isSelf === false);
    expect(res.body.members.every((m: any) => m.userId === undefined && m.email === undefined)).toBe(true);
    expect(ownerRow.hidden).toBe(false);
    expect(ownerRow.byCategory.groceries).toBe(2000);
    expect(ownerRow.byCategory.dining).toBeUndefined(); // never leaks a non-shared category
    expect(memberRow.hidden).toBe(true);
    expect(memberRow.byCategory).toBeNull();
  });

  it("a non-member cannot toggle spend-sharing for someone else's household", async () => {
    const owner = await createAnonymousUser();
    const outsider = await createAnonymousUser();
    createdUserIds.push(owner.userId, outsider.userId);
    await grantPro(owner.token);
    await grantPro(outsider.token);

    const created = await request(app).post("/household").set("Authorization", `Bearer ${owner.token}`).send({ name: "Private" });
    createdHouseholdIds.push(created.body.id);

    const res = await request(app)
      .patch("/household/spend-sharing")
      .set("Authorization", `Bearer ${outsider.token}`)
      .send({ householdId: created.body.id, enabled: true });
    // The outsider has no membership row, so the Prisma update misses (P2025). The R6 error
    // middleware now maps that to a 404 rather than leaking a 500 (+ a Sentry event) for what is a
    // routine "not a member". The security property is unchanged — the non-member still can't toggle.
    expect(res.status).toBe(404);
  });
});
