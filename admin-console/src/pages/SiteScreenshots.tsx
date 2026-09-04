import { FormEvent, useEffect, useRef, useState } from "react";
import { Trash2, Power, ArrowUp, ArrowDown, Upload } from "lucide-react";
import { api, apiUpload, API_BASE } from "../lib/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { SkeletonRows } from "../components/Skeleton";

interface Screenshot {
  id: string;
  caption: string;
  category: string;
  sortOrder: number;
  active: boolean;
  mimeType: string;
  createdAt: string;
}

const MAX_WIDTH = 1170; // ~a phone screenshot's long edge; keeps stored bytes small
const TARGET_ASPECT = 9 / 19.5; // width/height of a typical modern phone screen

/** Center-crop to a consistent phone aspect ratio, then downscale + re-encode in the browser — so
 * every carousel image comes out a uniform shape (the website renders them at a fixed width with
 * no fixed height, so a differently-shaped upload would otherwise show up a different height than
 * its neighbors) and we never upload a multi-MB raw PNG into a DB LONGBLOB. Whatever is uploaded —
 * a full screenshot, a wide desktop capture, anything — comes out the same shape without the admin
 * having to pre-crop it themselves. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const srcAspect = bitmap.width / bitmap.height;
  let cropW = bitmap.width;
  let cropH = bitmap.height;
  let sx = 0;
  let sy = 0;
  if (srcAspect > TARGET_ASPECT) {
    // Wider than the target shape — crop the left/right edges.
    cropW = Math.round(bitmap.height * TARGET_ASPECT);
    sx = Math.round((bitmap.width - cropW) / 2);
  } else if (srcAspect < TARGET_ASPECT) {
    // Taller than the target shape — crop the top/bottom edges.
    cropH = Math.round(bitmap.width / TARGET_ASPECT);
    sy = Math.round((bitmap.height - cropH) / 2);
  }
  const scale = Math.min(1, MAX_WIDTH / cropW);
  const w = Math.round(cropW * scale);
  const h = Math.round(cropH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, sx, sy, cropW, cropH, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image"))),
      "image/jpeg",
      0.85,
    );
  });
}

export default function SiteScreenshots() {
  const [items, setItems] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();

  function reload() {
    setLoading(true);
    api<Screenshot[]>("/site-content/screenshots/admin")
      .then(setItems)
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.show("Choose an image first", "error");
      return;
    }
    setSaving(true);
    try {
      const blob = await shrink(file);
      const form = new FormData();
      form.append("file", blob, "screenshot.jpg");
      form.append("caption", caption.trim());
      form.append("category", category.trim());
      await apiUpload("/site-content/screenshots", form);
      toast.show("Screenshot uploaded");
      setCaption("");
      setCategory("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      reload();
    } catch (err: any) {
      toast.show(err.message ?? "Upload failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, data: Partial<Screenshot>) {
    await api(`/site-content/screenshots/${id}`, { method: "PATCH", body: JSON.stringify(data) });
    reload();
  }

  async function move(item: Screenshot, dir: -1 | 1) {
    const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = ordered.findIndex((s) => s.id === item.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= ordered.length) return;
    [ordered[idx], ordered[swapIdx]] = [ordered[swapIdx], ordered[idx]];
    // Rewrites every row's sortOrder to its new index in one transaction, rather than swapping two
    // rows' existing sortOrder values — a swap was a silent no-op whenever those two values already
    // happened to be equal (see the backend route's comment for how that could happen).
    await api("/site-content/screenshots/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids: ordered.map((s) => s.id) }),
    });
    reload();
  }

  async function remove(item: Screenshot) {
    const ok = await confirm({
      title: "Delete this screenshot?",
      message: `"${item.caption || "Untitled"}" will be removed from the website carousel. This can't be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await api(`/site-content/screenshots/${item.id}`, { method: "DELETE" });
    toast.show("Deleted");
    reload();
  }

  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">Site Screenshots</h1>
      <p className="text-sm text-gray-500 mb-6">
        The "See it in action" carousel on rupeeradarai.com. Images are auto-cropped to a consistent
        phone shape and downscaled to {MAX_WIDTH}px wide in your browser before upload — any
        screenshot shape works, no need to pre-crop. When there are no active screenshots here, the
        website falls back to its built-in stylized mockups.
      </p>

      <form onSubmit={handleUpload} className="bg-white border border-gray-200 rounded-lg p-4 mb-8 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Caption</span>
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="e.g. Spending Overview — where your money went"
              className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Category (optional)</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. insights"
              className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block text-sm"
        />
        <button
          type="submit"
          disabled={saving || !file}
          className="inline-flex items-center gap-2 bg-black text-white text-sm px-4 py-2 rounded disabled:opacity-40"
        >
          <Upload size={15} />
          {saving ? "Uploading…" : "Upload screenshot"}
        </button>
      </form>

      {loading ? (
        <SkeletonRows rows={3} />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-gray-500">No screenshots yet — the website is showing its built-in mockups.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((item, i) => (
            <div
              key={item.id}
              className={`flex gap-4 items-center border rounded-lg p-3 ${item.active ? "bg-white border-gray-200" : "bg-gray-50 border-gray-200 opacity-60"}`}
            >
              <img
                src={`${API_BASE}/site-content/screenshots/${item.id}/image`}
                alt={item.caption}
                className="w-16 h-28 object-cover rounded border border-gray-200 bg-gray-100"
              />
              <div className="flex-1 min-w-0">
                <input
                  defaultValue={item.caption}
                  onBlur={(e) => e.target.value !== item.caption && patch(item.id, { caption: e.target.value })}
                  placeholder="Caption"
                  className="w-full border border-transparent hover:border-gray-300 focus:border-gray-300 rounded px-1 py-0.5 text-sm font-medium"
                />
                <input
                  defaultValue={item.category}
                  onBlur={(e) => e.target.value !== item.category && patch(item.id, { category: e.target.value })}
                  placeholder="Category"
                  className="w-full border border-transparent hover:border-gray-300 focus:border-gray-300 rounded px-1 py-0.5 text-xs text-gray-500"
                />
              </div>
              <div className="flex flex-col">
                <button onClick={() => move(item, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20">
                  <ArrowUp size={15} />
                </button>
                <button onClick={() => move(item, 1)} disabled={i === sorted.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20">
                  <ArrowDown size={15} />
                </button>
              </div>
              <button
                onClick={() => patch(item.id, { active: !item.active })}
                title={item.active ? "Hide from website" : "Show on website"}
                className={`p-2 rounded ${item.active ? "text-green-600 hover:bg-green-50" : "text-gray-400 hover:bg-gray-100"}`}
              >
                <Power size={16} />
              </button>
              <button onClick={() => remove(item)} className="p-2 rounded text-red-500 hover:bg-red-50">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
