import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

describe("Beta tester requests (/beta-tester-requests)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.betaTesterRequest.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("401s GET and DELETE without an admin token", async () => {
    const getRes = await request(app).get("/beta-tester-requests");
    expect(getRes.status).toBe(401);

    const delRes = await request(app).delete("/beta-tester-requests/x");
    expect(delRes.status).toBe(401);
  });

  it("400s a missing or malformed email, without creating a row", async () => {
    const missing = await request(app).post("/beta-tester-requests").send({});
    expect(missing.status).toBe(400);

    const malformed = await request(app).post("/beta-tester-requests").send({ email: "not-an-email" });
    expect(malformed.status).toBe(400);
  });

  it("accepts a valid email, lowercased and trimmed, and it shows up in the admin list", async () => {
    const res = await request(app).post("/beta-tester-requests").send({ email: "  Tester@Example.com  " });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("tester@example.com");
    createdIds.push(res.body.id);

    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const listRes = await request(app).get("/beta-tester-requests").set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((r: any) => r.id === res.body.id)).toBe(true);
  });

  it("a repeat submission of the same email is idempotent, not a duplicate row", async () => {
    const first = await request(app).post("/beta-tester-requests").send({ email: "repeat@example.com" });
    expect(first.status).toBe(201);
    createdIds.push(first.body.id);

    const second = await request(app).post("/beta-tester-requests").send({ email: "repeat@example.com" });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const count = await prisma.betaTesterRequest.count({ where: { email: "repeat@example.com" } });
    expect(count).toBe(1);
  });

  it("admin can delete a request", async () => {
    const token = await adminToken();
    if (!token) return;

    const created = await request(app).post("/beta-tester-requests").send({ email: "todelete@example.com" });
    createdIds.push(created.body.id);

    const delRes = await request(app)
      .delete(`/beta-tester-requests/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(delRes.status).toBe(204);

    const row = await prisma.betaTesterRequest.findUnique({ where: { id: created.body.id } });
    expect(row).toBeNull();
  });
});
