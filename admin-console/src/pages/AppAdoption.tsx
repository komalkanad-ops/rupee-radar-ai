import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { SkeletonRows } from "../components/Skeleton";
import { TrendChart } from "../components/charts/TrendChart";

interface AppAdoption {
  downloads: {
    total: number;
    last7Days: number;
    last30Days: number;
    bySource: { source: string; count: number }[];
  };
  installs: {
    totalDevices: number;
    totalUsers: number;
    newDevicesLast7Days: number;
    newDevicesLast30Days: number;
    newUsersLast7Days: number;
    newUsersLast30Days: number;
    activeDevicesLast7Days: number;
    activeDevicesLast30Days: number;
    activeUsersLast7Days: number;
    activeUsersLast30Days: number;
    byAuthProvider: { provider: string; count: number }[];
    proActive: number;
  };
  downloadToInstallRate: number | null;
  versionSpread: { version: string; count: number }[];
  dailySeries: { date: string; downloads: number; newInstalls: number }[];
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-brand-dark mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  anonymous: "No account (skipped sign-in)",
  google: "Google sign-in",
  phone_firebase: "Phone (OTP)",
  phone_custom: "Phone (custom OTP)",
};

export default function AppAdoption() {
  const [data, setData] = useState<AppAdoption | null>(null);
  const [loading, setLoading] = useState(true);
  const { show } = useToast();

  const load = () => {
    setLoading(true);
    api<AppAdoption>("/analytics/app-adoption")
      .then(setData)
      .catch((e) => show(e.message, "error"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-dark">App Adoption</h1>
          <p className="text-sm text-slate-500 mt-1">
            Downloads from the website vs. actual installs. The website has no login, so downloads
            are counts only — there is no per-person download data.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-sm text-slate-500 hover:text-brand-dark">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {loading || !data ? (
        <SkeletonRows rows={6} />
      ) : (
        <>
          <div>
            <h2 className="text-sm font-medium text-slate-500 mb-2">Downloads (website)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total download clicks" value={data.downloads.total.toLocaleString("en-IN")} />
              <StatCard label="Last 30 days" value={data.downloads.last30Days.toLocaleString("en-IN")} />
              <StatCard label="Last 7 days" value={data.downloads.last7Days.toLocaleString("en-IN")} />
              <StatCard
                label="Download → install (30d)"
                value={data.downloadToInstallRate === null ? "—" : `${data.downloadToInstallRate}%`}
                sub="new installs ÷ download clicks"
              />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-medium text-slate-500 mb-2">Installs</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total devices" value={data.installs.totalDevices.toLocaleString("en-IN")} sub="one row per install" />
              <StatCard label="Total user records" value={data.installs.totalUsers.toLocaleString("en-IN")} />
              <StatCard label="New installs (30d)" value={data.installs.newDevicesLast30Days} sub={`${data.installs.newDevicesLast7Days} in last 7d`} />
              <StatCard label="Active (30d)" value={data.installs.activeDevicesLast30Days} sub={`${data.installs.activeDevicesLast7Days} in last 7d`} />
              <StatCard label="PRO users (active)" value={data.installs.proActive} />
              <StatCard label="New users (30d)" value={data.installs.newUsersLast30Days} sub={`${data.installs.newUsersLast7Days} in last 7d`} />
              <StatCard label="Active users (7d)" value={data.installs.activeUsersLast7Days} />
              <StatCard label="Active users (30d)" value={data.installs.activeUsersLast30Days} />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-medium text-slate-500 mb-3">Downloads vs. new installs — last 30 days</h2>
            <div className="flex gap-8 flex-wrap">
              <div>
                <div className="text-xs text-slate-400 mb-1">Download clicks</div>
                <TrendChart data={data.dailySeries.map((d) => ({ label: d.date.slice(5), value: d.downloads }))} variant="line" color="#6366f1" />
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-1">New installs</div>
                <TrendChart data={data.dailySeries.map((d) => ({ label: d.date.slice(5), value: d.newInstalls }))} variant="line" color="#16a34a" />
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h2 className="text-sm font-medium text-slate-500 mb-3">Sign-in method</h2>
              <ul className="space-y-2 text-sm">
                {data.installs.byAuthProvider.map((r) => (
                  <li key={r.provider} className="flex justify-between">
                    <span className="text-slate-600">{PROVIDER_LABELS[r.provider] ?? r.provider}</span>
                    <span className="font-medium text-brand-dark">{r.count.toLocaleString("en-IN")}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-4">
              <h2 className="text-sm font-medium text-slate-500 mb-3">App version (devices seen in 30d)</h2>
              <ul className="space-y-2 text-sm">
                {data.versionSpread.length === 0 && <li className="text-slate-400">No recent devices.</li>}
                {data.versionSpread.map((r) => (
                  <li key={r.version} className="flex justify-between">
                    <span className="text-slate-600">{r.version}</span>
                    <span className="font-medium text-brand-dark">{r.count.toLocaleString("en-IN")}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-4">
              <h2 className="text-sm font-medium text-slate-500 mb-3">Download source</h2>
              <ul className="space-y-2 text-sm">
                {data.downloads.bySource.map((r) => (
                  <li key={r.source} className="flex justify-between">
                    <span className="text-slate-600">{r.source}</span>
                    <span className="font-medium text-brand-dark">{r.count.toLocaleString("en-IN")}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            The full list of signed-in users (with name / email / phone and install date) is on the{" "}
            <a href="/users" className="text-brand hover:underline">Users</a> page.
          </p>
        </>
      )}
    </div>
  );
}
