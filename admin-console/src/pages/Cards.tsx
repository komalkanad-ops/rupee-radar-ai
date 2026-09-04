import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Upload } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { SkeletonRows } from "../components/Skeleton";
import { CardForm, CardFormData, emptyCardForm, formDataToPayload, Bank } from "../components/CardForm";

interface Card {
  id: string;
  name: string;
  network: string;
  category: string;
  isCashbackCard: boolean;
  joiningFeeInr: number;
  annualFeeInr: number;
  bank: { name: string };
}

const CATEGORIES = ["", "REWARDS", "CASHBACK", "TRAVEL", "FUEL", "LIFESTYLE", "PREMIUM", "BUSINESS", "CO_BRAND"];

export default function Cards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function reload() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    setLoading(true);
    api<Card[]>(`/cards?${params}`)
      .then(setCards)
      .finally(() => setLoading(false));
  }

  useEffect(reload, [search, category]);
  useEffect(() => {
    api<Bank[]>("/banks").then(setBanks).catch(() => {});
  }, []);

  async function handleAdd(form: CardFormData) {
    setSaving(true);
    try {
      await api("/cards", { method: "POST", body: JSON.stringify(formDataToPayload(form)) });
      toast.show("Card created");
      setShowAdd(false);
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to create card", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setImportResult(null);
    try {
      const cardsArray = JSON.parse(importText);
      const result = await api<{ created: number; updated: number; errors: { index: number; error: string }[] }>(
        "/cards/bulk-import",
        { method: "POST", body: JSON.stringify({ cards: cardsArray }) },
      );
      setImportResult(
        `Created ${result.created}, updated ${result.updated}${result.errors.length ? `, ${result.errors.length} error(s)` : ""}.`,
      );
      if (result.errors.length) {
        setImportResult(
          (prev) => `${prev}\n${result.errors.map((e) => `Row ${e.index}: ${e.error}`).join("\n")}`,
        );
      }
      toast.show(`Import done — ${result.created} created, ${result.updated} updated`);
      reload();
    } catch (err: any) {
      setImportResult(err.message ?? "Invalid JSON");
      toast.show("Import failed", "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-brand-dark">Credit Cards</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport((v) => !v)}
            className="flex items-center gap-1.5 text-sm border border-slate-300 px-3 py-2 rounded-md hover:bg-slate-100"
          >
            <Upload size={15} /> Import
          </button>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 text-sm bg-brand text-white px-3 py-2 rounded-md hover:bg-brand-dark"
          >
            <Plus size={15} /> Add card
          </button>
        </div>
      </div>

      {showImport && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h2 className="font-medium mb-1">Bulk import</h2>
          <p className="text-xs text-slate-500 mb-3">
            Paste a JSON array of cards, each with <code>bankName</code> (resolved/created automatically)
            plus the usual card fields. Re-running with the same bankName+name pairs updates existing
            cards instead of duplicating them.
          </p>
          <textarea
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
            rows={8}
            placeholder='[{"bankName": "HDFC Bank", "name": "Millennia", "network": "Visa", "category": "CASHBACK", "joiningFeeInr": 1000, "annualFeeInr": 1000}]'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={handleImport}
              disabled={importing || !importText.trim()}
              className="text-sm bg-brand text-white px-4 py-2 rounded-md hover:bg-brand-dark disabled:opacity-50"
            >
              {importing ? "Importing..." : "Run import"}
            </button>
            {importResult && <pre className="text-xs text-slate-600 whitespace-pre-wrap">{importResult}</pre>}
          </div>
        </div>
      )}

      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h2 className="font-medium mb-3">Add card</h2>
          <CardForm initial={emptyCardForm} banks={banks} onSubmit={handleAdd} submitLabel="Create card" submitting={saving} />
        </div>
      )}

      <div className="flex gap-3 mb-4">
        <input
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm flex-1 max-w-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c || "All categories"}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Bank</th>
              <th className="px-4 py-3">Card</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Network</th>
              <th className="px-4 py-3">Joining Fee</th>
              <th className="px-4 py-3">Annual Fee</th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={6}>
                  <SkeletonRows rows={5} cols={6} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {cards.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    No cards found — add one above or run a bulk import.
                  </td>
                </tr>
              )}
              {cards.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">{c.bank?.name}</td>
                  <td className="px-4 py-3">
                    <Link to={`/cards/${c.id}`} className="text-brand font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.isCashbackCard && (
                      <span className="ml-2 text-xs bg-brand-light text-brand-dark px-2 py-0.5 rounded-full">
                        Cashback
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{c.category}</td>
                  <td className="px-4 py-3">{c.network}</td>
                  <td className="px-4 py-3">₹{c.joiningFeeInr.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3">₹{c.annualFeeInr.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
