import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { SkeletonRows } from "../components/Skeleton";

interface FeatureUsageRow {
  feature: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface UserUsageRow {
  userId: string;
  label: string;
  authProvider: string | null;
  calls: number;
  totalTokens: number;
  features: string[];
}

interface MeshLiveModelRow {
  model: string;
  requests: number;
  error_requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: string;
}

interface MeshLiveUsage {
  total_requests: number;
  successful_requests: number;
  error_requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost_usd: string;
  by_model: MeshLiveModelRow[];
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-xl font-semibold text-brand-dark mt-1">{value}</div>
    </div>
  );
}

export default function MeshUsage() {
  const [featureUsage, setFeatureUsage] = useState<FeatureUsageRow[]>([]);
  const [totalCalls, setTotalCalls] = useState(0);
  const [loadingUsage, setLoadingUsage] = useState(true);

  const [userUsage, setUserUsage] = useState<UserUsageRow[]>([]);
  const [loadingUserUsage, setLoadingUserUsage] = useState(true);

  const [liveUsage, setLiveUsage] = useState<MeshLiveUsage | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const toast = useToast();

  function reloadFeatureUsage() {
    setLoadingUsage(true);
    api<{ totalCalls: number; byFeature: FeatureUsageRow[] }>("/mesh-usage/features")
      .then((res) => {
        setFeatureUsage(res.byFeature);
        setTotalCalls(res.totalCalls);
      })
      .finally(() => setLoadingUsage(false));
  }

  function reloadUserUsage() {
    setLoadingUserUsage(true);
    api<{ totalUsers: number; byUser: UserUsageRow[] }>("/mesh-usage/by-user")
      .then((res) => setUserUsage(res.byUser))
      .finally(() => setLoadingUserUsage(false));
  }

  async function loadLiveUsage() {
    setLoadingLive(true);
    try {
      const data = await api<MeshLiveUsage>("/mesh-usage/live");
      setLiveUsage(data);
    } catch (err: any) {
      toast.show(err.message ?? "Failed to fetch mesh-api usage", "error");
    } finally {
      setLoadingLive(false);
    }
  }

  useEffect(reloadFeatureUsage, []);
  useEffect(reloadUserUsage, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Mesh API Usage</h1>
      <p className="text-sm text-slate-500 mb-6">
        mesh-api's own official account-wide report is the real cost source of truth, parsed below —
        it has no concept of which app feature or user made a given call, only our own internal
        tagging (right two panels) can answer that, and only for activity since that tagging went
        live.
      </p>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">mesh-api official usage report</h2>
          <button
            onClick={loadLiveUsage}
            disabled={loadingLive}
            className="flex items-center gap-1 text-xs text-brand hover:text-brand-dark disabled:opacity-50"
          >
            <RefreshCw size={13} className={loadingLive ? "animate-spin" : ""} /> Fetch
          </button>
        </div>

        {!liveUsage ? (
          <p className="text-sm text-slate-400">Click "Fetch" to pull the live account-wide report.</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <StatCard label="Total requests" value={liveUsage.total_requests.toLocaleString()} />
              <StatCard
                label="Total cost"
                value={`$${Number(liveUsage.total_cost_usd).toFixed(2)}`}
              />
              <StatCard label="Total tokens" value={liveUsage.total_tokens.toLocaleString()} />
              <StatCard
                label="Errors"
                value={`${liveUsage.error_requests} / ${liveUsage.total_requests}`}
              />
            </div>
            <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-500 text-left">
                  <tr>
                    <th className="px-4 py-2">Model</th>
                    <th className="px-4 py-2">Requests</th>
                    <th className="px-4 py-2">Tokens</th>
                    <th className="px-4 py-2">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {liveUsage.by_model.map((m) => (
                    <tr key={m.model}>
                      <td className="px-4 py-2 font-medium">{m.model}</td>
                      <td className="px-4 py-2">{m.requests.toLocaleString()}</td>
                      <td className="px-4 py-2">{m.total_tokens.toLocaleString()}</td>
                      <td className="px-4 py-2">${Number(m.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Usage by feature</h2>
          {loadingUsage ? (
            <SkeletonRows rows={3} cols={2} />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left">
                <tr>
                  <th className="py-1">Feature</th>
                  <th className="py-1">Calls</th>
                  <th className="py-1">Total tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {featureUsage.map((row) => (
                  <tr key={row.feature}>
                    <td className="py-1.5 font-medium">{row.feature}</td>
                    <td className="py-1.5">{row.calls}</td>
                    <td className="py-1.5">{row.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
                {featureUsage.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-slate-400">
                      No mesh-api calls logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <p className="text-xs text-slate-400 mt-2">{totalCalls} total calls logged internally.</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Usage by user</h2>
          {loadingUserUsage ? (
            <SkeletonRows rows={3} cols={2} />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left">
                <tr>
                  <th className="py-1">User</th>
                  <th className="py-1">Calls</th>
                  <th className="py-1">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {userUsage.map((row) => (
                  <tr key={row.userId}>
                    <td className="py-1.5 font-medium truncate max-w-[160px]" title={row.userId}>
                      {row.label}
                    </td>
                    <td className="py-1.5">{row.calls}</td>
                    <td className="py-1.5">{row.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
                {userUsage.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-slate-400">
                      No per-user mesh-api activity logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <p className="text-xs text-slate-400 mt-2">
            Only covers activity since internal per-call logging started — the live report above is
            the only source for anything older, but it has no per-user breakdown at all.
          </p>
        </div>
      </div>
    </div>
  );
}
