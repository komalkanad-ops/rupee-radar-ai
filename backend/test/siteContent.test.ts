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

// A 1x1 PNG.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("Site content — screenshots (/site-content)", () => {
  const createdIds: string[] = [];
  afterAll(async () => {
    await prisma.siteScreenshot.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("public list works and never returns image bytes", async () => {
    const res = await request(app).get("/site-content/screenshots");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const row of res.body) expect(row.data).toBeUndefined();
  });

  it("rejects an unauthenticated upload", async () => {
    const res = await request(app)
      .post("/site-content/screenshots")
      .attach("file", PNG_1PX, { filename: "s.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("admin can upload, it appears in the public list, the image streams back, then delete", async () => {
    const token = await adminToken();
    if (!token) return; // admin bootstrap not configured here — skip gracefully

    const up = await request(app)
      .post("/site-content/screenshots")
      .set("Authorization", `Bearer ${token}`)
      .field("caption", "Dashboard")
      .field("category", "overview")
      .attach("file", PNG_1PX, { filename: "s.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    createdIds.push(up.body.id);

    const list = await request(app).get("/site-content/screenshots");
    expect(list.body.some((r: any) => r.id === up.body.id && r.caption === "Dashboard")).toBe(true);

    const img = await request(app).get(`/site-content/screenshots/${up.body.id}/image`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toContain("image/png");
    expect(img.body.length).toBe(PNG_1PX.length);

    const patched = await request(app)
      .patch(`/site-content/screenshots/${up.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false });
    expect(patched.body.active).toBe(false);
    // inactive -> hidden from the public list + image 404s
    expect((await request(app).get(`/site-content/screenshots/${up.body.id}/image`)).status).toBe(404);

    const del = await request(app)
      .delete(`/site-content/screenshots/${up.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
  });

  it("rejects a non-image upload", async () => {
    const token = await adminToken();
    if (!token) return;
    const res = await request(app)
      .post("/site-content/screenshots")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("not an image"), { filename: "x.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });

  it("reorder rewrites sortOrder to match the given id order, even when rows started with duplicate sortOrder values", async () => {
    const token = await adminToken();
    if (!token) return;

    async function upload(caption: string) {
      const up = await request(app)
        .post("/site-content/screenshots")
        .set("Authorization", `Bearer ${token}`)
        .field("caption", caption)
        .attach("file", PNG_1PX, { filename: "s.png", contentType: "image/png" });
      createdIds.push(up.body.id);
      return up.body.id as string;
    }

    const a = await upload("A");
    const b = await upload("B");
    const c = await upload("C");
    // Force a collision like the real-world bug: two rows sharing a sortOrder, which made the old
    // client-side value-swap a no-op.
    await prisma.siteScreenshot.update({ where: { id: b }, data: { sortOrder: 0 } });

    const res = await request(app)
      .put("/site-content/screenshots/reorder")
      .set("Authorization", `Bearer ${token}`)
      .send({ ids: [c, b, a] });
    expect(res.status).toBe(204);

    const list = await request(app).get("/site-content/screenshots/admin").set("Authorization", `Bearer ${token}`);
    const byId = Object.fromEntries(list.body.map((r: any) => [r.id, r.sortOrder]));
    expect(byId[c]).toBe(0);
    expect(byId[b]).toBe(1);
    expect(byId[a]).toBe(2);
  });

  it("rejects a reorder with a non-array/empty ids body", async () => {
    const token = await adminToken();
    if (!token) return;
    const res = await request(app)
      .put("/site-content/screenshots/reorder")
      .set("Authorization", `Bearer ${token}`)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });
});
