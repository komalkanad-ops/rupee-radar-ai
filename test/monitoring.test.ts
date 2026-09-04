import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@rupeeradarai.com";
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "changeme-admin";

async function adminToken(): Promise<string> {
  const res = await request(app).post("/auth/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.body.token;
}

describe("Monitoring (/admin/monitoring)", () => {
  it("every route requires an admin token", async () => {
    expect((await request(app).get("/admin/monitoring/status")).status).toBe(401);
    expect((await request(app).get("/admin/monitoring/issues")).status).toBe(401);
    expect((await request(app).get("/admin/monitoring/issues/abc")).status).toBe(401);
    expect((await request(app).post("/admin/monitoring/issues/abc/resolve")).status).toBe(401);
  });

  it("GET /status returns configured=false (not 500) when SENTRY_API_TOKEN is unset", async () => {
    const token = await adminToken();
    if (!token) return;
    if (process.env.SENTRY_API_TOKEN) return; // configured here — can't exercise the unconfigured gate

    const res = await request(app).get("/admin/monitoring/status").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body).toHaveProperty("dsnPresent");
    expect(res.body.sentryMonitor).toHaveProperty("webUrl");
  });

  it("GET /issues returns { configured:false, issues:[] } (not 500) when unconfigured", async () => {
    const token = await adminToken();
    if (!token) return;
    if (process.env.SENTRY_API_TOKEN) return;

    const res = await request(app).get("/admin/monitoring/issues").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, issues: [] });
  });

  it("POST /issues/:id/resolve 501s cleanly when unconfigured", async () => {
    const token = await adminToken();
    if (!token) return;
    if (process.env.SENTRY_API_TOKEN) return;

    const res = await request(app)
      .post("/admin/monitoring/issues/123/resolve")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(501);
  });
});
