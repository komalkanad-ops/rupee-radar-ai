import { useEffect, useRef, useState } from "react";
import { api, API_BASE_URL } from "../lib/api";
import Reveal from "./Reveal";

interface RemoteShot {
  id: string;
  caption: string;
  category: string;
  sortOrder: number;
}

/** A phone-shaped frame. `children` is the "screen". */
function PhoneFrame({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <figure className="shrink-0 w-[230px] snap-center">
      <div className="relative mx-auto w-[230px] h-[470px] rounded-[2.2rem] border-[6px] border-app-border bg-app-bg shadow-2xl overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-app-border rounded-b-2xl z-10" />
        <div className="absolute inset-0 overflow-hidden rounded-[1.7rem]">{children}</div>
      </div>
      {label && <figcaption className="text-center text-sm text-app-muted mt-3 px-2">{label}</figcaption>}
    </figure>
  );
}

function Bar({ w, className = "" }: { w: string; className?: string }) {
  return (
    <div className={`h-2 rounded-full bg-app-border overflow-hidden ${className}`}>
      <div className="h-full rounded-full bg-gradient-to-r from-brand to-blue" style={{ width: w }} />
    </div>
  );
}

function MockDashboard() {
  return (
    <div className="h-full w-full bg-gradient-to-b from-purple/20 to-app-bg p-4 pt-8 text-left">
      <p className="text-xs text-app-muted">Good evening, Kanad</p>
      <p className="text-[10px] text-app-muted mt-3">Net worth</p>
      <p className="text-2xl font-bold">₹14,82,000</p>
      <p className="text-[10px] text-brand">▲ ₹38,400 vs last month</p>
      <div className="mt-4 glass-card p-3 flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-full grid place-items-center text-xs font-bold"
          style={{ background: "conic-gradient(#7c5cff 0 78%, rgba(255,255,255,0.08) 78% 100%)" }}
        >
          <span className="bg-app-bg w-9 h-9 rounded-full grid place-items-center">78</span>
        </div>
        <div>
          <p className="text-xs font-semibold">Financial Health</p>
          <p className="text-[10px] text-app-muted">Good — savings rate strong</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {["Add expense", "Spending", "Goals", "Debt plan"].map((t) => (
          <div key={t} className="glass-card p-2 text-[10px] text-center">{t}</div>
        ))}
      </div>
    </div>
  );
}

function MockSpending() {
  return (
    <div className="h-full w-full bg-gradient-to-b from-blue/15 to-app-bg p-4 pt-8 text-left">
      <p className="text-xs font-semibold">Spending Overview</p>
      <p className="text-[10px] text-app-muted">August 2026</p>
      <div className="flex items-center gap-3 mt-3">
        <div
          className="w-20 h-20 rounded-full"
          style={{
            background:
              "conic-gradient(#7c5cff 0 34%, #2f80ed 34% 58%, #f2994a 58% 76%, #27ae60 76% 88%, rgba(255,255,255,0.1) 88% 100%)",
          }}
        >
          <div className="w-11 h-11 bg-app-bg rounded-full m-[18px] grid place-items-center text-[9px] font-bold">₹52k</div>
        </div>
        <div className="flex-1 space-y-1.5">
          {[
            ["Food & Dining", "₹17,600", "34%"],
            ["Travel", "₹12,400", "24%"],
            ["Shopping", "₹9,300", "18%"],
            ["Bills", "₹6,200", "12%"],
          ].map(([a, b, c]) => (
            <div key={a} className="text-[9px]">
              <div className="flex justify-between"><span>{a}</span><span className="text-app-muted">{b}</span></div>
              <Bar w={c} className="mt-0.5 h-1.5" />
            </div>
          ))}
        </div>
      </div>
      <p className="text-[9px] text-app-muted mt-3">Biggest jump: Travel, up 40% vs July</p>
    </div>
  );
}

function MockDebt() {
  return (
    <div className="h-full w-full bg-gradient-to-b from-emerald-500/15 to-app-bg p-4 pt-8 text-left">
      <p className="text-xs font-semibold">Debt Freedom</p>
      <p className="text-[10px] text-app-muted mt-2">Total owed</p>
      <p className="text-xl font-bold">₹21,40,000</p>
      <p className="text-[10px] text-brand font-semibold mt-1">Debt-free by March 2029</p>
      <div className="flex gap-1.5 mt-3">
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-brand/20 text-brand">Avalanche</span>
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-app-border">Snowball</span>
      </div>
      <div className="mt-3 space-y-2">
        {[
          ["Personal loan", "18% · ₹1,10,000 left", "70%"],
          ["Car loan", "9.5% · ₹4,30,000 left", "35%"],
          ["Home loan", "8.5% · ₹16,00,000 left", "20%"],
        ].map(([a, b, c]) => (
          <div key={a} className="glass-card p-2">
            <div className="flex justify-between text-[9px]"><span className="font-medium">{a}</span><span className="text-app-muted">{b}</span></div>
            <Bar w={c} className="mt-1 h-1.5" />
          </div>
        ))}
      </div>
      <p className="text-[9px] text-app-muted mt-2">+₹5,000/month → 14 months sooner, ₹1.9L less interest</p>
    </div>
  );
}

const MOCKS = [
  { el: <MockDashboard />, label: "Your dashboard — net worth, health score, quick actions" },
  { el: <MockSpending />, label: "Spending Overview — exactly where the money went" },
  { el: <MockDebt />, label: "Debt Freedom — your payoff plan and debt-free date" },
];

export default function AppShowcase() {
  const [shots, setShots] = useState<RemoteShot[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<RemoteShot[]>("/site-content/screenshots")
      .then((s) => setShots(s))
      .catch(() => {});
  }, []);

  const usingReal = shots.length > 0;

  function scrollBy(dir: -1 | 1) {
    scroller.current?.scrollBy({ left: dir * 260, behavior: "smooth" });
  }

  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <Reveal className="text-center mb-10">
        <h2 className="text-2xl md:text-3xl font-bold mb-2">See it in action.</h2>
        <p className="text-app-muted max-w-xl mx-auto">
          A look at the Android app.
        </p>
      </Reveal>

      <div className="relative">
        <div
          ref={scroller}
          className="flex items-start gap-6 overflow-x-auto snap-x snap-mandatory pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {usingReal
            ? shots.map((s) => (
                <figure key={s.id} className="shrink-0 w-[240px] snap-center self-start">
                  <img
                    src={`${API_BASE_URL}/site-content/screenshots/${s.id}/image`}
                    alt={s.caption || "App screenshot"}
                    loading="lazy"
                    className="w-[240px] rounded-[1.6rem] border-[6px] border-app-border bg-app-bg shadow-2xl"
                  />
                  {s.caption && (
                    <figcaption className="text-center text-sm text-app-muted mt-3 px-2 min-h-[2.75rem]">{s.caption}</figcaption>
                  )}
                </figure>
              ))
            : MOCKS.map((m, i) => (
                <PhoneFrame key={i} label={m.label}>
                  {m.el}
                </PhoneFrame>
              ))}
        </div>

        <button
          onClick={() => scrollBy(-1)}
          aria-label="Previous"
          className="hidden md:grid place-items-center absolute -left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-card"
        >
          ‹
        </button>
        <button
          onClick={() => scrollBy(1)}
          aria-label="Next"
          className="hidden md:grid place-items-center absolute -right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-card"
        >
          ›
        </button>
      </div>
    </section>
  );
}
