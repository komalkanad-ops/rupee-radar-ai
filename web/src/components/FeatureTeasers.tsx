import Reveal from "./Reveal";

interface Teaser {
  icon: string;
  title: string;
  desc: string;
}

// A broader slice of what's actually built in the Android app but wasn't represented on the
// website at all before — pure marketing copy, no live/fabricated figures (unlike the Health
// Score/Challenges teasers on Home, which explicitly label their numbers as sample data). Each
// card exists in the real app today; this is a map of it, not a promise.
const teasers: Teaser[] = [
  { icon: "📈", title: "Financial Review", desc: "A month, quarter, or year at a glance — income, spend, savings rate, what changed vs last period, your biggest expenses, an A–F grade, and a short plain-English summary of what happened and why (PRO)." },
  { icon: "🎯", title: "Budgets & Goals", desc: "A monthly limit per category with a live spent-so-far bar, and savings goals with a target date — the app works out the monthly contribution you need and tells you if you've fallen behind." },
  { icon: "🛟", title: "Safety Net", desc: "The three numbers that decide how safe your finances are — savings rate, emergency-fund runway in months, and debt-to-income — each against the standard benchmark, in plain language (PRO)." },
  { icon: "💧", title: "Money Leaks", desc: "Where to stop spending: forgotten subscriptions, bank fees and surcharges, categories creeping up month after month, duplicate charges, and weekend impulse patterns — with a monthly recoverable total (PRO)." },
  { icon: "🏔️", title: "Debt Freedom", desc: "Order your loans by the avalanche or snowball method, see the exact month you'll be debt-free, and find out how many months and how much interest an extra ₹/month would save (PRO)." },
  { icon: "🔮", title: "Net Worth projection", desc: "Where your net worth lands in 1, 3, 5 and 10 years at your recent savings pace, with an adjustable return assumption so you can see how sensitive the outlook is (PRO)." },
  { icon: "🕰️", title: "Spending Habits", desc: "Weekday vs weekend, a day-and-time heat map of where your money goes, your most expensive day, your card-vs-UPI mix, and whether your typical transaction is getting bigger (PRO)." },
  { icon: "💬", title: "AI finance chat", desc: "Ask questions about your own spending, loans, lending, and savings — a scoped assistant that answers from your real data and won't wander into general chit-chat. A few free messages, unlimited on PRO." },
  { icon: "🪙", title: "Savings tracker", desc: "Fixed deposits, gold savings schemes, stocks, mutual fund SIPs, and gold/silver coins — all in one place, with SIP contributions set as one-time, monthly, or any custom interval. Convert a tracked expense straight into a savings contribution instead of re-entering it." },
  { icon: "🏦", title: "Loan & EMI tracker", desc: "Home, car, personal, and commercial loans in one place — real EMI math, payoff dates, an early-payoff optimizer, and one-tap foreclosure tracking when you pay one off early. Try the free web EMI calculator below." },
  { icon: "💳", title: "Bank balances", desc: "The latest balance each bank's own SMS reports, per account, without opening a single banking app." },
  { icon: "📊", title: "Credit utilization alerts", desc: "A heads-up the moment any card crosses 30/75/90% utilization — before it dents your credit score, not after." },
  { icon: "🛍️", title: "Mall Mode", desc: "Walk into a mall and see which of your cards earns the most at each real store, tile by tile — tap any store for a full ranking across your whole wallet." },
  { icon: "🤝", title: "Lending tracker", desc: "Money you've lent or borrowed from friends and family — a real multi-installment repayment schedule, part-repayments with a full dated history, edit an entry any time, send a UPI pay link, or nudge them over WhatsApp/SMS." },
  { icon: "✅", title: "Smart to-dos", desc: "Auto-suggests real actions from your own spending — cancel a subscription you've stopped using, chase an overdue loan EMI or lending repayment, or upload an invoice to claim a tax deduction." },
  { icon: "🏷️", title: "Learns your categories", desc: "Correct a merchant's category once and it's fixed everywhere — past transactions update immediately, and every future SMS from that merchant is categorized right the first time." },
  { icon: "📅", title: "Cash flow calendar", desc: "A day-by-day projected balance for the month, with a 48-hour-ahead warning if a bill might bounce (PRO)." },
  { icon: "🧑‍🤝‍🧑", title: "Peer comparison", desc: "See how your spending mix stacks up against others in your city and income bracket — anonymous, benchmark-based, never another user's real data." },
  { icon: "🎁", title: "Rewards & referrals", desc: "Earn coins for good habits and referrals, redeem them for real vouchers." },
  { icon: "🧾", title: "Subscription cleanup", desc: "Every recurring payment auto-detected from your SMS, with one-tap cancel/downgrade links." },
  { icon: "🔔", title: "Reward point expiry alerts", desc: "Never let accumulated credit card points quietly expire unused — get warned 30 days out." },
  { icon: "🧮", title: "Tax-saving nudges", desc: "80C/80D-eligible spends auto-tagged from your SMS, with a one-tap CSV export for filing season (PRO)." },
  { icon: "👨‍👩‍👧", title: "Family Vault", desc: "Pool grocery and utility budgets with your household — privately, without sharing bank balances or personal spending." },
  { icon: "⚡", title: "Shock simulator", desc: "Stress-test your emergency runway against a pay cut, an inflation spike, or a one-time medical bill (PRO)." },
];

export default function FeatureTeasers() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <Reveal className="text-center mb-10">
        <h2 className="text-2xl md:text-3xl font-bold mb-2">There's a lot more in the app.</h2>
        <p className="text-app-muted max-w-xl mx-auto">
          The website covers the card catalog and a couple of teasers — everything below only
          exists in the Android app today.
        </p>
      </Reveal>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {teasers.map((t, i) => (
          <Reveal key={t.title} delay={(i % 4) * 80} className="glass-card p-5">
            <div className="text-2xl mb-2">{t.icon}</div>
            <h3 className="font-semibold mb-1">{t.title}</h3>
            <p className="text-sm text-app-muted">{t.desc}</p>
          </Reveal>
        ))}
      </div>
      <p className="text-center mt-8">
        <a
          href="#download"
          className="inline-block bg-gradient-to-r from-purple to-blue text-white px-6 py-3 rounded-full font-semibold hover:opacity-90 transition hover:scale-105 active:scale-95"
        >
          Get all of it — download the app →
        </a>
      </p>
    </section>
  );
}
