import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

interface Correction {
  id: string;
  field: string;
  proposedValue: string;
  note: string | null;
  llmDiffSummary: string | null;
  status: string;
  createdAt: string;
  card: { id: string; name: string; bank: { name: string } };
}

export default function Corrections() {
  const [items, setItems] = useState<Correction[]>([]);
  const [status, setStatus] = useState("PENDING");

  function reload() {
    api<Correction[]>(`/corrections?status=${status}`).then(setItems);
  }

  useEffect(reload, [status]);

  async function decide(id: string, action: "approve" | "reject") {
    await api(`/corrections/${id}/${action}`, { method: "POST" });
    reload();
  }

  async function summarize(id: string) {
    await api(`/corrections/${id}/summarize`, { method: "POST" });
    reload();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-brand-dark">Corrections Queue</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="space-y-3">
        {items.length === 0 && <p className="text-sm text-slate-400">Nothing here.</p>}
        {items.map((c) => (
          <div key={c.id} className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex justify-between items-start">
              <div>
                <Link to={`/cards/${c.card.id}`} className="font-medium text-brand hover:underline">
                  {c.card.bank.name} — {c.card.name}
                </Link>
                <p className="text-sm text-slate-500 mt-1">
                  Field: <span className="font-medium">{c.field}</span> → {c.proposedValue}
                </p>
                {c.note && <p className="text-sm text-slate-500 mt-1">User note: {c.note}</p>}
                {c.llmDiffSummary && (
                  <p className="text-sm text-slate-500 italic mt-1">AI summary: {c.llmDiffSummary}</p>
                )}
              </div>
              {c.status === "PENDING" && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => decide(c.id, "approve")}
                    className="text-xs bg-brand text-white px-3 py-1.5 rounded-md hover:bg-brand-dark"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => decide(c.id, "reject")}
                    className="text-xs bg-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-300"
                  >
                    Reject
                  </button>
                  {c.note && !c.llmDiffSummary && (
                    <button
                      onClick={() => summarize(c.id)}
                      className="text-xs border border-brand text-brand px-3 py-1.5 rounded-md hover:bg-brand-light"
                    >
                      Summarize with AI
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
