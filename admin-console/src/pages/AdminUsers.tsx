import { FormEvent, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { SkeletonRows } from "../components/Skeleton";

interface AdminUserRow {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "EDITOR" | "VIEWER";
  createdAt: string;
}

const ROLES: AdminUserRow["role"][] = ["SUPER_ADMIN", "EDITOR", "VIEWER"];

export default function AdminUsers() {
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRoleField] = useState<AdminUserRow["role"]>("EDITOR");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function reload() {
    setLoading(true);
    api<AdminUserRow[]>("/auth/admin/admins")
      .then(setItems)
      .catch((err: any) => toast.show(err.message ?? "Failed to load admins — SUPER_ADMIN role required", "error"))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/auth/admin/admins", {
        method: "POST",
        body: JSON.stringify({ email, password, role }),
      });
      toast.show("Admin created");
      setEmail("");
      setPassword("");
      setRoleField("EDITOR");
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Failed to create admin", "error");
    } finally {
      setSaving(false);
    }
  }

  async function updateRole(item: AdminUserRow, newRole: AdminUserRow["role"]) {
    if (newRole === item.role) return;
    await api(`/auth/admin/admins/${item.id}/role`, { method: "PATCH", body: JSON.stringify({ role: newRole }) });
    toast.show(`${item.email} is now ${newRole}`);
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">Admin Users</h1>
      <p className="text-sm text-slate-500 mb-6">
        SUPER_ADMIN sees and controls everything, including this page. EDITOR covers day-to-day
        catalog/operations work. VIEWER is read-only everywhere, including here. Every boundary
        here is enforced server-side (`requireRole`) — this page can only ever hide a link a role
        genuinely can't use, never grant access the backend wouldn't already allow.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-3 gap-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={role}
          onChange={(e) => setRoleField(e.target.value as AdminUserRow["role"])}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={saving}
          className="col-span-3 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} /> {saving ? "Creating..." : "Create admin"}
        </button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={3}>
                  <SkeletonRows rows={3} cols={3} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium">{item.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={item.role}
                      onChange={(e) => updateRole(item, e.target.value as AdminUserRow["role"])}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(item.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                    No admins to show — this page requires SUPER_ADMIN.
                  </td>
                </tr>
              )}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
