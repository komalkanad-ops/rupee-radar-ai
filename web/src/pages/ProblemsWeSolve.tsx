import { Link } from "react-router-dom";
import { useSeo } from "../lib/useSeo";

interface ProblemCard {
  problem: string;
  solution: string;
  feature: string;
  example: string;
  pro?: boolean;
}

const problems: ProblemCard[] = [
  {
    problem: "\"I don't actually know where my salary goes every month.\"",
    solution:
      "Rupee Radar AI reads your bank and card transaction SMS on your device and auto-categorises every spend — no manual entry, no linking your bank account.",
    feature: "SMS-based auto-tracking",
    example:
      "A Swiggy order for ₹380 shows up as Food, an Airtel payment as Bills, an Amazon order as Shopping — within seconds of the SMS arriving, with zero typing.",
  },
  {
    problem: "\"I keep paying for subscriptions and fees I forgot about.\"",
    solution:
      "Money Leaks scans your spending for forgotten subscriptions, sneaky bank fees, duplicate charges, and creeping category spend — then adds up exactly how much you could get back.",
    feature: "Money Leaks",
    pro: true,
    example:
      "A real account found ₹3,965/month recoverable: an unused Netflix Premium (₹599), an unused gym membership (₹2,499), a credit-card annual fee (₹900), and a duplicate ₹1,700 Amazon charge.",
  },
  {
    problem: "\"I never know which of my cards actually earns the most at a store.\"",
    solution:
      "Add the cards you own and Rupee Radar AI tells you, per store or category, which one to swipe — based on each card's real, published reward terms.",
    feature: "Best Card Recommender + Mall Mode",
    example:
      "At checkout in a mall, the app flags that your Cashback SBI Card earns 5% here vs your default card's 1% — a swap worth noticing before you tap the machine, not after.",
  },
  {
    problem: "\"If I lost my income tomorrow, I have no idea how long I'd survive.\"",
    solution:
      "Safety Net turns your savings and essential monthly spend into a plain number: how many months you could cover with zero income, plus your savings rate and debt-to-income ratio against healthy benchmarks.",
    feature: "Safety Net",
    pro: true,
    example: "\"You could cover 4 months of essential expenses with no income\" — a number most people have genuinely never calculated for themselves.",
  },
  {
    problem: "\"My loans and credit card debt feel unmanageable — I don't know what to pay off first.\"",
    solution:
      "Debt Freedom simulates your exact payoff timeline both ways — snowball (smallest balance first) and avalanche (highest interest first) — and shows how much extra ₹500/month would actually save you.",
    feature: "Debt Freedom planner",
    pro: true,
    example: "\"Debt-free by March 2028, avalanche order, ₹42,000 saved in interest\" — a concrete date and number instead of a vague sense of dread.",
  },
  {
    problem: "\"I set a budget once and never know if I'm actually sticking to it.\"",
    solution: "Budgets tracks your spend against a monthly limit per category in real time, computed straight from your auto-tracked transactions.",
    feature: "Budgets",
    example: "A Food budget of ₹5,300 fills to 75% mid-month with an \"On track\" flag — not a spreadsheet you forgot to update.",
  },
  {
    problem: "\"I want to save for something specific but keep dipping into it.\"",
    solution: "Goals tracks a target amount and date for anything — a trip, a gadget, a deposit — and tells you if you're on pace or falling behind.",
    feature: "Goals",
    example: "\"Goa Trip — ₹40,000 target, 62% saved, on track for your December date.\"",
  },
  {
    problem: "\"I don't know if I'm actually getting wealthier or just treading water.\"",
    solution: "Net Worth tracks assets minus liabilities month over month, with a projection of where you're headed at your current savings rate.",
    feature: "Net Worth + projection",
    example: "A real account's net worth climbed ₹2,10,000 → ₹2,60,000 across four months, visible as a simple upward line, not twelve numbers to mentally subtract.",
  },
  {
    problem: "\"I miss EMI and bill due dates and only notice when the late fee hits.\"",
    solution:
      "Bills & Subscriptions auto-detects recurring EMIs, card bills and subscriptions from your SMS and keeps an upcoming-payments calendar; the in-app Companion nudges you before a bill is due.",
    feature: "Bills & Subscriptions + Companion nudges",
    example: "\"Your Airtel bill is due in 3 days\" — surfaced on the dashboard automatically, not something you have to go looking for.",
  },
  {
    problem: "\"I don't really understand things like EMI interest, credit scores, or the new tax regime.\"",
    solution:
      "Money Basics is a free, India-specific library covering budgeting rules, EMI/compound interest, credit scores, debt payoff strategy, SIPs, FDs, and old-vs-new tax regime — in plain language, linked to the exact feature that puts it into practice.",
    feature: "Money Basics",
    example: "An article on snowball vs avalanche debt payoff links straight into the Debt Freedom planner so you can try it on your own numbers immediately.",
  },
  {
    problem: "\"Logging an expense by hand feels like a chore, so I just stop doing it.\"",
    solution:
      "Quick Capture lets you dictate or type a freeform sentence — \"spent 500 on groceries, netflix is 649 a month\" — and the app parses it into ready-to-confirm expense and subscription entries. Nothing is saved until you tap Add.",
    feature: "Quick Capture",
    pro: true,
    example: "One spoken sentence after a shopping trip becomes a categorised expense entry in seconds, no form-filling.",
  },
  {
    problem: "\"I have no single number for whether my finances are actually healthy.\"",
    solution:
      "The Financial Health Score combines your savings rate, budget adherence, bill diligence, spending diversification, and safety net into one 0–100 score you can watch improve over time.",
    feature: "Financial Health Score",
    example: "A score climbing from the low 50s into the 80s over a few months of using the app — a single number that reflects real behaviour change.",
  },
];

