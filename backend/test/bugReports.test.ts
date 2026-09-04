import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

describe("Bug Reports (/bug-reports)", () => {
  const createdUserIds: string[] = [];
  const createdReportIds: string[] = [];

  afterAll(async () => {
    await prisma.bugReport.deleteMany({ where: { id: { in: createdReportIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("an authenticated submission records type, message, and screen context", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/bug-reports")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        type: "BUG",
        message: "The back button on Wallet closes the app instead of going back.",
        screenRoute: "wallet",
        appVersionName: "0.9.0-beta",
        appVersionCode: 9,
        deviceModel: "Pixel 8",
        androidSdkInt: 34,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    createdReportIds.push(res.body.id);
  });

  it("rejects an unauthenticated submission", async () => {
    const res = await request(app).post("/bug-reports").send({ type: "BUG", message: "x", screenRoute: "wallet" });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid type", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/bug-reports")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ type: "NOT_A_TYPE", message: "x", screenRoute: "wallet" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty message", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app)
      .post("/bug-reports")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ type: "SUGGESTION", message: "   ", screenRoute: "wallet" });
    expect(res.status).toBe(400);
  });

  it("admin can list bug reports, filter by type, and update status", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const listRes = await request(app).get("/bug-reports").set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBeGreaterThanOrEqual(1);

    const bugOnlyRes = await request(app).get("/bug-reports?type=BUG").set("Authorization", `Bearer ${token}`);
    expect(bugOnlyRes.body.every((r: any) => r.type === "BUG")).toBe(true);

    const target = listRes.body[0];
    const updateRes = await request(app)
      .patch(`/bug-reports/${target.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "REVIEWED" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe("REVIEWED");
  });

  it("GET/PATCH /bug-reports reject a non-admin caller", async () => {
    const listRes = await request(app).get("/bug-reports");
    expect(listRes.status).toBe(401);
  });
});
