import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { RefreshCw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { CardForm, CardFormData, Bank, cardToFormData, formDataToPayload } from "../components/CardForm";

interface Correction {
  id: string;
  field: string;
  proposedValue: string;
  note: string | null;
  llmDiffSummary: string | null;
  status: string;
  createdAt: string;
}

interface ChangeLogEntry {
  id: string;
  field: string;
  previousValue: string | null;
  newValue: string;
  changedAt: string;
}

interface Card {
  id: string;
  name: string;
  bank: { id: string; name: string };
  lastVerifiedAt: string | null;
  corrections: Correction[];
  [key: string]: any;
}

export default function CardDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [card, setCard] = useState<Card | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [history, setHistory] = useState<ChangeLogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);

  function reload() {
    api<Card>(`/cards/${id}`).then(setCard);
    api<ChangeLogEntry[]>(`/cards/${id}/history`).then(setHistory).catch(() => {});
  }

  useEffect(() => {
    reload();
    api<Bank[]>("/banks").then(setBanks).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function decide(correctionId: string, action: "approve" | "reject") {
    await api(`/corrections/${correctionId}/${action}`, { method: "POST" });
    toast.show(`Correction ${action}d`);
    reload();
  }

  async function summarize(correctionId: string) {
    await api(`/corrections/${correctionId}/summarize`, { method: "POST" });
    reload();
  }

  async function handleSave(form: CardFormData) {
    if (!card) return;
    setSaving(true);
    try {
      await api(`/cards/${card.id}`, { method: "PUT", body: JSON.stringify(formDataToPayload(form)) });
      toast.show("Card updated");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to update card", "error");
    } finally {
      setSaving(false);
    }
  }

  async function markReverified() {
    if (!card) return;
    setMarking(true);
    try {
      await api(`/cards/${card.id}`, { method: "PUT", body: JSON.stringify({ lastVerifiedAt: new Date().toISOString() }) });
      toast.show("Marked as re-verified today");
      reload();
    } finally {
      setMarking(false);
    }
  }

  async function handleDelete() {
    if (!card) return;
    const ok = await confirm({
      title: "Delete this card?",
      message: `"${card.name}" will be permanently removed from the catalog. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api(`/cards/${card.id}`, { method: "DELETE" });
    toast.show("Card deleted");
    navigate("/cards");
  }

  if (!card) return <p className="text-slate-400">Loading...</p>;

  return (
    <div>
      <Link to="/cards" className="text-sm text-brand hover:underline">
        ← Back to cards
      </Link>
      <div className="flex items-start justify-between mt-2 mb-1">
        <h1 className="text-2xl font-semibold text-brand-dark">
          {card.bank.name} — {card.name}
        </h1>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={markReverified}
            disabled={marking}
            className="flex items-center gap-1.5 text-xs border border-slate-300 px-3 py-1.5 rounded-md hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw size={13} /> Mark re-verified today
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-md hover:bg-red-50"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Last verified: {card.lastVerifiedAt ? new Date(card.lastVerifiedAt).toLocaleDateString() : "never"}
      </p>

      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-medium mb-3">Edit card</h2>
        <CardForm initial={cardToFormData(card)} banks={banks} onSubmit={handleSave} submitLabel="Save changes" submitting={saving} />
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5 mt-6">
        <h2 className="font-medium mb-3">Change history</h2>
        {history.length === 0 && <p className="text-sm text-slate-400">No approved corrections yet — this timeline fills in as corrections get approved.</p>}
        <div className="space-y-2">
          {history.map((h) => (
            <div key={h.id} className="border border-slate-100 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{h.field}</span>
                <span className="text-xs text-slate-400">{new Date(h.changedAt).toLocaleDateString()}</span>
              </div>
              <p className="text-slate-600 mt-1">
                <span className="text-slate-400">{h.previousValue ?? "—"}</span> → {h.newValue}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5 mt-6">
        <h2 className="font-medium mb-3">Corrections for this card</h2>
        {card.corrections.length === 0 && <p className="text-sm text-slate-400">No corrections submitted.</p>}
        <div className="space-y-3">
          {card.corrections.map((c) => (
            <div key={c.id} className="border border-slate-100 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{c.field}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    c.status === "PENDING"
                      ? "bg-amber-100 text-amber-700"
                      : c.status === "APPROVED"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {c.status}
                </span>
              </div>
              <p className="text-slate-600 mt-1">Proposed: {c.proposedValue}</p>
              {c.note && <p className="text-slate-500 mt-1">Note: {c.note}</p>}
              {c.llmDiffSummary && <p className="text-slate-500 italic mt-1">AI summary: {c.llmDiffSummary}</p>}
              {c.status === "PENDING" && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => decide(c.id, "approve")}
                    className="text-xs bg-brand text-white px-3 py-1 rounded-md hover:bg-brand-dark"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => decide(c.id, "reject")}
                    className="text-xs bg-slate-200 px-3 py-1 rounded-md hover:bg-slate-300"
                  >
                    Reject
                  </button>
                  {c.note && !c.llmDiffSummary && (
                    <button
                      onClick={() => summarize(c.id)}
                      className="text-xs border border-brand text-brand px-3 py-1 rounded-md hover:bg-brand-light"
                    >
                      Summarize with AI
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
