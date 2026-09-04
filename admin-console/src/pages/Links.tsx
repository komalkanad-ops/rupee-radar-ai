import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

interface AppLink {
  id: string;
  key: string;
  label: string;
  url: string;
  category: string;
  updatedAt: string;
}

export default function Links() {
  const [links, setLinks] = useState<AppLink[]>([]);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("general");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api<AppLink[]>("/config/links").then(setLinks);
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/config/links", {
        method: "POST",
        body: JSON.stringify({ key, label, url, category }),
      });
      setKey("");
      setLabel("");
      setUrl("");
      setCategory("general");
      reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function remove(id: string) {
    await api(`/config/links/${id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-dark mb-2">App Links</h1>
      <p className="text-sm text-slate-500 mb-6">
        URLs the Android app fetches at runtime — Play Store listing, support, legal, social, and
        any other link you want to change without shipping an app update. Card-specific "Apply now"
        links are edited on each card's detail page instead.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-6 grid grid-cols-2 gap-3">
        <input
          placeholder="key (e.g. play_store)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm col-span-2"
        />
        <input
          placeholder="category (app / support / legal / social)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-md bg-brand text-white text-sm font-medium py-2 hover:bg-brand-dark">
          Save link
        </button>
        {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">URL</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-xs">{l.key}</td>
                <td className="px-4 py-3">{l.label}</td>
                <td className="px-4 py-3 text-brand truncate max-w-xs">{l.url}</td>
                <td className="px-4 py-3">{l.category}</td>
                <td className="px-4 py-3">
                  <button onClick={() => remove(l.id)} className="text-xs text-red-600 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
