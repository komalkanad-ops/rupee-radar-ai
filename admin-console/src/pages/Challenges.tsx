import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface Challenge {
  id: string;
  key: string;
  title: string;
  description: string;
  type: "NO_SPEND_WEEKEND" | "SAVE_AMOUNT" | "CUSTOM";
  targetAmount: number | null;
  durationDays: number;
  active: boolean;
}

interface Badge {
  id: string;
  key: string;
  title: string;
  iconKey: string;
}

export default function Challenges() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const confirm = useConfirm();

  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<Challenge["type"]>("NO_SPEND_WEEKEND");
  const [targetAmount, setTargetAmount] = useState("");
  const [durationDays, setDurationDays] = useState("2");
  const [savingChallenge, setSavingChallenge] = useState(false);

  const [badgeKey, setBadgeKey] = useState("");
  const [badgeTitle, setBadgeTitle] = useState("");
  const [badgeIcon, setBadgeIcon] = useState("");
  const [savingBadge, setSavingBadge] = useState(false);

  function reload() {
    setLoading(true);
    Promise.all([api<Challenge[]>("/challenges/catalog"), api<Badge[]>("/challenges/badges")])
      .then(([c, b]) => {
        setChallenges(c);
        setBadges(b);
      })
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleChallengeSubmit(e: FormEvent) {
    e.preventDefault();
    setSavingChallenge(true);
    try {
      await api("/challenges/catalog", {
        method: "POST",
        body: JSON.stringify({
          key,
          title,
          description,
          type,
          targetAmount: type === "SAVE_AMOUNT" && targetAmount ? Number(targetAmount) : null,
          durationDays: Number(durationDays),
        }),
      });
      toast.show("Challenge added");
      setKey("");
      setTitle("");
      setDescription("");
      setTargetAmount("");
      setDurationDays("2");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to add challenge", "error");
    } finally {
      setSavingChallenge(false);
    }
  }

  async function removeChallenge(c: Challenge) {
    const ok = await confirm({ title: "Retire this challenge?", message: `"${c.title}" will stop appearing in the catalog. Existing joins are unaffected.`, confirmLabel: "Retire", danger: true });
    if (!ok) return;
    await api(`/challenges/catalog/${c.id}`, { method: "DELETE" });
    toast.show("Challenge retired");
    reload();
  }

  async function handleBadgeSubmit(e: FormEvent) {
    e.preventDefault();
    setSavingBadge(true);
    try {
      await api("/challenges/badges", {
        method: "POST",
        body: JSON.stringify({ key: badgeKey, title: badgeTitle, iconKey: badgeIcon }),
      });
      toast.show("Badge added");
      setBadgeKey("");
      setBadgeTitle("");
      setBadgeIcon("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to add badge", "error");
    } finally {
      setSavingBadge(false);
    }
  }

  async function removeBadge(b: Badge) {
    const ok = await confirm({ title: "Delete this badge?", message: `"${b.title}" will be removed.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await api(`/challenges/badges/${b.id}`, { method: "DELETE" });
    toast.show("Badge deleted");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Challenges &amp; Badges</h1>
      <p className="text-sm text-slate-500 mb-6">
        The challenge catalog users can join in the app (e.g. "No-spend weekend"), and the badge
        catalog awarded on completion. A badge is auto-awarded when its <code>key</code> matches a
        completed challenge's <code>key</code>.
      </p>

      <h2 className="font-semibold text-brand-dark mb-3">Challenges</h2>
      <form onSubmit={handleChallengeSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-2 gap-3">
        <input placeholder="Key (e.g. no_spend_weekend)" value={key} onChange={(e) => setKey(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <select value={type} onChange={(e) => setType(e.target.value as Challenge["type"])} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="NO_SPEND_WEEKEND">No-spend weekend</option>
          <option value="SAVE_AMOUNT">Save an amount</option>
          <option value="CUSTOM">Custom</option>
        </select>
        <input type="number" placeholder="Duration (days)" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} required min={1} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        {type === "SAVE_AMOUNT" && (
          <input type="number" placeholder="Target amount (₹)" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm col-span-2" />
        )}
        <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm col-span-2" rows={2} />
        <button type="submit" disabled={savingChallenge} className="col-span-2 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50">
          <Plus size={15} /> {savingChallenge ? "Adding..." : "Add challenge"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto mb-10">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody><tr><td colSpan={5}><SkeletonRows rows={3} cols={5} /></td></tr></tbody>
          ) : (
            <tbody>
              {challenges.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs">{c.key}</td>
                  <td className="px-4 py-3 font-medium">{c.title}</td>
                  <td className="px-4 py-3 text-slate-500">{c.type}{c.targetAmount ? ` · ₹${c.targetAmount}` : ""}</td>
                  <td className="px-4 py-3 text-slate-500">{c.durationDays}d</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => removeChallenge(c)} className="text-xs text-red-600 hover:underline flex items-center gap-1 ml-auto">
                      <Trash2 size={12} /> Retire
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      <h2 className="font-semibold text-brand-dark mb-3">Badges</h2>
      <form onSubmit={handleBadgeSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-3 gap-3">
        <input placeholder="Key (matches challenge key)" value={badgeKey} onChange={(e) => setBadgeKey(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input placeholder="Title" value={badgeTitle} onChange={(e) => setBadgeTitle(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input placeholder="Icon (emoji, e.g. 🏆)" value={badgeIcon} onChange={(e) => setBadgeIcon(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button type="submit" disabled={savingBadge} className="col-span-3 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50">
          <Plus size={15} /> {savingBadge ? "Adding..." : "Add badge"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Icon</th>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody><tr><td colSpan={4}><SkeletonRows rows={3} cols={4} /></td></tr></tbody>
          ) : (
            <tbody>
              {badges.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-lg">{b.iconKey}</td>
                  <td className="px-4 py-3 font-mono text-xs">{b.key}</td>
                  <td className="px-4 py-3 font-medium">{b.title}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => removeBadge(b)} className="text-xs text-red-600 hover:underline flex items-center gap-1 ml-auto">
                      <Trash2 size={12} /> Delete
                    </button>
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