export default function ProblemsWeSolve() {
  useSeo({
    title: "Money Problems Rupee Radar AI Solves — Real Examples",
    description:
      "See exactly which everyday money problems Rupee Radar AI solves — forgotten subscriptions, wrong credit card, no emergency fund, unmanageable debt — with real examples.",
    canonical: "https://rupeeradarai.com/problems-we-solve",
  });

  return (
    <div>
      <section className="max-w-5xl mx-auto px-6 py-16 text-center">
        <h1 className="text-3xl md:text-4xl font-bold mb-4">
          The money problems Rupee Radar AI actually solves.
        </h1>
        <p className="text-lg text-app-muted max-w-2xl mx-auto mb-8">
          Not a features list — real problems people have with their money, the exact feature that
          solves each one, and a real example of it working.
        </p>
        <Link to="/download" className="bg-brand text-black px-6 py-3 rounded-full font-semibold hover:bg-brand-dark">
          Download the app
        </Link>
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-16 space-y-6">
        {problems.map((p) => (
          <div key={p.feature} className="glass-card p-6">
            <p className="text-lg font-semibold text-app-text mb-2">{p.problem}</p>
            <p className="text-app-muted mb-3">{p.solution}</p>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand">{p.feature}</span>
              {p.pro && (
                <span className="text-[10px] font-bold uppercase tracking-wide bg-gold/15 text-gold px-2 py-0.5 rounded-full">
                  PRO
                </span>
              )}
            </div>
            <div className="text-sm text-app-muted bg-app-bg/60 border border-app-border rounded-lg px-4 py-3">
              <span className="font-medium text-app-text">Example: </span>
              {p.example}
            </div>
          </div>
        ))}
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <p className="text-app-muted mb-6">
          Everything above except the items marked PRO is completely free. Try PRO from{" "}
          <Link to="/pricing" className="text-brand hover:underline">₹200/week</Link>, cancel anytime.
        </p>
        <Link to="/download" className="bg-brand text-black px-6 py-3 rounded-full font-semibold hover:bg-brand-dark">
          Download the app
        </Link>
      </section>
    </div>
  );
}
