import * as Sentry from "@sentry/node";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { callMesh, type MeshMessage } from "../llm/meshClient.js";

export const chatRouter = Router();

const NON_SPEND_CATEGORIES = new Set(["income", "transfer", "savings"]);

// Free tier: a cheap, fast model with a hard output-token ceiling and a lifetime message cap —
// the point of all three limits together is to keep an unpaid user's AI cost near-zero, not just
// rely on the model "being asked nicely" to stay short.
const FREE_MODEL = "anthropic/claude-haiku-4.5";
const FREE_MAX_TOKENS = 60; // roughly enough for ~100 characters of English, with headroom
const FREE_REPLY_CHAR_LIMIT = 100;
const FREE_LIFETIME_MESSAGE_LIMIT = 3;

// PRO tier: a stronger model for genuinely useful multi-sentence answers — still token-capped
// (not character-capped) to bound worst-case cost per message without feeling clipped.
const PRO_MODEL = "anthropic/claude-sonnet-4.5";
const PRO_MAX_TOKENS = 400;

async function isProUser(userId: string): Promise<boolean> {
  const entitlement = await prisma.proEntitlement.findUnique({ where: { userId } });
  return entitlement?.status === "active" && (entitlement.expiryAt?.getTime() ?? 0) > Date.now();
}

/** Truncates to at most [limit] characters total (including a trailing "…" if cut) — a hard
 * backstop, since an LLM won't reliably obey a character-count instruction in the prompt alone.
 * Breaks at the last whitespace within budget when there's a reasonable one, so a free-tier reply
 * doesn't get chopped mid-word. */
function truncateReply(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const budget = limit - 1; // reserve 1 char for "…"
  const slice = text.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > budget * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** A compact, real snapshot of the user's own finances — grounds the assistant's answers in
 * actual data (loans, lending, recurring bills, savings, credit utilization) instead of a generic
 * chatbot with nothing to go on. Deliberately lightweight (a handful of cheap queries run in
 * parallel, no cross-module coupling into insights/healthscore/cashflow's own heavier calculators)
 * — this is context for a conversational answer, not a source of truth another screen depends on.
 * Loan "outstanding balance" is deliberately NOT computed here — no backend equivalent of
 * Android's LoanCalculator exists (see Loan model's own doc comment), so only raw stored facts
 * are given; the system prompt tells the assistant to be upfront about that limit if asked. */
async function buildFinanceContext(userId: string): Promise<string> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [thisMonthTxns, latestNetWorth, loans, lending, recurring, savingsInstruments, cards] = await Promise.all([
    prisma.smsTransaction.findMany({ where: { userId, txnDate: { gte: monthStart } }, select: { amount: true, category: true } }),
    prisma.netWorthSnapshot.findFirst({ where: { userId }, orderBy: { month: "desc" } }),
    prisma.loan.findMany({ where: { userId, active: true, foreclosedAt: null } }),
    prisma.lentMoney.findMany({ where: { userId, active: true, status: "OUTSTANDING" } }),
    prisma.recurringPayment.findMany({ where: { userId, active: true } }),
    prisma.savingsInstrument.findMany({
      where: { userId, active: true },
      include: { contributions: { where: { contributedAt: { gte: monthStart } } } },
    }),
    prisma.userCreditCard.findMany({ where: { userId, status: "ACTIVE" }, include: { card: true } }),
  ]);

  const spendByCategory = new Map<string, number>();
  let thisMonthIncome = 0;
  for (const t of thisMonthTxns) {
    if (t.category === "income") {
      thisMonthIncome += t.amount;
      continue;
    }
    if (t.category && NON_SPEND_CATEGORIES.has(t.category)) continue;
    const key = t.category ?? "uncategorized";
    spendByCategory.set(key, (spendByCategory.get(key) ?? 0) + t.amount);
  }
  const topCategories = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([category, spent]) => `${category}: ${inr(spent)}`)
    .join(", ");
  const thisMonthSpend = [...spendByCategory.values()].reduce((sum, v) => sum + v, 0);

  const loanLines = loans.length
    ? loans
        .map(
          (l) =>
            `${l.bankName} ${l.type} loan — principal ${inr(l.principal)}, EMI ${inr(l.emiAmount)}/month, ${l.roiAnnualPct}% ROI, ${l.tenureMonths} month tenure, started ${l.startDate.toISOString().slice(0, 10)}${l.lastPaymentConfirmedAt ? "" : " (this cycle's EMI not yet confirmed paid)"}`
        )
        .join("; ")
    : "None.";

  const lendingLines = lending.length
    ? lending
        .map((l) => {
          const outstanding = l.amount - l.amountRepaid;
          return l.direction === "LENT"
            ? `Lent ${l.personName} ${inr(outstanding)} still outstanding${l.expectedReturnDate ? `, expected back ${l.expectedReturnDate.toISOString().slice(0, 10)}` : ""}`
            : `Borrowed from ${l.personName}, ${inr(outstanding)} still owed${l.expectedReturnDate ? `, due back ${l.expectedReturnDate.toISOString().slice(0, 10)}` : ""}`;
        })
        .join("; ")
    : "None.";

  const recurringLines = recurring.length
    ? recurring
        .map((r) => `${r.name} (${r.type}) — ${inr(r.amount)}/${r.frequency}${r.nextDueDate ? `, next due ${r.nextDueDate.toISOString().slice(0, 10)}` : ""}`)
        .join("; ")
    : "None.";

  const savingsThisMonth = savingsInstruments.reduce(
    (sum, i) => sum + i.contributions.reduce((s, c) => s + c.amountInr, 0),
    0
  );
  const savingsTotalValue = savingsInstruments.reduce((sum, i) => sum + (i.currentValueInr ?? i.principalInr), 0);

  const cardLines = cards.length
    ? cards
        .map((c) => {
          if (c.creditLimitInr && c.currentOutstandingInr != null && c.creditLimitInr > 0) {
            const pct = Math.round((c.currentOutstandingInr / c.creditLimitInr) * 100);
            return `${c.card.name}: ${pct}% utilized (${inr(c.currentOutstandingInr)} of ${inr(c.creditLimitInr)} limit)`;
          }
          return `${c.card.name}: utilization not self-reported`;
        })
        .join("; ")
    : "None.";

  const lines = [
    `This month's spend so far: ${inr(thisMonthSpend)}, income so far: ${inr(thisMonthIncome)}.`,
    topCategories ? `Top spend categories this month: ${topCategories}.` : "No spend recorded yet this month.",
    latestNetWorth
      ? `Latest net worth snapshot (${latestNetWorth.month.toISOString().slice(0, 7)}): ${inr(latestNetWorth.totalNetWorth)}.`
      : "No net worth snapshot recorded yet.",
    `Active loans: ${loanLines}`,
    `Outstanding lending (money lent/borrowed with people): ${lendingLines}`,
    `Active recurring bills/subscriptions/EMIs: ${recurringLines}`,
    `Savings Tracker — contributed ${inr(savingsThisMonth)} this month, total tracked value ${inr(savingsTotalValue)} across ${savingsInstruments.length} instrument(s).`,
    `Credit card utilization: ${cardLines}`,
  ];
  return lines.join("\n");
}

