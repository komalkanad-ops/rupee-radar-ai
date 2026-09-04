import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createAnonymousUser } from "./helpers.js";

// Stub the real mesh-api network call — this endpoint's job is tier gating, batch-size limits, and
// defensive parsing of the model's JSON; the actual LLM round-trip is meshClient's concern.
vi.mock("../src/modules/llm/meshClient.js", () => ({
  callMesh: vi.fn(async () => "{}"),
}));

const { app } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { callMesh } = await import("../src/modules/llm/meshClient.js");

async function grantPro(token: string) {
  await request(app)
    .post("/billing/redeem-test-code")
    .set("Authorization", `Bearer ${token}`)
    .send({ code: process.env.PRO_TEST_REDEEM_CODE ?? "" });
}

describe("Merchant AI classification (/categorization/classify)", () => {
  const createdUserIds: string[] = [];
  const originalCode = process.env.PRO_TEST_REDEEM_CODE;

  beforeAll(() => {
    process.env.PRO_TEST_REDEEM_CODE = "TEST-CODE-CLASSIFY";
  });

  afterAll(async () => {
    process.env.PRO_TEST_REDEEM_CODE = originalCode;
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("401s with no token", async () => {
    const res = await request(app).post("/categorization/classify").send({ merchants: ["Ruby Hall Clinic"] });
    expect(res.status).toBe(401);
  });

  it("free user gets proRequired without a model call", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const before = (callMesh as any).mock.calls.length;

    const res = await request(app)
      .post("/categorization/classify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ merchants: ["Ruby Hall Clinic", "Prakash Expressway"] });

    expect(res.status).toBe(200);
    expect(res.body.proRequired).toBe(true);
    expect(res.body.results).toEqual({});
    expect((callMesh as any).mock.calls.length).toBe(before); // no wasted model call
  });

  it("400s an oversized batch", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const merchants = Array.from({ length: 51 }, (_, i) => `Merchant ${i}`);
    const res = await request(app)
      .post("/categorization/classify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ merchants });

    expect(res.status).toBe(400);
  });

  it("400s when merchants is missing or not an array of strings", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const missing = await request(app)
      .post("/categorization/classify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({});
    expect(missing.status).toBe(400);

    const notStrings = await request(app)
      .post("/categorization/classify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ merchants: [1, 2, 3] });
    expect(notStrings.status).toBe(400);
  });

  it("PRO user gets a results map, dropping unknown categories and unrequested merchants", async () => {
    (callMesh as any).mockResolvedValueOnce(
      JSON.stringify({
        "Ruby Hall Clinic": "medical",
        "Cult Fit Koregaon": "fitness",
        "Mystery Shop": "not-a-real-category",
        "Never Asked": "shopping",
      })
    );
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app)
      .post("/categorization/classify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ merchants: ["Ruby Hall Clinic", "Cult Fit Koregaon", "Mystery Shop"] });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual({
      "Ruby Hall Clinic": "medical",
      "Cult Fit Koregaon": "fitness",
    });
  });

  it("a malformed model response is a no-op, not a 500", async () => {
    (callMesh as any).mockResolvedValueOnce("sorry, I can't do that");
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app)
      .post("/categorization/classify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ merchants: ["Whatever"] });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual({});
  });

  it("returns a retryable 429 when the mesh provider is rate-limited", async () => {
    (callMesh as any).mockRejectedValueOnce(new Error("RPM limit of 20 req/min exceeded"));
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app)
      .post("/categorization/classify")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ merchants: ["Whatever"] });

    expect(res.status).toBe(429);
    expect(res.body.retryable).toBe(true);
  });
});
