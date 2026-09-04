import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

describe("Mesh usage (/mesh-usage)", () => {
  it("all three routes require admin", async () => {
    const live = await request(app).get("/mesh-usage/live");
    expect(live.status).toBe(401);
    const features = await request(app).get("/mesh-usage/features");
    expect(features.status).toBe(401);
    const byUser = await request(app).get("/mesh-usage/by-user");
    expect(byUser.status).toBe(401);
  });

  it("admin can fetch the per-user breakdown", async () => {
    const token = await adminToken();
    if (!token) return;

    const res = await request(app).get("/mesh-usage/by-user").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("byUser");
    expect(Array.isArray(res.body.byUser)).toBe(true);
  });

  it("GET /mesh-usage/live 501s cleanly when MESH_ORG_ID isn't configured", async () => {
    const token = await adminToken();
    if (!token) return;
    if (process.env.MESH_ORG_ID) return; // configured in this environment — skip, can't test the gate

    const res = await request(app).get("/mesh-usage/live").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(501);
  });

  it("admin can fetch the internal per-feature breakdown", async () => {
    const token = await adminToken();
    if (!token) return;

    const res = await request(app).get("/mesh-usage/features").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("byFeature");
    expect(Array.isArray(res.body.byFeature)).toBe(true);
  });
});
