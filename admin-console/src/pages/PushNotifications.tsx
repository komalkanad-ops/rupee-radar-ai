import { FormEvent, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonBlock } from "../components/Skeleton";

interface Stats {
  totalDevices: number;
  registeredTokens: number;
  optedIn: number;
}

export default function PushNotifications() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    api<Stats>("/push/stats").then(setStats).catch(() => setStats(null));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await confirm({
      title: "Send broadcast?",
      message: `This sends "${title}" to every opted-in device (${stats?.optedIn ?? 0} right now) immediately.`,
      confirmLabel: "Send",
    });
    if (!ok) return;

    setSending(true);
    try {
      const result = await api<{ targeted: number; sent: number; failedTokens?: string[] }>("/push/broadcast", {
        method: "POST",
        body: JSON.stringify({ title, body }),
      });
      const failed = result.failedTokens?.length ?? result.targeted - result.sent;
      toast.show(
        result.targeted === 0
          ? "No opted-in devices with a push token — nothing was sent"
          : `Delivered to ${result.sent}/${result.targeted}${failed ? ` (${failed} failed)` : ""}`,
        result.targeted === 0 ? "error" : "success",
      );
      setTitle("");
      setBody("");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Broadcast failed", "error");
    } finally {
      setSending(false);
    }
  }

  const noRegisteredDevices = stats !== null && stats.registeredTokens === 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Push Notifications</h1>
      <p className="text-sm text-slate-500 mb-6">
        Weekly/monthly spend digests and bill-due reminders send automatically. Use this to broadcast
        an announcement or incident notice right now. Requires Firebase configured on the backend
        (<code>FIREBASE_SERVICE_ACCOUNT_JSON_B64</code>) and devices that have registered a push token.
      </p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {!stats ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonBlock key={i} className="h-20 rounded-xl" />)
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-2xl font-semibold text-brand-dark">{stats.totalDevices}</div>
              <div className="text-xs text-slate-500 mt-1">Registered devices</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-2xl font-semibold text-brand-dark">{stats.registeredTokens}</div>
              <div className="text-xs text-slate-500 mt-1">With a push token</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-2xl font-semibold text-brand-dark">{stats.optedIn}</div>
              <div className="text-xs text-slate-500 mt-1">Opted into digests</div>
            </div>
          </>
        )}
      </div>

      {noRegisteredDevices && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>No devices have registered for push yet.</strong> A broadcast will reach 0 devices.
          Devices register their FCM token on app launch (Android app v0.30.0-beta+) — this count
          fills in as users open an updated build.
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-medium mb-3">Broadcast composer</h2>
        <div className="space-y-3">
          <input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <textarea
            placeholder="Body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={sending || noRegisteredDevices}
            className="flex items-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium px-4 py-2 hover:bg-brand-dark disabled:opacity-50"
          >
            <Send size={15} /> {sending ? "Sending..." : "Send broadcast"}
          </button>
        </div>
      </form>
    </div>
  );
}
