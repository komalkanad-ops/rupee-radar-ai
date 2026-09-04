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

describe("Changelog (/changelog)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.changelogEntry.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("GET /changelog is public", async () => {
    const res = await request(app).get("/changelog");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /changelog rejects a non-admin caller", async () => {
    const res = await request(app).post("/changelog").send({ version: "9.9.9", releaseDate: "2026-01-01", platforms: ["android"], highlights: [{ type: "FEATURE", text: "x" }] });
    expect(res.status).toBe(401);
  });

  it("admin can create an entry, it's readable publicly, filterable by platform, and rejects a duplicate version", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const version = `test-${Date.now()}`;
    const createRes = await request(app)
      .post("/changelog")
      .set("Authorization", `Bearer ${token}`)
      .send({
        version,
        releaseDate: "2026-08-22",
        platforms: ["android", "backend"],
        summary: "Test release",
        highlights: [{ type: "FEATURE", platform: "android", text: "Added a thing" }],
      });
    expect(createRes.status).toBe(201);
    createdIds.push(createRes.body.id);

    const dupRes = await request(app)
      .post("/changelog")
      .set("Authorization", `Bearer ${token}`)
      .send({ version, releaseDate: "2026-08-22", platforms: ["android"], highlights: [{ type: "FEATURE", text: "dup" }] });
    expect(dupRes.status).toBe(409);

    const listRes = await request(app).get(`/changelog?platform=android`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((e: any) => e.version === version)).toBe(true);

    const webFilterRes = await request(app).get(`/changelog?platform=web`);
    expect(webFilterRes.body.some((e: any) => e.version === version)).toBe(false);

    const patchRes = await request(app)
      .patch(`/changelog/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ summary: "Updated summary" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.summary).toBe("Updated summary");
  });

  it("POST /changelog rejects an invalid highlight type", async () => {
    const token = await adminToken();
    if (!token) return;
    const res = await request(app)
      .post("/changelog")
      .set("Authorization", `Bearer ${token}`)
      .send({ version: `bad-${Date.now()}`, releaseDate: "2026-08-22", platforms: ["web"], highlights: [{ type: "BOGUS", text: "x" }] });
    expect(res.status).toBe(400);
  });
});
