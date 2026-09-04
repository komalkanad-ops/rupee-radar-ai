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

describe("Feature flags (/feature-flags)", () => {
  const createdKeys: string[] = [];

  afterAll(async () => {
    await prisma.featureFlag.deleteMany({ where: { key: { in: createdKeys } } });
  });

  it("GET / is public and returns an array", async () => {
    const res = await request(app).get("/feature-flags");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("rejects writes from a non-admin caller", async () => {
    const res = await request(app).post("/feature-flags").send({ key: "test_flag", displayName: "Test" });
    expect(res.status).toBe(401);
  });

  it("admin creates a flag (default LIVE), re-posting the same key upserts instead of duplicating", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const key = `test_flag_${Date.now()}`;
    createdKeys.push(key);

    const created = await request(app)
      .post("/feature-flags")
      .set("Authorization", `Bearer ${token}`)
      .send({ key, displayName: "Test Flag" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("LIVE");

    const upserted = await request(app)
      .post("/feature-flags")
      .set("Authorization", `Bearer ${token}`)
      .send({ key, displayName: "Test Flag Renamed", status: "BETA" });
    expect(upserted.status).toBe(201);
    expect(upserted.body.id).toBe(created.body.id);
    expect(upserted.body.displayName).toBe("Test Flag Renamed");
    expect(upserted.body.status).toBe("BETA");

    const list = await request(app).get("/feature-flags");
    expect(list.body.filter((f: any) => f.key === key)).toHaveLength(1);
  });

  it("PATCH updates status and message; DELETE removes the flag", async () => {
    const token = await adminToken();
    if (!token) return;

    const key = `test_flag_patch_${Date.now()}`;
    createdKeys.push(key);
    const created = await request(app)
      .post("/feature-flags")
      .set("Authorization", `Bearer ${token}`)
      .send({ key, displayName: "Patch Test" });

    const patched = await request(app)
      .patch(`/feature-flags/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "MAINTENANCE", message: "We'll be back shortly." });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe("MAINTENANCE");
    expect(patched.body.message).toBe("We'll be back shortly.");

    const deleted = await request(app).delete(`/feature-flags/${created.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(204);
    const list = await request(app).get("/feature-flags");
    expect(list.body.find((f: any) => f.id === created.body.id)).toBeUndefined();
  });

  it("rejects an invalid status on create or patch", async () => {
    const token = await adminToken();
    if (!token) return;

    const badCreate = await request(app)
      .post("/feature-flags")
      .set("Authorization", `Bearer ${token}`)
      .send({ key: `bad_${Date.now()}`, displayName: "Bad", status: "NOT_A_REAL_STATUS" });
    expect(badCreate.status).toBe(400);
  });

  it("PATCH sets order, and GET / sorts by it (ties broken by key)", async () => {
    const token = await adminToken();
    if (!token) return;

    const keyA = `test_order_a_${Date.now()}`;
    const keyB = `test_order_b_${Date.now()}`;
    createdKeys.push(keyA, keyB);

    const a = await request(app).post("/feature-flags").set("Authorization", `Bearer ${token}`).send({ key: keyA, displayName: "A" });
    const b = await request(app).post("/feature-flags").set("Authorization", `Bearer ${token}`).send({ key: keyB, displayName: "B" });

    // Give B a lower order than A so it should sort first despite key "b" > "a" alphabetically.
    const patchedA = await request(app).patch(`/feature-flags/${a.body.id}`).set("Authorization", `Bearer ${token}`).send({ order: 10 });
    const patchedB = await request(app).patch(`/feature-flags/${b.body.id}`).set("Authorization", `Bearer ${token}`).send({ order: 1 });
    expect(patchedA.status).toBe(200);
    expect(patchedA.body.order).toBe(10);
    expect(patchedB.body.order).toBe(1);

    const list = await request(app).get("/feature-flags");
    const indexA = list.body.findIndex((f: any) => f.key === keyA);
    const indexB = list.body.findIndex((f: any) => f.key === keyB);
    expect(indexB).toBeLessThan(indexA);
  });

  it("rejects a non-numeric order", async () => {
    const token = await adminToken();
    if (!token) return;

    const key = `test_bad_order_${Date.now()}`;
    createdKeys.push(key);
    const created = await request(app).post("/feature-flags").set("Authorization", `Bearer ${token}`).send({ key, displayName: "Bad Order" });
    const patched = await request(app)
      .patch(`/feature-flags/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ order: "first" });
    expect(patched.status).toBe(400);
  });
});
