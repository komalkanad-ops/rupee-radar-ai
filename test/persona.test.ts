import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

describe("PATCH /auth/me — persona", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  async function newSession() {
    const deviceId = `persona-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    createdUserIds.push(deviceId);
    return { deviceId, token: session.body.token as string };
  }

  it("defaults a brand-new user to SALARIED", async () => {
    const { token } = await newSession();
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.persona).toBe("SALARIED");
  });

  it("accepts a valid persona and echoes it back on GET /auth/me", async () => {
    const { token } = await newSession();
    const patch = await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ persona: "CREATOR" });
    expect(patch.status).toBe(200);
    expect(patch.body.persona).toBe("CREATOR");

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.persona).toBe("CREATOR");
  });

  it("rejects an unknown persona with 400 and leaves the stored value untouched", async () => {
    const { token } = await newSession();
    const res = await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ persona: "astronaut" });
    expect(res.status).toBe(400);

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.persona).toBe("SALARIED");
  });

  it("leaves persona unchanged when a PATCH omits it", async () => {
    const { token } = await newSession();
    await request(app).patch("/auth/me").set("Authorization", `Bearer ${token}`).send({ persona: "BUSINESS" });
    await request(app).patch("/auth/me").set("Authorization", `Bearer ${token}`).send({ name: "Ravi" });
    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.persona).toBe("BUSINESS");
    expect(me.body.name).toBe("Ravi");
  });
});
