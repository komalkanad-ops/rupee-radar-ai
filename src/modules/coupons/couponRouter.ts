import * as Sentry from "@sentry/node";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { requirePro } from "../auth/proMiddleware.js";
import { callMesh } from "../llm/meshClient.js";

// A user's own coupon/voucher vault — save a screenshot's fields (AI-parsed, human-confirmed) so a
// code/expiry/how-to-use doesn't get lost in a screenshots folder. See prisma/schema.prisma's
// SavedCoupon model doc for why this is a distinct model from the admin rewards-catalog Voucher.
//
// Every route is PRO-gated (not just /parse) — the whole feature sits behind ProLockedCard
// client-side, and gating only the AI call would let a free user use the vault via raw CRUD calls.
export const couponRouter = Router();

const ALLOWED_CATEGORIES = new Set([
  "groceries", "medical", "fitness", "dining", "transport", "travel", "tolls", "fuel",
  "shopping", "entertainment", "utilities", "rent", "insurance", "education", "emi", "other",
]);
const ALLOWED_STATUS = new Set(["ACTIVE", "USED", "EXPIRED", "DISMISSED"]);

const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB — a phone screenshot, not a full-res photo
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only PNG, JPEG or WebP images are allowed"));
  },
});

function sanitize(body: Record<string, unknown>) {
  const categoryRaw = String(body.category ?? "other").toLowerCase();
  const expiry = body.expiryDate ? new Date(String(body.expiryDate)) : null;
  const statusRaw = String(body.status ?? "ACTIVE").toUpperCase();
  return {
    merchantName: String(body.merchantName ?? "").trim().slice(0, 191),
    title: String(body.title ?? "").trim().slice(0, 191),
    code: body.code ? String(body.code).trim().slice(0, 191) : null,
    pin: body.pin ? String(body.pin).trim().slice(0, 191) : null,
    discountDescription: body.discountDescription ? String(body.discountDescription).trim().slice(0, 500) : null,
    category: ALLOWED_CATEGORIES.has(categoryRaw) ? categoryRaw : "other",
    expiryDate: expiry && !isNaN(expiry.getTime()) ? expiry : null,
    instructions: body.instructions ? String(body.instructions).trim().slice(0, 2000) : null,
    status: ALLOWED_STATUS.has(statusRaw) ? statusRaw : "ACTIVE",
  };
}

couponRouter.get("/", requireUser, requirePro, async (req: UserRequest, res) => {
  const coupons = await prisma.savedCoupon.findMany({
    where: { userId: req.userId, status: { not: "DISMISSED" } },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
  });
  res.json(coupons);
});

couponRouter.post("/", requireUser, requirePro, async (req: UserRequest, res) => {
  const id = typeof req.body?.id === "string" && req.body.id ? String(req.body.id) : undefined;
  const data = sanitize(req.body ?? {});
  if (!data.merchantName || !data.title) {
    return res.status(400).json({ error: "merchantName and title are required" });
  }
  const coupon = await prisma.savedCoupon.create({ data: { ...data, id, userId: req.userId! } });
  res.status(201).json(coupon);
});

async function loadOwned(id: string, userId: string) {
  const existing = await prisma.savedCoupon.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

couponRouter.put("/:id", requireUser, requirePro, async (req: UserRequest, res) => {
  const owned = await loadOwned(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const data = sanitize(req.body ?? {});
  if (!data.merchantName || !data.title) {
    return res.status(400).json({ error: "merchantName and title are required" });
  }
  const usedAt = data.status === "USED" && owned.status !== "USED" ? new Date() : owned.usedAt;
  const coupon = await prisma.savedCoupon.update({ where: { id: req.params.id }, data: { ...data, usedAt } });
  res.json(coupon);
});

couponRouter.delete("/:id", requireUser, requirePro, async (req: UserRequest, res) => {
  const owned = await loadOwned(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.savedCoupon.update({ where: { id: req.params.id }, data: { status: "DISMISSED" } });
  res.status(204).send();
});

// POST /coupons/parse — multipart image upload -> AI-extracted fields. Never writes to the
// database; the client shows every field in an editable confirm form and only a subsequent
// POST /coupons actually saves it (same "AI suggests, human confirms" convention as merchant
// auto-categorization). The uploaded image bytes are never persisted — extracted once, discarded.
couponRouter.post("/parse", requireUser, requirePro, upload.single("file"), async (req: UserRequest, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "An image file is required" });

  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  const systemPrompt =
    "You read screenshots of coupon/voucher/discount codes (from email, WhatsApp, shopping apps) " +
    "and extract structured data. Reply with ONLY a JSON object: " +
    '{"merchantName": string|null, "title": string|null, "code": string|null, "pin": string|null, ' +
    '"discountDescription": string|null, "category": string|null, "expiryDate": string|null (ISO ' +
    "8601 date, e.g. 2026-12-31, or null if no expiry is visible), " +
    '"instructions": string|null}. ' +
    "category must be one of: " + Array.from(ALLOWED_CATEGORIES).join(", ") + ". " +
    "instructions should be a short plain-language note on how/where to redeem it, if visible. " +
    "If a field isn't visible in the image, use null for it. No prose, no markdown fences.";

  let raw: string;
  try {
    raw = await callMesh(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the coupon details from this screenshot." },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
      undefined,
      500,
      "coupon_parse",
      req.userId,
    );
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/rpm limit|rate.?limit|429|too many requests/i.test(msg)) {
      return res.status(429).json({ error: "AI is busy — try again shortly", retryable: true });
    }
    Sentry.captureException(err, { tags: { route: "POST /coupons/parse" } });
    return res.status(502).json({ error: "AI parsing is unavailable right now", retryable: true });
  }

  try {
    const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonText);
    const categoryRaw = typeof parsed.category === "string" ? parsed.category.toLowerCase() : null;
    res.json({
      merchantName: typeof parsed.merchantName === "string" ? parsed.merchantName : null,
      title: typeof parsed.title === "string" ? parsed.title : null,
      code: typeof parsed.code === "string" ? parsed.code : null,
      pin: typeof parsed.pin === "string" ? parsed.pin : null,
      discountDescription: typeof parsed.discountDescription === "string" ? parsed.discountDescription : null,
      category: categoryRaw && ALLOWED_CATEGORIES.has(categoryRaw) ? categoryRaw : null,
      expiryDate: typeof parsed.expiryDate === "string" ? parsed.expiryDate : null,
      instructions: typeof parsed.instructions === "string" ? parsed.instructions : null,
    });
  } catch (err) {
    // A malformed model response just means an empty confirm form — the user can still fill it in
    // by hand. An exception here can also mean a mesh-API outage/auth failure worth reporting.
    Sentry.captureException(err, { tags: { route: "POST /coupons/parse" } });
    res.json({
      merchantName: null, title: null, code: null, pin: null,
      discountDescription: null, category: null, expiryDate: null, instructions: null,
    });
  }
});

// multer rejects (bad mime / too large) surface as errors — turn them into a clean 400 instead of
// falling through to the generic error handler (same pattern as siteContentRouter.ts).
couponRouter.use((err: any, _req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError || err?.message?.includes("images are allowed")) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});