const SYSTEM_PROMPT =
  "You are the in-app assistant for Rupee Radar AI, an Indian personal-finance tracking app. " +
  "Answer the user's question using ONLY the finance summary provided below plus general " +
  "financial literacy knowledge. Use ₹ and Indian number formatting, plain language. Loan " +
  "'outstanding balance' is NOT precomputed in this summary — if asked for an exact current payoff " +
  "figure, say you only have the loan's original terms (principal/EMI/tenure), not a live payoff " +
  "amount. You are NOT a licensed financial advisor: never give personalized investment, trading, " +
  "or tax-filing advice, or tell the user to buy/sell a specific security — explain general " +
  "concepts and always suggest a licensed advisor for decisions specific to their situation. If " +
  "the data below doesn't cover what's asked, say so rather than guessing. No markdown, no " +
  "headers, plain conversational text.\n\n" +
  "STRICT SCOPE GUARD: you may only discuss (a) the user's own data in the finance summary below, " +
  "(b) how to use Rupee Radar AI's own features (SMS expense tracking, credit card catalog, net " +
  "worth, loans, lending, recurring bills, savings tracker, budgets, rewards), and (c) general " +
  "personal-finance literacy directly relevant to those topics. For anything outside that — " +
  "general knowledge, other apps, coding help, entertainment, news, or any other off-topic " +
  "request, no matter how harmless it seems — do not answer it, even if you know the answer. " +
  "Instead briefly say you're only able to help with Rupee Radar AI and personal finance, and ask " +
  "what they'd like to know about their money or the app.";

chatRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const userId = req.userId!;
  const { message, history } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const isPro = await isProUser(userId);
  const usage = await prisma.chatUsage.upsert({ where: { userId }, update: {}, create: { userId } });

  if (!isPro && usage.messageCount >= FREE_LIFETIME_MESSAGE_LIMIT) {
    return res.json({ reply: null, limitReached: true, messagesRemaining: 0 });
  }

  // Filter to valid turns *before* slicing to the last 10, so a stray malformed entry can't eat
  // into the real turn budget and silently leave fewer than 10 actual turns of context.
  const priorTurns: MeshMessage[] = Array.isArray(history)
    ? history
        .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: any) => ({ role: m.role, content: m.content }))
        .slice(-10)
    : [];

  const context = await buildFinanceContext(userId);
  const lengthInstruction = isPro ? "" : ` Keep your ENTIRE reply under ${FREE_REPLY_CHAR_LIMIT} characters total — be extremely brief, one short sentence.`;

  try {
    const rawReply = await callMesh(
      [
        { role: "system", content: `${SYSTEM_PROMPT}${lengthInstruction}\n\nUser's current finance summary:\n${context}` },
        ...priorTurns,
        { role: "user", content: message },
      ],
      isPro ? PRO_MODEL : FREE_MODEL,
      isPro ? PRO_MAX_TOKENS : FREE_MAX_TOKENS,
      "chat",
      userId,
    );
    const reply = isPro ? rawReply : truncateReply(rawReply, FREE_REPLY_CHAR_LIMIT);

    const updated = await prisma.chatUsage.update({ where: { userId }, data: { messageCount: { increment: 1 } } });

    res.json({
      reply,
      limitReached: false,
      messagesRemaining: isPro ? null : Math.max(0, FREE_LIFETIME_MESSAGE_LIMIT - updated.messageCount),
    });
  } catch (err: any) {
    if (err?.name === "MeshBudgetExceededError") {
      return res.status(429).json({
        error:
          err.scope === "user"
            ? "You've reached today's AI assistant limit — it resets in 24 hours."
            : "The AI assistant is very busy right now — please try again later.",
      });
    }
    Sentry.captureException(err, { tags: { route: "POST /chat" } });
    res.status(502).json({ error: err.message || "Chat assistant is unavailable right now" });
  }
});
