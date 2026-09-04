import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface AppUser {
  id: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  deviceCount: number;
  smsTransactionCount: number;
  recurringPaymentCount: number;
  isPro: boolean;
  proExpiryAt: string | null;
}

export default function Users() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    setLoading(true);
    api<AppUser[]>(`/users?${params}`).then(setUsers).finally(() => setLoading(false));
  }

  useEffect(reload, [search]);

  async function grantPro(user: AppUser) {
    const ok = await confirm({ title: "Grant PRO?", message: `Grants ${user.email ?? user.phone ?? user.id} 1 month of PRO access.`, confirmLabel: "Grant" });
    if (!ok) return;
    await api("/billing/admin/grant", { method: "POST", body: JSON.stringify({ userId: user.id, months: 1 }) });
    toast.show("PRO granted");
    reload();
  }

  async function revokePro(user: AppUser) {
    const ok = await confirm({ title: "Revoke PRO?", message: `Removes PRO access for ${user.email ?? user.phone ?? user.id}.`, confirmLabel: "Revoke", danger: true });
    if (!ok) return;
    await api("/billing/admin/revoke", { method: "POST", body: JSON.stringify({ userId: user.id }) });
    toast.show("PRO revoked");
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-6">Users</h1>

      <input
        placeholder="Search by email or phone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm mb-4 w-full max-w-sm"
      />

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Devices</th>
              <th className="px-4 py-3">SMS parsed</th>
              <th className="px-4 py-3">Recurring</th>
              <th className="px-4 py-3">PRO</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={7}>
                  <SkeletonRows rows={6} cols={7} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    No users found.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{u.email ?? u.phone ?? u.id}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{u.deviceCount}</td>
                  <td className="px-4 py-3">{u.smsTransactionCount.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3">{u.recurringPaymentCount}</td>
                  <td className="px-4 py-3">
                    {u.isPro ? (
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                        PRO {u.proExpiryAt ? `until ${new Date(u.proExpiryAt).toLocaleDateString()}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Free</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.isPro ? (
                      <button onClick={() => revokePro(u)} className="text-xs text-red-600 hover:underline">
                        Revoke PRO
                      </button>
                    ) : (
                      <button onClick={() => grantPro(u)} className="text-xs text-brand hover:underline">
                        Grant PRO
                      </button>
                    )}
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
