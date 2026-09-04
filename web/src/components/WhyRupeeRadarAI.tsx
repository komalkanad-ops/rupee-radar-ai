import Reveal from "./Reveal";

// Testimonials/social-proof section, replaced with genuine value props: no real user-testimonial
// data exists anywhere in this app (no admin CMS, no reviews model), and fabricating person-
// attributed quotes would be deceptive marketing — so this lists real, already-true product facts
// instead of invented people.
const valueProps = [
  {
    title: "SMS parsing happens on your phone",
    detail: "Bank SMS never leaves your device for parsing — only the transactions you choose to save sync to your account.",
  },
  {
    title: "Core tracking is free, always",
    detail: "Expense tracking, budgets, subscriptions, and your financial health score cost nothing — no trial, no paywall.",
  },
  {
    title: "Built for Indian banks and UPI",
    detail: "Parsing rules are tuned against real Indian bank SMS formats, not a generic template.",
  },
  {
    title: "PRO is billed through Google Play",
    detail: "No separate payment system to trust — subscriptions go through Play Billing like any other app.",
  },
];

export default function WhyRupeeRadarAI() {
  return (
    <section className="max-w-5xl mx-auto px-6 py-12">
      <Reveal>
        <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center">
          Why Rupee Radar AI
        </h2>
      </Reveal>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {valueProps.map((v, i) => (
          <Reveal key={v.title} delay={(i % 2) * 100} className="glass-card p-5">
            <h3 className="font-semibold mb-1">{v.title}</h3>
            <p className="text-sm text-app-muted">{v.detail}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
