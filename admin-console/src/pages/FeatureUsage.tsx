import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { SkeletonRows } from "../components/Skeleton";
import { useToast } from "../components/Toast";

/* ------------------------------------------------------------------ types */

interface ScreenRow {
  screen: string;
  events: number;
  distinctUsers: number;
}
interface DayRow {
  date: string;
  screens: { screen: string; count: number }[];
}
interface Summary {
  totalEvents: number;
  screens: ScreenRow[];
  daily: DayRow[];
}

interface PrimaryDevice {
  model: string | null;
  manufacturer: string | null;
  osVersion: string | null;
  appVersionName: string | null;
}
interface UserRow {
  userId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  authProvider: string | null;
  signInMethod: string;
  accountCreatedAt: string | null;
  deviceCount: number;
  primaryDevice: PrimaryDevice | null;
  isPro: boolean;
  totalEvents: number;
  distinctScreens: number;
  topScreen: string | null;
  bugReportCount: number;
  firstSeen: string;
  lastSeen: string;
}
interface ByUserResponse {
  totalUsers: number;
  users: UserRow[];
}

interface FeedEvent {
  id: string;
  createdAt: string;
  screen: string;
  action: string | null;
  userId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  signInMethod: string;
}
interface FeedResponse {
  total: number;
  limit: number;
  offset: number;
  events: FeedEvent[];
}

interface UserDetail {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    authProvider: string | null;
    signInMethod: string;
    persona: string | null;
    city: string | null;
    incomeBracket: string | null;
    createdAt: string;
    lastLoginAt: string | null;
    isPro: boolean;
    proExpiryAt: string | null;
  };
  devices: {
    deviceIdentifier: string;
    platform: string;
    deviceModel: string | null;
    deviceManufacturer: string | null;
    osVersion: string | null;
    appVersionName: string | null;
    appVersionCode: number | null;
    digestOptIn: boolean;
    createdAt: string;
    lastSeenAt: string;
  }[];
  screenBreakdown: { screen: string; count: number }[];
  totalEvents: number;
  timeline: { id: string; screen: string; action: string | null; createdAt: string }[];
  limit: number;
  offset: number;
}

interface AuthFunnel {
  byProvider: { provider: string; count: number }[];
  byMethod: { method: string; count: number }[];
  signupsByDay: { date: string; providers: { provider: string; count: number }[] }[];
  loginActions: { action: string; count: number }[];
  loginActionsByDay: { date: string; actions: { action: string; count: number }[] }[];
}

/* ------------------------------------------------------------------ constants */

// Friendly labels for the app's screen routes. Screens not opened by anyone still show as a real
// 0 row in the Screens tab — that's the "least used / not used at all" answer.
const KNOWN_SCREENS: Record<string, string> = {
  dashboard: "Home",
  cards: "Cards",
  expenses: "Expenses",
  recurring: "Bills & Subscriptions",
  todo: "Todo",
  networth: "Net Worth",
  "cards/{cardId}": "Card Detail",
  insights: "Insights",
  nearby: "Nearby",
  "mall-mode": "Mall Mode",
  "statement-analyzer": "Statement Analyzer",
  pro: "PRO",
  settings: "Settings",
  wallet: "Wallet",
  challenges: "Challenges",
  profile: "Profile",
  login: "Sign in",
  cashflow: "Cash Flow",
  tax: "Tax Nudges",
  household: "Family Vault",
  offers: "Offers",
  benchmark: "Peer Comparison",
  rewards: "Rewards",
  "bank-link": "Link Your Bank",
  "credit-score": "Credit Score",
  "bill-payment/{amount}": "Pay Bill",
  "spend-breakdown": "Spending Overview",
  lending: "Lending Tracker",
  "bank-balances": "Bank Balances",
  "health-score-detail": "Health Score",
  loans: "Loan & EMI Tracker",
  savings: "Savings Tracker",
  ai_chat: "AI Assistant",
  parking: "Parking & Tolls",
  products: "Products & Warranty",
  wishlist: "Wishlist",
  "arrange-services": "Arrange Services",
};
const screenLabel = (route: string) => KNOWN_SCREENS[route] ?? route;

