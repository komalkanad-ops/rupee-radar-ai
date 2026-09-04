import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("credit score (sandbox scaffold, no vendor configured)", () => {
  const createdUserIds: string[] = [];
  const originalCode = process.env.PRO_TEST_REDEEM_CODE;

  beforeAll(() => {
    process.env.PRO_TEST_REDEEM_CODE = "TEST-CODE-123";
  });
  afterAll(async () => {
    process.env.PRO_TEST_REDEEM_CODE = originalCode;
    await prisma.creditScoreSnapshot.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("PRO-gates POST /credit-score/refresh", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app)
      .post("/credit-score/refresh")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ pan: "ABCDE1234F", fullName: "Test User", dateOfBirth: "1990-01-01", mobile: "9999999999" });
    expect(res.status).toBe(403);
    expect(res.body.proRequired).toBe(true);
  });

  it("501s cleanly (no orphan snapshot row) once PRO, since no bureau vendor is configured yet", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await request(app)
      .post("/billing/redeem-test-code")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "TEST-CODE-123" });

    const res = await request(app)
      .post("/credit-score/refresh")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ pan: "ABCDE1234F", fullName: "Test User", dateOfBirth: "1990-01-01", mobile: "9999999999" });
    expect(res.status).toBe(501);

    const rows = await prisma.creditScoreSnapshot.findMany({ where: { userId: user.userId } });
    expect(rows).toHaveLength(0);
  });

  it("GET /credit-score/latest returns null for a user with no fetched snapshot", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await request(app)
      .post("/billing/redeem-test-code")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ code: "TEST-CODE-123" });

    const res = await request(app)
      .get("/credit-score/latest")
      .set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});
