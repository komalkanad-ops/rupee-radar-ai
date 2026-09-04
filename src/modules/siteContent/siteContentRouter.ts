import { Router } from "express";
import multer from "multer";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../auth/authMiddleware.js";

// Marketing-site content the operator manages from the admin console. Right now that's just the
// "See it in action" screenshot carousel on rupeeradarai.com. Image bytes are stored in the DB
// (see the SiteScreenshot model comment) — served one row at a time from GET /:id/image.
export const siteContentRouter = Router();

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB — the admin downsizes before upload, this is a backstop
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only PNG, JPEG or WebP images are allowed"));
  },
});

// GET /site-content/screenshots — public. Metadata only, never the bytes.
siteContentRouter.get("/screenshots", async (_req, res) => {
  const shots = await prisma.siteScreenshot.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, caption: true, category: true, sortOrder: true },
  });
  res.json(shots);
});

// GET /site-content/screenshots/:id/image — public. Streams the raw image.
siteContentRouter.get("/screenshots/:id/image", async (req, res) => {
  const shot = await prisma.siteScreenshot.findUnique({ where: { id: req.params.id } });
  if (!shot || !shot.active) return res.status(404).send("Not found");
  // The upload path only ever stores png/jpeg/webp; re-assert it on the way out with string
  // literals only (defence in depth — a tampered row must never serve text/html) + no sniffing.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=300");
  if (shot.mimeType === "image/png") res.type("png");
  else if (shot.mimeType === "image/jpeg") res.type("jpeg");
  else if (shot.mimeType === "image/webp") res.type("webp");
  else return res.status(415).send("Unsupported image type");
  res.send(Buffer.from(shot.data));
});

// GET /site-content/screenshots/admin — admin list, includes inactive rows + timestamps.
siteContentRouter.get("/screenshots/admin", requireAdmin, async (_req, res) => {
  const shots = await prisma.siteScreenshot.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, caption: true, category: true, sortOrder: true, active: true, mimeType: true, createdAt: true },
  });
  res.json(shots);
});

siteContentRouter.post("/screenshots", requireAdmin, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "An image file is required" });
  const count = await prisma.siteScreenshot.count();
  const shot = await prisma.siteScreenshot.create({
    data: {
      caption: String(req.body?.caption ?? "").slice(0, 160),
      category: String(req.body?.category ?? "").slice(0, 60),
      sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : count,
      mimeType: file.mimetype,
      data: file.buffer,
    },
    select: { id: true, caption: true, category: true, sortOrder: true, active: true, mimeType: true, createdAt: true },
  });
  res.status(201).json(shot);
});

// PUT /screenshots/reorder — takes the full ordered id list and rewrites sortOrder = index for
// each in one transaction. Replaces the old client-side "swap two sortOrder values" approach,
// which silently no-op'd whenever two rows already shared a sortOrder (e.g. after a delete left a
// gap that a later upload's `count`-based default re-collided with) — swapping two equal numbers
// changes nothing. Always assigning fresh sequential values is immune to that.
siteContentRouter.put("/screenshots/reorder", requireAdmin, async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
    return res.status(400).json({ error: "ids must be a non-empty array of screenshot ids" });
  }
  await prisma.$transaction(
    ids.map((id: string, index: number) => prisma.siteScreenshot.update({ where: { id }, data: { sortOrder: index } })),
  );
  res.status(204).send();
});

siteContentRouter.patch("/screenshots/:id", requireAdmin, async (req, res) => {
  const { caption, category, sortOrder, active } = req.body ?? {};
  const shot = await prisma.siteScreenshot.update({
    where: { id: req.params.id },
    data: {
      caption: caption !== undefined ? String(caption).slice(0, 160) : undefined,
      category: category !== undefined ? String(category).slice(0, 60) : undefined,
      sortOrder: sortOrder !== undefined && Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : undefined,
      active: typeof active === "boolean" ? active : undefined,
    },
    select: { id: true, caption: true, category: true, sortOrder: true, active: true, mimeType: true, createdAt: true },
  });
  res.json(shot);
});

siteContentRouter.delete("/screenshots/:id", requireAdmin, async (req, res) => {
  await prisma.siteScreenshot.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// multer rejects (bad mime / too large) surface as errors — turn them into a clean 400.
siteContentRouter.use((err: any, _req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError || err?.message?.includes("images are allowed")) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});
