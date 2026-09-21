import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

const ORIGINAL_ENV = { ...process.env };

describe("Hostinger mail webhook (/webhooks/hostinger-mail)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.HOSTINGER_MAIL_WEBHOOK_SECRETS = "secret-admin,secret-support";
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    process.env.SLACK_MAIL_ALERT_CHANNEL_ID = "C0TESTCHANNEL";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("401s with no Authorization header", async () => {
    const { app } = await import("../src/app.js");
    const res = await request(app).post("/webhooks/hostinger-mail").send({});
    expect(res.status).toBe(401);
  });

  it("401s with a wrong bearer token", async () => {
    const { app } = await import("../src/app.js");
    const res = await request(app)
      .post("/webhooks/hostinger-mail")
      .set("Authorization", "Bearer not-a-real-secret")
      .send({});
    expect(res.status).toBe(401);
  });

  it("accepts either mailbox's secret and forwards to Slack's chat.postMessage with the channel and a formatted message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const { app } = await import("../src/app.js");
    const res = await request(app)
      .post("/webhooks/hostinger-mail")
      .set("Authorization", "Bearer secret-support")
      .send({
        event: "message.received",
        mailbox: "support@rupeeradarai.com",
        data: { message: { subject: "Hello", from: { address: "someone@example.com" } } },
      });

    expect(res.status).toBe(200);
    // The Slack POST happens after the response is sent — give the event loop a tick.
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(options.headers.Authorization).toBe("Bearer xoxb-test-token");
    const body = JSON.parse(options.body);
    expect(body.channel).toBe("C0TESTCHANNEL");
    expect(body.text).toContain("support@rupeeradarai.com");
    expect(body.text).toContain("someone@example.com");
    expect(body.text).toContain("Hello");
  });

  it("still 200s the webhook caller even if Slack posting isn't configured", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { app } = await import("../src/app.js");
    const res = await request(app)
      .post("/webhooks/hostinger-mail")
      .set("Authorization", "Bearer secret-admin")
      .send({});

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
