import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createAnonymousUser } from "./helpers.js";

// Stub the real mesh-api network call — this endpoint's job is tier gating, batch-size limits, and
// defensive parsing of the model's JSON; the actual LLM round-trip is meshClient's concern.
vi.mock("../src/modules/llm/meshClient.js", () => ({
  callMesh: vi.fn(async () => "[]"),
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

const SAMPLE_CANDIDATES = [
  { merchant: "ZOMATO", amount: 450, occurrences: 3, frequency: "monthly" },
  { merchant: "Zomato Ltd", amount: 480, occurrences: 2, frequency: "monthly" },
  { merchant: "NETFLIX", amount: 649, occurrences: 6, frequency: "monthly" },
];

describe("Recurring-candidate AI dedupe (/recurring/dedupe-candidates)", () => {
  const createdUserIds: string[] = [];
  const originalCode = process.env.PRO_TEST_REDEEM_CODE;

  beforeAll(() => {
    process.env.PRO_TEST_REDEEM_CODE = "TEST-CODE-DEDUPE";
  });

  afterAll(async () => {
    process.env.PRO_TEST_REDEEM_CODE = originalCode;
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("401s with no token", async () => {
    const res = await request(app).post("/recurring/dedupe-candidates").send({ candidates: SAMPLE_CANDIDATES });
    expect(res.status).toBe(401);
  });

  it("free user gets proRequired without a model call", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const before = (callMesh as any).mock.calls.length;

    const res = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ candidates: SAMPLE_CANDIDATES });

    expect(res.status).toBe(200);
    expect(res.body.proRequired).toBe(true);
    expect(res.body.groups).toEqual([]);
    expect((callMesh as any).mock.calls.length).toBe(before);
  });

  it("400s an oversized batch", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const candidates = Array.from({ length: 41 }, (_, i) => ({ merchant: `Merchant ${i}`, amount: 100, occurrences: 2, frequency: "monthly" }));
    const res = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ candidates });

    expect(res.status).toBe(400);
  });

  it("400s when candidates is missing or has a non-string merchant", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const missing = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({});
    expect(missing.status).toBe(400);

    const badMerchant = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ candidates: [{ merchant: 123, amount: 10, occurrences: 2, frequency: "monthly" }] });
    expect(badMerchant.status).toBe(400);
  });

  it("PRO user gets grouped indices back, and ungrouped indices stay singleton", async () => {
    (callMesh as any).mockResolvedValueOnce(JSON.stringify([{ indices: [0, 1], confidence: "high" }]));
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ candidates: SAMPLE_CANDIDATES });

    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual(
      expect.arrayContaining([
        { indices: [0, 1], confidence: "high" },
        { indices: [2], confidence: "high" },
      ]),
    );
    expect(res.body.groups).toHaveLength(2);
  });

  it("a malformed model response falls back to every candidate as its own group, not a 500", async () => {
    (callMesh as any).mockResolvedValueOnce("sorry, I can't do that");
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ candidates: SAMPLE_CANDIDATES });

    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(3);
    res.body.groups.forEach((g: any) => expect(g.indices).toHaveLength(1));
  });

  it("an out-of-range index from the model is dropped, not trusted", async () => {
    (callMesh as any).mockResolvedValueOnce(JSON.stringify([{ indices: [0, 99], confidence: "high" }]));
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ candidates: SAMPLE_CANDIDATES });

    expect(res.status).toBe(200);
    const allIndices = res.body.groups.flatMap((g: any) => g.indices);
    expect(allIndices.sort()).toEqual([0, 1, 2]);
  });

  it("a syntactically-valid but non-array response falls back to singleton groups, not an empty list", async () => {
    (callMesh as any).mockResolvedValueOnce(JSON.stringify({ groups: [{ indices: [0, 1], confidence: "high" }] }));
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ candidates: SAMPLE_CANDIDATES });

    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(3);
    res.body.groups.forEach((g: any) => expect(g.indices).toHaveLength(1));
  });

  it("a duplicated index within one group is deduped, not double-counted", async () => {
    (callMesh as any).mockResolvedValueOnce(JSON.stringify([{ indices: [0, 0, 1], confidence: "high" }]));
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ candidates: SAMPLE_CANDIDATES });

    expect(res.status).toBe(200);
    const group = res.body.groups.find((g: any) => g.indices.includes(0));
    expect(group.indices).toEqual([0, 1]);
    const allIndices = res.body.groups.flatMap((g: any) => g.indices);
    expect(allIndices.sort()).toEqual([0, 1, 2]);
  });

  it("returns a retryable 429 when the mesh provider is rate-limited", async () => {
    (callMesh as any).mockRejectedValueOnce(new Error("RPM limit of 20 req/min exceeded"));
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app)
      .post("/recurring/dedupe-candidates")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ candidates: SAMPLE_CANDIDATES });

    expect(res.status).toBe(429);
    expect(res.body.retryable).toBe(true);
  });
});
