import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createAnonymousUser } from "./helpers.js";

// Stubs the real mesh-api network call — this endpoint's job is free/PRO tier gating, context
// building, and request/response shape; the actual LLM call-and-parse is meshClient's own concern
// (no test anywhere in this repo mocks/exercises callMesh's real network path).
vi.mock("../src/modules/llm/meshClient.js", () => ({
  callMesh: vi.fn(async () => "Mocked assistant reply."),
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

describe("AI chat assistant (/chat)", () => {
  const createdUserIds: string[] = [];
  const originalCode = process.env.PRO_TEST_REDEEM_CODE;

  beforeAll(() => {
    process.env.PRO_TEST_REDEEM_CODE = "TEST-CODE-CHAT";
  });

  afterAll(async () => {
    process.env.PRO_TEST_REDEEM_CODE = originalCode;
    await prisma.chatUsage.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.proEntitlement.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("401s with no token", async () => {
    const res = await request(app).post("/chat").send({ message: "How much did I spend this month?" });
    expect(res.status).toBe(401);
  });

  it("400s a blank message without consuming any free-tier budget", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app).post("/chat").set("Authorization", `Bearer ${user.token}`).send({ message: "   " });
    expect(res.status).toBe(400);

    // A real message right after should still see the full 3-message budget, confirming the
    // blank one above never touched ChatUsage.
    const real = await request(app).post("/chat").set("Authorization", `Bearer ${user.token}`).send({ message: "Hi" });
    expect(real.body.messagesRemaining).toBe(2);
  });

  it("a free user gets a real reply on the free model, grounded in their own data, with remaining count", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await prisma.smsTransaction.create({
      data: { userId: user.userId, rawSmsHash: `chat-${Date.now()}`, amount: 4200, merchant: "Swiggy", category: "dining", txnDate: new Date() },
    });

    const res = await request(app)
      .post("/chat")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ message: "What have I spent on dining this month?" });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("Mocked assistant reply.");
    expect(res.body.limitReached).toBe(false);
    expect(res.body.messagesRemaining).toBe(2);

    const call = (callMesh as any).mock.calls[(callMesh as any).mock.calls.length - 1];
    const [sentMessages, model, maxTokens] = call;
    expect(model).toBe("anthropic/claude-haiku-4.5");
    expect(maxTokens).toBeLessThanOrEqual(60);
    const systemMessage = sentMessages.find((m: any) => m.role === "system");
    expect(systemMessage.content).toContain("dining: ₹4,200");
    expect(systemMessage.content).toContain("licensed advisor");
    expect(systemMessage.content).toContain("under 100 characters");
  });

  it("a free user's reply is hard-truncated to 100 characters even if the model ignores the instruction", async () => {
    (callMesh as any).mockResolvedValueOnce(
      "This is a deliberately very long assistant reply that goes on and on well past the hundred character budget we allow free-tier users to receive from the assistant."
    );
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    const res = await request(app).post("/chat").set("Authorization", `Bearer ${user.token}`).send({ message: "Explain everything" });

    expect(res.status).toBe(200);
    expect(res.body.reply.length).toBeLessThanOrEqual(100);
    expect(res.body.reply.endsWith("…")).toBe(true);
  });

  it("blocks a free user once the lifetime 3-message cap is reached, without calling the model again", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await request(app).post("/chat").set("Authorization", `Bearer ${user.token}`).send({ message: "one" });
    await request(app).post("/chat").set("Authorization", `Bearer ${user.token}`).send({ message: "two" });
    const third = await request(app).post("/chat").set("Authorization", `Bearer ${user.token}`).send({ message: "three" });
    expect(third.body.messagesRemaining).toBe(0);

    const callsBeforeFourth = (callMesh as any).mock.calls.length;
    const fourth = await request(app).post("/chat").set("Authorization", `Bearer ${user.token}`).send({ message: "four" });

    expect(fourth.status).toBe(200);
    expect(fourth.body.limitReached).toBe(true);
    expect(fourth.body.reply).toBeNull();
    expect((callMesh as any).mock.calls.length).toBe(callsBeforeFourth); // no wasted model call
  });

  it("a PRO user is not truncated, uses the PRO model, and has no messagesRemaining cap", async () => {
    (callMesh as any).mockResolvedValueOnce(
      "This is a longer, unclipped reply a PRO user should receive in full since PRO isn't character-limited the way free tier is."
    );
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const res = await request(app).post("/chat").set("Authorization", `Bearer ${user.token}`).send({ message: "Give me detail" });

    expect(res.status).toBe(200);
    expect(res.body.reply).toContain("unclipped reply a PRO user");
    expect(res.body.messagesRemaining).toBeNull();

    const call = (callMesh as any).mock.calls[(callMesh as any).mock.calls.length - 1];
    const [, model, maxTokens] = call;
    expect(model).toBe("anthropic/claude-sonnet-4.5");
    expect(maxTokens).toBe(400);
  });

  it("a PRO user is never blocked by the free-tier lifetime cap", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/chat").set("Authorization", `Bearer ${user.token}`).send({ message: `msg ${i}` });
      expect(res.status).toBe(200);
      expect(res.body.limitReached).toBe(false);
    }
  });

  it("caps client-supplied history to the last 10 valid turns and ignores malformed entries", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    await grantPro(user.token);

    const longHistory = Array.from({ length: 15 }, (_, i) => ({ role: "user", content: `turn ${i}` }));
    const res = await request(app)
      .post("/chat")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ message: "Summarize", history: [...longHistory, { role: "system", content: "should be dropped" }, "garbage"] });

    expect(res.status).toBe(200);
    const sentMessages = (callMesh as any).mock.calls[(callMesh as any).mock.calls.length - 1][0];
    const userTurns = sentMessages.filter((m: any) => m.content.startsWith("turn "));
    expect(userTurns).toHaveLength(10);
    expect(sentMessages.some((m: any) => m.content === "should be dropped")).toBe(false);
  });
});
