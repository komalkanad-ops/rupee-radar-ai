import { FormEvent, useEffect, useState } from "react";
import { Gift, Ticket } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { SkeletonRows } from "../components/Skeleton";

interface TrialCodeState {
  code: string | null;
  active: boolean;
}

function TrialCodeCard() {
  const [state, setState] = useState<TrialCodeState>({ code: null, active: false });
  const [codeInput, setCodeInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function reload() {
    setLoading(true);
    api<TrialCodeState>("/billing/admin/trial-code")
      .then((s) => {
        setState(s);
        setCodeInput(s.code ?? "");
      })
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function save(next: Partial<{ code: string; active: boolean }>) {
    setSaving(true);
    try {
      const updated = await api<TrialCodeState>("/billing/admin/trial-code", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setState(updated);
      setCodeInput(updated.code ?? "");
      toast.show("Trial code updated");
    } catch (err: any) {
      toast.show(err.message ?? "Failed to update trial code", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Ticket size={16} className="text-brand" />
        <h2 className="text-sm font-semibold text-brand-dark">Shared trial code</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        One code, shared across every user, redeemable from the app's Profile screen for a one-day PRO trial —
        each account can redeem it exactly once, ever. Doesn't apply to an account that already has active PRO.
        Changing the code here takes effect immediately, no deploy or env-var edit needed.
      </p>
      {loading ? (
        <div className="text-xs text-slate-400">Loading…</div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="e.g. RRADAR-TRIAL"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
          />
          <button
            type="button"
            disabled={saving || !codeInput.trim()}
            onClick={() => save({ code: codeInput.trim() })}
            className="rounded-md bg-brand text-white text-sm font-medium px-3 py-2 hover:bg-brand-dark disabled:opacity-50"
          >
            Save code
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-600 ml-2">
            <input
              type="checkbox"
              checked={state.active}
              disabled={saving}
              onChange={(e) => save({ active: e.target.checked })}
            />
            Active (users can redeem it)
          </label>
        </div>
      )}
    </div>
  );
}

interface ProPurchase {
  id: string;
  orderId: string;
  plan: string;
  amountInr: number;
  email: string | null;
  phone: string;
  status: string;
  voucherCode: string | null;
  voucherRedeemed: boolean;
  redeemedByUserId: string | null;
  redeemedAt: string | null;
  sandbox: boolean;
  createdAt: string;
}

const inputCls = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const PLANS = ["WEEKLY", "MONTHLY", "YEARLY"] as const;

export default function ProVouchers() {
  const [items, setItems] = useState<ProPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: "", phone: "", plan: "YEARLY" as (typeof PLANS)[number] });
  const [saving, setSaving] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const toast = useToast();

  function reload() {
    setLoading(true);
    api<ProPurchase[]>("/pro-purchase/admin/purchases").then(setItems).finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.email.trim() && !form.phone.trim()) {
      toast.show("Enter an email or a phone number", "error");
      return;
    }
    setSaving(true);
    try {
      const created = await api<ProPurchase>("/pro-purchase/admin/grant", {
        method: "POST",
        body: JSON.stringify({
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          plan: form.plan,
        }),
      });
      setLastCode(created.voucherCode);
      toast.show(`Voucher ${created.voucherCode} created`);
      setForm({ email: "", phone: "", plan: "YEARLY" });
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to grant voucher", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">PRO Vouchers</h1>
      <p className="text-sm text-slate-500 mb-6">
        Every real Cashfree purchase from <code className="bg-slate-100 px-1 rounded">rupeeradarai.com/pricing</code> lands
        here. Use the form below to hand-grant a free/comp PRO voucher to a specific email or phone number
        (test devices, support cases) — no Cashfree call involved, redeemed through the exact same in-app flow
        real buyers use (PRO screen → "Bought PRO on the website?").
      </p>

      <TrialCodeCard />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-4 grid grid-cols-3 gap-3">
        <input
          placeholder="Email (optional if phone given)"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className={inputCls}
        />
        <input
          placeholder="Phone (optional if email given)"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className={inputCls}
        />
        <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as (typeof PLANS)[number] })} className={inputCls}>
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={saving}
          className="col-span-3 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50"
        >
          <Gift size={15} /> {saving ? "Generating..." : "Generate voucher"}
        </button>
      </form>

      {lastCode && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm">
          Voucher code: <code className="bg-white px-2 py-0.5 rounded font-mono font-semibold">{lastCode}</code> —
          redeem it in the app with the same email or phone entered above.
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Email / Phone</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Redeemed</th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={7}>
                  <SkeletonRows rows={5} cols={7} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    No purchases yet.
                  </td>
                </tr>
              )}
              {items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(p.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">{p.plan}</td>
                  <td className="px-4 py-3">
                    {p.amountInr === 0 ? <span className="text-xs text-slate-400">comp</span> : `₹${p.amountInr}`}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {p.email && <div>{p.email}</div>}
                    <div>{p.phone !== "0000000000" ? p.phone : ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        p.status === "PAID"
                          ? "bg-emerald-100 text-emerald-700"
                          : p.status.startsWith("PAYMENT_")
                            ? "bg-red-100 text-red-700"
                            : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {p.status}
                    </span>
                    {p.sandbox && <span className="ml-1 text-[10px] text-amber-600">sandbox</span>}
                  </td>
                  <td className="px-4 py-3">
                    {p.voucherCode ? <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">{p.voucherCode}</code> : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {p.voucherRedeemed ? `${new Date(p.redeemedAt!).toLocaleDateString()}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
