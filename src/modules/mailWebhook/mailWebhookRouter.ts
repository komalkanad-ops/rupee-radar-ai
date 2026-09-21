import * as Sentry from "@sentry/node";
import { Router } from "express";

export const mailWebhookRouter = Router();

// One secret per mailbox webhook — Hostinger generates a fresh, distinct secret per webhook
// (mail_createWebhookV1), there's no way to set a shared one ourselves. `mailbox:secret` pairs,
// comma-separated, so both admin@ and support@'s webhooks can point at this same route. The
// mailbox is looked up from *which secret* authenticated the request, not from the payload body —
// confirmed via a real test delivery that Hostinger's `message.received` payload doesn't identify
// the mailbox itself (no `mailbox`/`account` field), only `subject`/`from` under `data.message`.
const SECRET_TO_MAILBOX = new Map(
  (process.env.HOSTINGER_MAIL_WEBHOOK_SECRETS ?? "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [mailbox, secret] = pair.split(":");
      return [secret, mailbox] as const;
    }),
);
// chat.postMessage, not an Incoming Webhook — a bot token doesn't expire (unlike the rotating user
// OAuth token used for the interactive Slack MCP connection elsewhere), which matters here since
// this path runs unattended with no session around to refresh anything.
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_MAIL_ALERT_CHANNEL_ID = process.env.SLACK_MAIL_ALERT_CHANNEL_ID;

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

/** Best-effort field extraction for subject/from — Hostinger's OpenAPI spec
 * (github.com/hostinger/mail-api) documents the webhook *management* API in full but not the exact
 * shape of what's actually POSTed on `message.received`. Confirmed via a real test delivery:
 * `data.message.subject` and `data.message.from.address` are populated; every field here still
 * falls back to something generic rather than throwing, in case a real delivery's shape differs
 * from the test payload's. */
function formatSlackMessage(mailbox: string, body: any): string {
  const event = body?.event ?? body?.type ?? "message.received";
  const message = body?.data?.message ?? body?.message ?? body?.data ?? {};
  const subject = message?.subject ?? "(no subject)";
  const from = message?.from?.address ?? message?.from?.name ?? message?.from ?? "unknown sender";

  return `📧 *New email* on \`${mailbox}\`\n*From:* ${from}\n*Subject:* ${subject}\n_(${event})_`;
}

// POST /webhooks/hostinger-mail — Hostinger's Email API calls this on message.received for any
// mailbox with a webhook registered (see mail_createWebhookV1 / docs/ for the setup steps). Not
// requireAdmin/requireUser — the caller is Hostinger's own infrastructure, authenticated via the
// per-webhook secret it sends as a bearer token instead.
mailWebhookRouter.post("/", async (req, res) => {
  const token = extractBearerToken(req.headers.authorization);
  const mailbox = token ? SECRET_TO_MAILBOX.get(token) : undefined;
  if (!mailbox) {
    return res.status(401).json({ error: "invalid webhook secret" });
  }

  // Ack immediately — Hostinger doesn't need to wait on Slack, and a slow/down Slack API shouldn't
  // turn into a webhook retry storm on their end.
  res.status(200).json({ received: true });

  if (!SLACK_BOT_TOKEN || !SLACK_MAIL_ALERT_CHANNEL_ID) {
    Sentry.captureMessage("Hostinger mail webhook fired but SLACK_BOT_TOKEN/SLACK_MAIL_ALERT_CHANNEL_ID is unset", {
      extra: { body: req.body },
    });
    return;
  }
  try {
    const text = formatSlackMessage(mailbox, req.body);
    const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: SLACK_MAIL_ALERT_CHANNEL_ID, text }),
    });
    const slackBody = await slackRes.json().catch(() => null);
    // chat.postMessage returns HTTP 200 even on failure (e.g. not_in_channel, invalid_auth) —
    // the real result is in the JSON body's `ok` field, not the status code.
    if (!slackRes.ok || !slackBody?.ok) {
      Sentry.captureMessage(`Slack chat.postMessage failed: ${slackBody?.error ?? slackRes.status}`, {
        extra: { body: req.body },
      });
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /webhooks/hostinger-mail" }, extra: { body: req.body } });
  }
});
