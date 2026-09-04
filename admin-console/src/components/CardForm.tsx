import { FormEvent, useState } from "react";

export interface Bank {
  id: string;
  name: string;
}

export interface CardFormData {
  bankId: string;
  name: string;
  network: string;
  category: string;
  isCashbackCard: boolean;
  joiningFeeInr: number;
  annualFeeInr: number;
  feeWaiverCondition: string;
  rewardSpendPerPoint: string;
  rewardPointValueEstInr: string;
  welcomeBenefits: string;
  milestoneBenefits: string;
  loungeAccess: string;
  fuelSurchargeWaiver: string;
  merchantBonusCategories: string;
  eligibilityNotes: string;
  applyUrl: string;
  sourceUrls: string;
}

const CATEGORIES = ["REWARDS", "CASHBACK", "TRAVEL", "FUEL", "LIFESTYLE", "PREMIUM", "BUSINESS", "CO_BRAND"];
const NETWORKS = ["Visa", "Mastercard", "RuPay", "American Express", "Diners Club"];

export const emptyCardForm: CardFormData = {
  bankId: "",
  name: "",
  network: "Visa",
  category: "REWARDS",
  isCashbackCard: false,
  joiningFeeInr: 0,
  annualFeeInr: 0,
  feeWaiverCondition: "",
  rewardSpendPerPoint: "",
  rewardPointValueEstInr: "",
  welcomeBenefits: "",
  milestoneBenefits: "",
  loungeAccess: "",
  fuelSurchargeWaiver: "",
  merchantBonusCategories: "",
  eligibilityNotes: "",
  applyUrl: "",
  sourceUrls: "",
};

