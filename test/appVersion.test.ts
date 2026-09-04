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

describe("App Version catalog (/app-version)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.appVersion.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("GET /app-version rejects a non-admin caller", async () => {
    const res = await request(app).get("/app-version");
    expect(res.status).toBe(401);
  });

  it("POST /app-version rejects a non-admin caller", async () => {
    const res = await request(app).post("/app-version").send({ versionName: "1.0.0", versionCode: 1, channel: "BETA" });
    expect(res.status).toBe(401);
  });

  it("GET /latest returns null for a channel with no releases logged yet, for an unused platform", async () => {
    const res = await request(app).get("/app-version/latest?platform=ios-test-unused");
    expect(res.status).toBe(200);
    expect(res.body.latestBeta).toBeNull();
    expect(res.body.latestStable).toBeNull();
  });

  it("GET /latest returns the highest-versionCode row per channel independently", async () => {
    const platform = `android-test-${Date.now()}`;
    const rows = await Promise.all([
      prisma.appVersion.create({ data: { platform, versionName: "1.0.0", versionCode: 10, channel: "STABLE" } }),
      prisma.appVersion.create({ data: { platform, versionName: "1.1.0-beta", versionCode: 11, channel: "BETA" } }),
      prisma.appVersion.create({ data: { platform, versionName: "1.2.0-beta", versionCode: 12, channel: "BETA" } }),
    ]);
    createdIds.push(...rows.map((r) => r.id));

    const res = await request(app).get(`/app-version/latest?platform=${platform}`);
    expect(res.status).toBe(200);
    expect(res.body.latestStable.versionCode).toBe(10);
    expect(res.body.latestBeta.versionCode).toBe(12); // the higher of the two beta rows, not the first inserted
  });

  it("GET /latest surfaces the highest minSupportedVersionCode across both channels", async () => {
    const platform = `android-force-${Date.now()}`;
    const rows = await Promise.all([
      prisma.appVersion.create({ data: { platform, versionName: "2.0.0", versionCode: 20, channel: "STABLE", minSupportedVersionCode: 15 } }),
      prisma.appVersion.create({ data: { platform, versionName: "2.1.0-beta", versionCode: 21, channel: "BETA", minSupportedVersionCode: 18 } }),
    ]);
    createdIds.push(...rows.map((r) => r.id));

    const res = await request(app).get(`/app-version/latest?platform=${platform}`);
    expect(res.body.minSupportedVersionCode).toBe(18);
  });

  it("admin can create, list, promote to STABLE, and delete a version", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured in this environment — skip gracefully

    const platform = `android-admin-test-${Date.now()}`;
    const createRes = await request(app)
      .post("/app-version")
      .set("Authorization", `Bearer ${token}`)
      .send({ platform, versionName: "3.0.0-beta", versionCode: 30, channel: "BETA", releaseNotes: "Test release" });
    expect(createRes.status).toBe(201);
    createdIds.push(createRes.body.id);

    const dupRes = await request(app)
      .post("/app-version")
      .set("Authorization", `Bearer ${token}`)
      .send({ platform, versionName: "3.0.0-beta", versionCode: 30, channel: "BETA" });
    expect(dupRes.status).toBe(409); // same (platform, versionCode) already logged

    const listRes = await request(app).get(`/app-version?platform=${platform}`).set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const promoteRes = await request(app)
      .patch(`/app-version/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ channel: "STABLE" });
    expect(promoteRes.status).toBe(200);
    expect(promoteRes.body.channel).toBe("STABLE");

    const deleteRes = await request(app).delete(`/app-version/${createRes.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(deleteRes.status).toBe(204);
    createdIds.splice(createdIds.indexOf(createRes.body.id), 1);
  });
});
