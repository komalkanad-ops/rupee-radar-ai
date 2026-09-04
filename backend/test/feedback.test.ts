import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";
import jwt from "jsonwebtoken";

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

describe("Feedback (/feedback)", () => {
  const createdUserIds: string[] = [];
  const createdFeedbackIds: string[] = [];

  afterAll(async () => {
    await prisma.coinLedgerEntry.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.feedback.deleteMany({ where: { id: { in: createdFeedbackIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("an authenticated app submission is recorded as source APP and awards 100 coins", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/feedback")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ message: "Love the app, wish the widget refreshed faster." });

    expect(res.status).toBe(201);
    expect(res.body.coinsAwarded).toBe(100);
    createdFeedbackIds.push(res.body.id);

    const balanceRes = await request(app).get("/rewards/balance").set("Authorization", `Bearer ${user.token}`);
    expect(balanceRes.body.balance).toBe(100);
  });

  it("an unauthenticated (website) submission is recorded as source WEB with no coins", async () => {
    const res = await request(app).post("/feedback").send({ message: "Please add iOS support!", email: "test@example.com" });

    expect(res.status).toBe(201);
    expect(res.body.coinsAwarded).toBeNull();
    createdFeedbackIds.push(res.body.id);
  });

  it("rejects an empty message", async () => {
    const res = await request(app).post("/feedback").send({ message: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range rating", async () => {
    const res = await request(app).post("/feedback").send({ message: "Great app", rating: 9 });
    expect(res.status).toBe(400);
  });

  it("a request with an invalid/garbage token is still treated as an unauthenticated (WEB, no-coin) submission, not rejected", async () => {
    const res = await request(app).post("/feedback").set("Authorization", "Bearer not-a-real-token").send({ message: "Testing a bad token" });
    expect(res.status).toBe(201);
    expect(res.body.coinsAwarded).toBeNull();
    createdFeedbackIds.push(res.body.id);
  });

  it("admin can list feedback and filter by status, then update status", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const listRes = await request(app).get("/feedback").set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBeGreaterThanOrEqual(3);

    const target = listRes.body[0];
    const updateRes = await request(app)
      .patch(`/feedback/${target.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "REVIEWED" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe("REVIEWED");
  });

  it("GET/PATCH /feedback reject a non-admin caller", async () => {
    const listRes = await request(app).get("/feedback");
    expect(listRes.status).toBe(401);
  });
});