function field(label: string, children: React.ReactNode, span2 = false) {
  return (
    <label className={`text-sm ${span2 ? "col-span-2" : ""}`}>
      <span className="block text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

export function CardForm({
  initial,
  banks,
  onSubmit,
  submitLabel,
  submitting,
}: {
  initial: CardFormData;
  banks: Bank[];
  onSubmit: (data: CardFormData) => void;
  submitLabel: string;
  submitting?: boolean;
}) {
  const [form, setForm] = useState(initial);

  function set<K extends keyof CardFormData>(key: K, value: CardFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
      {field(
        "Bank",
        <select className={inputClass} value={form.bankId} onChange={(e) => set("bankId", e.target.value)} required>
          <option value="">Select bank...</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>,
      )}
      {field(
        "Card name",
        <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} required />,
      )}
      {field(
        "Network",
        <input className={inputClass} list="networks" value={form.network} onChange={(e) => set("network", e.target.value)} />,
      )}
      {field(
        "Category",
        <select className={inputClass} value={form.category} onChange={(e) => set("category", e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>,
      )}
      <datalist id="networks">
        {NETWORKS.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <label className="text-sm flex items-center gap-2 col-span-2">
        <input type="checkbox" checked={form.isCashbackCard} onChange={(e) => set("isCashbackCard", e.target.checked)} />
        Pure cashback card (not points-based)
      </label>

      {field(
        "Joining fee (₹)",
        <input
          type="number"
          className={inputClass}
          value={form.joiningFeeInr}
          onChange={(e) => set("joiningFeeInr", Number(e.target.value))}
        />,
      )}
      {field(
        "Annual fee (₹)",
        <input
          type="number"
          className={inputClass}
          value={form.annualFeeInr}
          onChange={(e) => set("annualFeeInr", Number(e.target.value))}
        />,
      )}
      {field(
        "Fee waiver condition",
        <input className={inputClass} value={form.feeWaiverCondition} onChange={(e) => set("feeWaiverCondition", e.target.value)} />,
        true,
      )}
      {field(
        "Reward rate (₹ spend per point)",
        <input className={inputClass} value={form.rewardSpendPerPoint} onChange={(e) => set("rewardSpendPerPoint", e.target.value)} />,
      )}
      {field(
        "Est. point value (₹)",
        <input
          type="number"
          step="0.01"
          className={inputClass}
          value={form.rewardPointValueEstInr}
          onChange={(e) => set("rewardPointValueEstInr", e.target.value)}
        />,
      )}
      {field(
        "Lounge access",
        <input className={inputClass} value={form.loungeAccess} onChange={(e) => set("loungeAccess", e.target.value)} />,
      )}
      {field(
        "Fuel surcharge waiver",
        <input className={inputClass} value={form.fuelSurchargeWaiver} onChange={(e) => set("fuelSurchargeWaiver", e.target.value)} />,
      )}
      {field(
        "Welcome benefits (one per line)",
        <textarea
          className={inputClass}
          rows={3}
          value={form.welcomeBenefits}
          onChange={(e) => set("welcomeBenefits", e.target.value)}
        />,
        true,
      )}
      {field(
        "Milestone benefits (one per line)",
        <textarea
          className={inputClass}
          rows={3}
          value={form.milestoneBenefits}
          onChange={(e) => set("milestoneBenefits", e.target.value)}
        />,
        true,
      )}
      {field(
        "Merchant bonus categories (one per line, e.g. electronics, dining)",
        <textarea
          className={inputClass}
          rows={2}
          value={form.merchantBonusCategories}
          onChange={(e) => set("merchantBonusCategories", e.target.value)}
        />,
        true,
      )}
      {field(
        "Eligibility notes",
        <textarea className={inputClass} rows={2} value={form.eligibilityNotes} onChange={(e) => set("eligibilityNotes", e.target.value)} />,
        true,
      )}
      {field(
        "Apply URL",
        <input className={inputClass} value={form.applyUrl} onChange={(e) => set("applyUrl", e.target.value)} />,
        true,
      )}
      {field(
        "Source URLs (one per line — bank page, T&C PDF, etc.)",
        <textarea className={inputClass} rows={2} value={form.sourceUrls} onChange={(e) => set("sourceUrls", e.target.value)} />,
        true,
      )}

      <button
        type="submit"
        disabled={submitting}
        className="col-span-2 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50"
      >
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}

export function cardToFormData(card: any): CardFormData {
  const linesToText = (arr: string[] | null | undefined) => (arr ?? []).join("\n");
  return {
    bankId: card.bank?.id ?? card.bankId ?? "",
    name: card.name ?? "",
    network: card.network ?? "Visa",
    category: card.category ?? "REWARDS",
    isCashbackCard: !!card.isCashbackCard,
    joiningFeeInr: card.joiningFeeInr ?? 0,
    annualFeeInr: card.annualFeeInr ?? 0,
    feeWaiverCondition: card.feeWaiverCondition ?? "",
    rewardSpendPerPoint: card.rewardSpendPerPoint ?? "",
    rewardPointValueEstInr: card.rewardPointValueEstInr?.toString() ?? "",
    welcomeBenefits: linesToText(card.welcomeBenefits),
    milestoneBenefits: linesToText(card.milestoneBenefits),
    loungeAccess: card.loungeAccess ?? "",
    fuelSurchargeWaiver: card.fuelSurchargeWaiver ?? "",
    merchantBonusCategories: linesToText(card.merchantBonusCategories),
    eligibilityNotes: card.eligibilityNotes ?? "",
    applyUrl: card.applyUrl ?? "",
    sourceUrls: linesToText(card.sourceUrls),
  };
}

const linesToArray = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);

export function formDataToPayload(form: CardFormData) {
  return {
    bankId: form.bankId,
    name: form.name,
    network: form.network,
    category: form.category,
    isCashbackCard: form.isCashbackCard,
    joiningFeeInr: form.joiningFeeInr,
    annualFeeInr: form.annualFeeInr,
    feeWaiverCondition: form.feeWaiverCondition || null,
    rewardSpendPerPoint: form.rewardSpendPerPoint || null,
    rewardPointValueEstInr: form.rewardPointValueEstInr ? Number(form.rewardPointValueEstInr) : null,
    welcomeBenefits: linesToArray(form.welcomeBenefits),
    milestoneBenefits: linesToArray(form.milestoneBenefits),
    loungeAccess: form.loungeAccess || null,
    fuelSurchargeWaiver: form.fuelSurchargeWaiver || null,
    merchantBonusCategories: linesToArray(form.merchantBonusCategories),
    eligibilityNotes: form.eligibilityNotes || null,
    applyUrl: form.applyUrl || null,
    sourceUrls: linesToArray(form.sourceUrls),
  };
}
