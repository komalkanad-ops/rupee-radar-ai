import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { SkeletonRows } from "../components/Skeleton";

interface CountRow {
  count: number;
}
interface PathRow extends CountRow {
  path: string;
}
interface EventTypeRow extends CountRow {
  eventType: string;
}

interface Summary {
  totalEvents: number;
  pageviewsByPath: PathRow[];
  eventsByType: EventTypeRow[];
}

export default function Analytics() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  function reload() {
    setLoading(true);
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    api<Summary>(`/analytics/summary?${params.toString()}`)
      .then(setSummary)
      .finally(() => setLoading(false));
  }

  useEffect(reload, [since, until]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Website Analytics</h1>
      <p className="text-sm text-slate-500 mb-6">
        First-party, self-hosted pageview and conversion-event tracking — no third-party service,
        no external account. Every website page fires a pageview on route change; a few real
        conversion points (Get the app clicks, feedback submissions) fire named events.
      </p>

      <div className="bg-white rounded-xl shadow-sm p-5 mb-4 flex gap-3">
        <input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Pageviews by path</h2>
          {loading ? (
            <SkeletonRows rows={5} cols={2} />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left">
                <tr>
                  <th className="py-1">Path</th>
                  <th className="py-1">Views</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary?.pageviewsByPath.map((row) => (
                  <tr key={row.path}>
                    <td className="py-1.5 font-medium">{row.path}</td>
                    <td className="py-1.5">{row.count}</td>
                  </tr>
                ))}
                {summary?.pageviewsByPath.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-4 text-center text-slate-400">
                      No pageviews logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Events by type</h2>
          {loading ? (
            <SkeletonRows rows={5} cols={2} />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left">
                <tr>
                  <th className="py-1">Event</th>
                  <th className="py-1">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary?.eventsByType.map((row) => (
                  <tr key={row.eventType}>
                    <td className="py-1.5 font-medium">{row.eventType}</td>
                    <td className="py-1.5">{row.count}</td>
                  </tr>
                ))}
                {summary?.eventsByType.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-4 text-center text-slate-400">
                      No events logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <p className="text-xs text-slate-400 mt-2">{summary?.totalEvents ?? 0} total events logged.</p>
        </div>
      </div>
    </div>
  );
}