const PROVIDERS = [
  { value: "", label: "All sign-in methods" },
  { value: "google", label: "Google" },
  { value: "phone_custom", label: "Phone OTP (custom)" },
  { value: "phone_firebase", label: "Phone OTP (Firebase)" },
  { value: "anonymous", label: "Anonymous" },
];

const TABS = ["Users", "Activity feed", "Sign-in", "Screens"] as const;
type Tab = (typeof TABS)[number];

/* ------------------------------------------------------------------ helpers */

function userDisplay(u: { name: string | null; email: string | null; phone: string | null; userId?: string; id?: string }) {
  return u.name || u.email || u.phone || (u.userId ?? u.id ?? "—");
}
function fmt(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function methodBadge(method: string) {
  const styles: Record<string, string> = {
    Google: "bg-sky-100 text-sky-700",
    "Phone OTP": "bg-violet-100 text-violet-700",
    Anonymous: "bg-slate-100 text-slate-500",
    Unknown: "bg-slate-100 text-slate-400",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${styles[method] ?? "bg-slate-100 text-slate-500"}`}>{method}</span>;
}
function deviceText(d: PrimaryDevice | null) {
  if (!d) return "—";
  const name = [d.manufacturer, d.model].filter(Boolean).join(" ") || d.model || "Unknown device";
  return d.osVersion ? `${name} · ${d.osVersion}` : name;
}

/* ================================================================== page */

export default function FeatureUsage() {
  const [tab, setTab] = useState<Tab>("Users");
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">User Activity</h1>
      <p className="text-sm text-slate-500 mb-4">
        Who is using the app, on what device, how they signed in, and every screen they open — with
        sorting and date filters. Admin-only; same data exposure as the Users page.
      </p>

      <div className="mb-5 flex gap-1 rounded-md bg-slate-100 p-0.5 text-sm w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 ${tab === t ? "bg-white shadow-sm font-medium text-brand-dark" : "text-slate-500"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Users" && <UsersTab onOpenUser={setDetailUserId} />}
      {tab === "Activity feed" && <FeedTab onOpenUser={setDetailUserId} />}
      {tab === "Sign-in" && <SignInTab />}
      {tab === "Screens" && <ScreensTab />}

      {detailUserId && <UserDrawer userId={detailUserId} onClose={() => setDetailUserId(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Users tab */

const USER_SORTS: { key: string; label: string }[] = [
  { key: "lastSeen", label: "Last active" },
  { key: "firstSeen", label: "First seen" },
  { key: "events", label: "Events" },
  { key: "screens", label: "Screens" },
  { key: "accountCreatedAt", label: "Joined" },
];

function UsersTab({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const toast = useToast();
  const [data, setData] = useState<ByUserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("lastSeen");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [provider, setProvider] = useState("");
  const [q, setQ] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ sort, order });
    if (provider) p.set("provider", provider);
    if (q) p.set("q", q);
    if (since) p.set("since", since);
    if (until) p.set("until", until);
    api<ByUserResponse>(`/feature-usage/by-user?${p}`)
      .then(setData)
      .catch((e) => toast.show(e.message ?? "Failed to load users", "error"))
      .finally(() => setLoading(false));
  }, [sort, order, provider, q, since, until, toast]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  function toggleSort(key: string) {
    if (sort === key) setOrder((o) => (o === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setOrder("desc");
    }
  }
  const arrow = (key: string) => (sort === key ? (order === "desc" ? " ↓" : " ↑") : "");

  return (
    <div>
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <input
          placeholder="Search name / email / phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm w-56"
        />
        <label className="text-xs text-slate-400">Active since</label>
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <label className="text-xs text-slate-400">until</label>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <span className="text-xs text-slate-400 ml-auto">{data?.totalUsers ?? 0} users</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Sign-in</th>
              <th className="px-4 py-3">Device</th>
              <th className="px-4 py-3">App</th>
              <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("events")}>Events{arrow("events")}</th>
              <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("screens")}>Screens{arrow("screens")}</th>
              <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("firstSeen")}>First seen{arrow("firstSeen")}</th>
              <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("lastSeen")}>Last active{arrow("lastSeen")}</th>
              <th className="px-4 py-3">PRO</th>
            </tr>
          </thead>
          {loading ? (
            <tbody><tr><td colSpan={9}><SkeletonRows rows={8} cols={9} /></td></tr></tbody>
          ) : (
            <tbody className="divide-y divide-slate-100">
              {(data?.users ?? []).map((u) => (
                <tr key={u.userId} className="hover:bg-slate-50 cursor-pointer" onClick={() => onOpenUser(u.userId)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-brand-dark">{userDisplay(u)}</div>
                    {u.name && (u.email || u.phone) && (
                      <div className="text-xs text-slate-400">{u.email ?? u.phone}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">{methodBadge(u.signInMethod)}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{deviceText(u.primaryDevice)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{u.primaryDevice?.appVersionName ?? "—"}</td>
                  <td className="px-4 py-3">{u.totalEvents}</td>
                  <td className="px-4 py-3">{u.distinctScreens}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmt(u.firstSeen)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmt(u.lastSeen)}</td>
                  <td className="px-4 py-3">
                    {u.isPro ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">PRO</span> : <span className="text-xs text-slate-400">Free</span>}
                  </td>
                </tr>
              ))}
              {(data?.users.length ?? 0) === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No activity logged yet.</td></tr>
              )}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Activity feed tab */

function FeedTab({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const toast = useToast();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [screen, setScreen] = useState("");
  const [provider, setProvider] = useState("");
  const [q, setQ] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  const load = useCallback(
    (nextOffset: number, append: boolean) => {
      setLoading(true);
      const p = new URLSearchParams({ order, limit: String(LIMIT), offset: String(nextOffset) });
      if (screen) p.set("screen", screen);
      if (provider) p.set("provider", provider);
      if (q) p.set("userId", q.trim());
      if (since) p.set("since", since);
      if (until) p.set("until", until);
      api<FeedResponse>(`/feature-usage/events?${p}`)
        .then((res) => {
          setData((prev) => (append && prev ? { ...res, events: [...prev.events, ...res.events] } : res));
          setOffset(nextOffset);
        })
        .catch((e) => toast.show(e.message ?? "Failed to load activity", "error"))
        .finally(() => setLoading(false));
    },
    [order, screen, provider, q, since, until, toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(0, false), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const shown = data?.events.length ?? 0;
  const total = data?.total ?? 0;

  return (
    <div>
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <select value={screen} onChange={(e) => setScreen(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">All screens</option>
          {Object.entries(KNOWN_SCREENS).map(([route, label]) => (
            <option key={route} value={route}>{label}</option>
          ))}
        </select>
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <input placeholder="Filter by user ID" value={q} onChange={(e) => setQ(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm w-44" />
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <button onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600">
          Time {order === "desc" ? "↓ newest" : "↑ oldest"}
        </button>
        <span className="text-xs text-slate-400 ml-auto">{shown} of {total.toLocaleString("en-IN")}</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3 w-48">Time</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Screen</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          {loading && !data ? (
            <tbody><tr><td colSpan={4}><SkeletonRows rows={10} cols={4} /></td></tr></tbody>
          ) : (
            <tbody className="divide-y divide-slate-100">
              {(data?.events ?? []).map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{fmt(e.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <button className="text-brand hover:text-brand-dark text-left" onClick={() => onOpenUser(e.userId)}>
                      {userDisplay(e)}
                    </button>
                    <span className="ml-2">{methodBadge(e.signInMethod)}</span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{screenLabel(e.screen)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{e.action ?? <span className="text-slate-300">open</span>}</td>
                </tr>
              ))}
              {shown === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No events match.</td></tr>
              )}
            </tbody>
          )}
        </table>
        {shown < total && (
          <div className="p-3 text-center border-t border-slate-100">
            <button onClick={() => load(offset + LIMIT, true)} disabled={loading} className="text-sm text-brand hover:text-brand-dark disabled:opacity-50">
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Sign-in tab */

function SignInTab() {
  const toast = useToast();
  const [data, setData] = useState<AuthFunnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (since) p.set("since", since);
    if (until) p.set("until", until);
    api<AuthFunnel>(`/feature-usage/auth-funnel?${p}`)
      .then(setData)
      .catch((e) => toast.show(e.message ?? "Failed to load funnel", "error"))
      .finally(() => setLoading(false));
  }, [since, until, toast]);

  const funnelOrder = ["google_tapped", "otp_requested", "otp_submitted", "otp_success", "google_success"];
  const actionLabels: Record<string, string> = {
    google_tapped: "Google tapped",
    google_success: "Google — signed in",
    otp_requested: "OTP requested",
    otp_submitted: "OTP submitted",
    otp_success: "OTP — signed in",
    "(screen open)": "Sign-in screen opened",
  };
  const actionCount = (a: string) => data?.loginActions.find((x) => x.action === a)?.count ?? 0;
  const maxAction = Math.max(1, ...(data?.loginActions.map((a) => a.count) ?? [1]));

  if (loading) return <div className="bg-white rounded-xl shadow-sm p-5"><SkeletonRows rows={6} cols={2} /></div>;

  return (
    <div className="space-y-6">
      <div className="flex gap-3 items-center">
        <label className="text-xs text-slate-400">From</label>
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <label className="text-xs text-slate-400">to</label>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(data?.byMethod ?? []).map((m) => (
          <div key={m.method} className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-2xl font-semibold text-brand-dark">{m.count}</div>
            <div className="text-xs text-slate-500 mt-1">{m.method}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Login attempt funnel</h2>
        <p className="text-xs text-slate-400 mb-4">
          Attempt-level events from the sign-in screen. Only populated from app v1.0.5 onward — earlier
          installs contribute to the method totals above (from account records) but not this funnel.
        </p>
        <div className="space-y-2">
          {funnelOrder.map((a) => (
            <div key={a} className="flex items-center gap-3">
              <div className="w-40 text-xs text-slate-600 shrink-0">{actionLabels[a] ?? a}</div>
              <div className="flex-1 bg-slate-100 rounded h-6 overflow-hidden">
                <div className="bg-brand h-full rounded" style={{ width: `${(actionCount(a) / maxAction) * 100}%` }} />
              </div>
              <div className="w-12 text-right text-sm tabular-nums">{actionCount(a)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">New sign-ups by day</h2>
        {data && data.signupsByDay.length > 0 ? (
          <div className="space-y-2">
            {data.signupsByDay.map((d) => (
              <div key={d.date} className="flex items-center gap-3 text-xs">
                <span className="w-24 text-slate-500 shrink-0">{d.date}</span>
                <div className="flex flex-wrap gap-1.5">
                  {d.providers.map((p) => (
                    <span key={p.provider} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {p.provider}: {p.count}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No sign-ups in range.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Screens tab */

function ScreensTab() {
  const toast = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (since) p.set("since", since);
    if (until) p.set("until", until);
    api<Summary>(`/feature-usage/summary?${p}`)
      .then(setSummary)
      .catch((e) => toast.show(e.message ?? "Failed to load", "error"))
      .finally(() => setLoading(false));
  }, [since, until, toast]);

  const evented = new Set(summary?.screens.map((s) => s.screen) ?? []);
  const zeroRows: ScreenRow[] = Object.keys(KNOWN_SCREENS)
    .filter((r) => !evented.has(r))
    .map((r) => ({ screen: r, events: 0, distinctUsers: 0 }));
  const allScreens = [...(summary?.screens ?? []), ...zeroRows];

  return (
    <div>
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex gap-3 items-center">
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <span className="text-xs text-slate-400 ml-auto">{summary?.totalEvents ?? 0} events</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Screen</th>
              <th className="px-4 py-3">Visits</th>
              <th className="px-4 py-3">Distinct users</th>
            </tr>
          </thead>
          {loading ? (
            <tbody><tr><td colSpan={3}><SkeletonRows rows={6} cols={3} /></td></tr></tbody>
          ) : (
            <tbody className="divide-y divide-slate-100">
              {allScreens.map((row) => (
                <tr key={row.screen} className={row.events === 0 ? "text-slate-400" : undefined}>
                  <td className="px-4 py-3 font-medium">{screenLabel(row.screen)}</td>
                  <td className="px-4 py-3">{row.events}</td>
                  <td className="px-4 py-3">{row.distinctUsers}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Daily breakdown</h2>
        {loading ? (
          <SkeletonRows rows={4} cols={1} />
        ) : summary && summary.daily.length > 0 ? (
          <div className="space-y-3">
            {summary.daily.map((day) => (
              <div key={day.date}>
                <div className="text-xs font-semibold text-slate-500 mb-1">{day.date}</div>
                <div className="flex flex-wrap gap-2">
                  {day.screens.map((s) => (
                    <span key={s.screen} className="px-2 py-1 rounded-full bg-slate-100 text-xs text-slate-700">
                      {screenLabel(s.screen)}: {s.count}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No usage logged yet.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ user drawer */

function UserDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const LIMIT = 200;

  const load = useCallback(
    (nextOffset: number, append: boolean) => {
      setLoading(true);
      api<UserDetail>(`/feature-usage/user/${encodeURIComponent(userId)}?limit=${LIMIT}&offset=${nextOffset}`)
        .then((res) => {
          setData((prev) => (append && prev ? { ...res, timeline: [...prev.timeline, ...res.timeline] } : res));
          setOffset(nextOffset);
        })
        .catch((e) => toast.show(e.message ?? "Failed to load user", "error"))
        .finally(() => setLoading(false));
    },
    [userId, toast],
  );

  useEffect(() => {
    load(0, false);
  }, [load]);

  const maxScreen = useMemo(() => Math.max(1, ...(data?.screenBreakdown.map((s) => s.count) ?? [1])), [data]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white h-full shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-brand-dark">
            {data ? userDisplay(data.user) : "User"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {loading && !data ? (
          <div className="p-5"><SkeletonRows rows={8} cols={2} /></div>
        ) : data ? (
          <div className="p-5 space-y-6">
            <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label="Sign-in">{methodBadge(data.user.signInMethod)}</Field>
              <Field label="PRO">{data.user.isPro ? `PRO${data.user.proExpiryAt ? ` until ${fmt(data.user.proExpiryAt)}` : ""}` : "Free"}</Field>
              <Field label="Email">{data.user.email ?? "—"}</Field>
              <Field label="Phone">{data.user.phone ?? "—"}</Field>
              <Field label="Persona">{data.user.persona ?? "—"}</Field>
              <Field label="City">{data.user.city ?? "—"}</Field>
              <Field label="Joined">{fmt(data.user.createdAt)}</Field>
              <Field label="Last login">{fmt(data.user.lastLoginAt)}</Field>
              <Field label="User ID"><span className="font-mono text-xs">{data.user.id}</span></Field>
            </section>

            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">Devices ({data.devices.length})</h3>
              {data.devices.length === 0 ? (
                <p className="text-sm text-slate-400">No device registered (never opened push / pre-1.0.5).</p>
              ) : (
                <div className="space-y-2">
                  {data.devices.map((d) => (
                    <div key={d.deviceIdentifier} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="font-medium">
                        {[d.deviceManufacturer, d.deviceModel].filter(Boolean).join(" ") || "Unknown device"}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {d.osVersion ?? "OS unknown"} · app {d.appVersionName ?? "?"}
                        {d.appVersionCode ? ` (${d.appVersionCode})` : ""} · {d.digestOptIn ? "digests on" : "digests off"}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        first seen {fmt(d.createdAt)} · last seen {fmt(d.lastSeenAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">Screens used</h3>
              <div className="space-y-1.5">
                {data.screenBreakdown.map((s) => (
                  <div key={s.screen} className="flex items-center gap-2 text-xs">
                    <span className="w-36 shrink-0 text-slate-600">{screenLabel(s.screen)}</span>
                    <div className="flex-1 bg-slate-100 rounded h-4">
                      <div className="bg-brand/70 h-full rounded" style={{ width: `${(s.count / maxScreen) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">
                Activity timeline ({data.totalEvents} events)
              </h3>
              <div className="space-y-1">
                {data.timeline.map((e) => (
                  <div key={e.id} className="flex gap-3 text-xs py-1 border-b border-slate-50">
                    <span className="text-slate-400 w-40 shrink-0">{fmt(e.createdAt)}</span>
                    <span className="font-medium">{screenLabel(e.screen)}</span>
                    {e.action && <span className="text-slate-500">· {e.action}</span>}
                  </div>
                ))}
              </div>
              {data.timeline.length < data.totalEvents && (
                <button onClick={() => load(offset + LIMIT, true)} disabled={loading} className="mt-3 text-sm text-brand hover:text-brand-dark disabled:opacity-50">
                  {loading ? "Loading…" : "Load more"}
                </button>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-700">{children}</div>
    </div>
  );
}
