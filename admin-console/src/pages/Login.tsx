import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken, setRole } from "../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, role } = await api<{ token: string; role: string }>("/auth/admin/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(token);
      setRole(role);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-light">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-8 w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-brand-dark">Rupee Radar AI</h1>
          <p className="text-sm text-slate-500">Admin Console</p>
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-xs text-slate-400 text-center">
          First time? Call POST /auth/admin/bootstrap once on the API using the
          ADMIN_BOOTSTRAP_EMAIL/PASSWORD from backend/.env.
        </p>
      </form>
    </div>
  );
}
