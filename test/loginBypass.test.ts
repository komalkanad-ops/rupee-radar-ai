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

describe("Login bypass (/admin/login-bypass)", () => {
  const createdPhones: string[] = [];

  afterAll(async () => {
    await prisma.loginBypassEntry.deleteMany({ where: { phone: { in: createdPhones } } });
  });

  it("rejects all four routes from a non-admin caller", async () => {
    expect((await request(app).get("/admin/login-bypass")).status).toBe(401);
    expect((await request(app).post("/admin/login-bypass").send({ phone: "+911234567890" })).status).toBe(401);
    expect((await request(app).patch("/admin/login-bypass/x").send({ enabled: false })).status).toBe(401);
    expect((await request(app).delete("/admin/login-bypass/x")).status).toBe(401);
  });

  it("full admin flow: create -> list -> toggle -> delete", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const phone = `+91900000${Date.now() % 10000}`;
    createdPhones.push(phone);

    const created = await request(app)
      .post("/admin/login-bypass")
      .set("Authorization", `Bearer ${token}`)
      .send({ phone, note: "test tester" });
    expect(created.status).toBe(201);
    expect(created.body.enabled).toBe(true);
    expect(created.body.phone).toBe(phone);

    const list = await request(app).get("/admin/login-bypass").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.find((e: any) => e.id === created.body.id)).toBeTruthy();

    const toggled = await request(app)
      .patch(`/admin/login-bypass/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });
    expect(toggled.status).toBe(200);
    expect(toggled.body.enabled).toBe(false);

    const deleted = await request(app).delete(`/admin/login-bypass/${created.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(204);
    const listAfter = await request(app).get("/admin/login-bypass").set("Authorization", `Bearer ${token}`);
    expect(listAfter.body.find((e: any) => e.id === created.body.id)).toBeUndefined();
  });

  it("re-adding a phone re-enables it (upsert, not a duplicate)", async () => {
    const token = await adminToken();
    if (!token) return;

    const phone = `+91900001${Date.now() % 10000}`;
    createdPhones.push(phone);

    const first = await request(app).post("/admin/login-bypass").set("Authorization", `Bearer ${token}`).send({ phone });
    await request(app).patch(`/admin/login-bypass/${first.body.id}`).set("Authorization", `Bearer ${token}`).send({ enabled: false });

    const reAdded = await request(app).post("/admin/login-bypass").set("Authorization", `Bearer ${token}`).send({ phone });
    expect(reAdded.status).toBe(201);
    expect(reAdded.body.id).toBe(first.body.id);
    expect(reAdded.body.enabled).toBe(true);
  });

  it("POST /phone/request-otp discloses devCode for a bypass-enabled phone even when NODE_ENV=production", async () => {
    const token = await adminToken();
    if (!token) return;

    const phone = `+91900002${Date.now() % 10000}`;
    createdPhones.push(phone);
    await request(app).post("/admin/login-bypass").set("Authorization", `Bearer ${token}`).send({ phone });

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app).post("/auth/phone/request-otp").send({ phone });
      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(true);
      expect(typeof res.body.devCode).toBe("string");
      expect(res.body.devCode).toHaveLength(6);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("POST /phone/request-otp does NOT disclose devCode for a non-bypassed phone when NODE_ENV=production", async () => {
    const phone = `+91900003${Date.now() % 10000}`; // deliberately never added to the bypass list

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app).post("/auth/phone/request-otp").send({ phone });
      expect(res.status).toBe(200);
      expect(res.body.devCode).toBeUndefined();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
