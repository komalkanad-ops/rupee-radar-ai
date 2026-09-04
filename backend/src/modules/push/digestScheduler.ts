import cron from "node-cron";
import { prisma } from "../../lib/prisma.js";
import { sendPushToTokens } from "./firebaseAdmin.js";

async function buildDigest(userId: string, days: number): Promise<{ title: string; body: string } | null> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const byCategory = await prisma.smsTransaction.groupBy({
    by: ["category"],
    where: { userId, txnDate: { gte: since }, category: { notIn: ["income", "transfer", "savings"] } },
    _sum: { amount: true },
  });
  if (byCategory.length === 0) return null;

  const total = byCategory.reduce((sum, c) => sum + Math.abs(c._sum.amount ?? 0), 0);
  const top = byCategory.reduce((a, b) => (Math.abs(b._sum.amount ?? 0) > Math.abs(a._sum.amount ?? 0) ? b : a));
  const period = days <= 7 ? "This week" : "This month";

  return {
    title: `${period} you spent ₹${Math.round(total).toLocaleString("en-IN")}`,
    body: `Top category: ${top.category ?? "uncategorized"} (₹${Math.round(Math.abs(top._sum.amount ?? 0)).toLocaleString("en-IN")}). Tap to see the full breakdown.`,
  };
}

async function sendDueSoonReminders() {
  const now = new Date();
  const in3Days = new Date(now);
  in3Days.setDate(in3Days.getDate() + 3);

  const dueSoon = await prisma.recurringPayment.findMany({
    where: { active: true, nextDueDate: { gte: now, lte: in3Days } },
  });
  if (dueSoon.length === 0) return;

  const byUser = new Map<string, typeof dueSoon>();
  for (const payment of dueSoon) {
    byUser.set(payment.userId, [...(byUser.get(payment.userId) ?? []), payment]);
  }

  const userIds = [...byUser.keys()];
  const devices = await prisma.device.findMany({
    where: { userId: { in: userIds }, digestOptIn: true, pushToken: { not: null } },
  });
  const tokensByUser = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.pushToken) continue;
    tokensByUser.set(d.userId, [...(tokensByUser.get(d.userId) ?? []), d.pushToken]);
  }

  for (const [userId, payments] of byUser) {
    const tokens = tokensByUser.get(userId);
    if (!tokens || tokens.length === 0) continue;
    const names = payments.map((p) => p.name).join(", ");
    const title = payments.length === 1 ? `${payments[0].name} due soon` : `${payments.length} payments due soon`;
    const body = `${names} — due within the next 3 days.`;
    await sendPushToTokens(tokens, { title, body }).catch((err) =>
      console.error(`Due-soon reminder failed for user ${userId}`, err),
    );
  }
}

// Push-notification companion to GET /insights/money-monday (insightsRouter.ts) — kept as its own
// simpler text summary here rather than sharing that endpoint's richer computation, matching this
// file's existing pattern of building its own push copy independently per digest.
async function buildMoneyMondayDigest(userId: string): Promise<{ title: string; body: string } | null> {
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 86400000);
  const in7Days = new Date(now.getTime() + 7 * 86400000);

  const byCategory = await prisma.smsTransaction.groupBy({
    by: ["category"],
    where: { userId, txnDate: { gte: weekStart, lt: now }, category: { notIn: ["income", "transfer", "savings"] } },
    _sum: { amount: true },
  });
  if (byCategory.length === 0) return null;

  const total = byCategory.reduce((sum, c) => sum + Math.abs(c._sum.amount ?? 0), 0);
  const top = byCategory.reduce((a, b) => (Math.abs(b._sum.amount ?? 0) > Math.abs(a._sum.amount ?? 0) ? b : a));
  const billsDueCount = await prisma.recurringPayment.count({
    where: { userId, active: true, nextDueDate: { gte: now, lte: in7Days } },
  });

  return {
    title: `Money Monday: ₹${Math.round(total).toLocaleString("en-IN")} last week`,
    body: `Top category: ${top.category ?? "uncategorized"}. ${
      billsDueCount > 0 ? `${billsDueCount} bill(s) due this week.` : "No bills due this week."
    } Tap for the full picture.`,
  };
}

async function sendMoneyMondayDigest() {
  const devices = await prisma.device.findMany({ where: { digestOptIn: true, pushToken: { not: null } } });
  const byUser = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.pushToken) continue;
    byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d.pushToken]);
  }
  for (const [userId, tokens] of byUser) {
    const digest = await buildMoneyMondayDigest(userId);
    if (!digest) continue;
    await sendPushToTokens(tokens, digest).catch((err) =>
      console.error(`Money Monday digest failed for user ${userId}`, err),
    );
  }
}

async function sendDigestsForAllUsers(days: number) {
  const devices = await prisma.device.findMany({
    where: { digestOptIn: true, pushToken: { not: null } },
  });

  const byUser = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.pushToken) continue;
    byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d.pushToken]);
  }

  for (const [userId, tokens] of byUser) {
    const digest = await buildDigest(userId, days);
    if (!digest) continue;
    await sendPushToTokens(tokens, digest).catch((err) =>
      console.error(`Digest push failed for user ${userId}`, err),
    );
  }
}

// Weekly: every Monday 8am IST (02:30 UTC). Monthly: 1st of month 8am IST. Daily due-soon check:
// every day 8am IST, for RecurringPayment.nextDueDate within the next 3 days. Money Monday: every
// Monday 8:05am IST (offset a few minutes from the weekly digest so they don't fire simultaneously).
export function startDigestScheduler() {
  cron.schedule("30 2 * * 1", () => sendDigestsForAllUsers(7));
  cron.schedule("30 2 1 * *", () => sendDigestsForAllUsers(30));
  cron.schedule("30 2 * * *", () => sendDueSoonReminders());
  cron.schedule("35 2 * * 1", () => sendMoneyMondayDigest());
}
