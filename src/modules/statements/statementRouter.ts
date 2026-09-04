import * as Sentry from "@sentry/node";
import { Router } from "express";
import multer from "multer";
import { extractTransactionsFromCsv, extractTransactionsFromText, detectIssuer, detectHiddenFees, StatementTransaction } from "./statementParser.js";
import { categorizeMerchant } from "../categorization/merchantCategorizer.js";
import { requireUser } from "../auth/authMiddleware.js";

export const statementRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// POST /statements/analyze — multipart form: file (PDF or CSV), optional password (for locked
// PDFs). Stateless: nothing is written to disk or the database — the file is parsed in memory and
// discarded once the response is sent, since statements are sensitive documents.
//
// `requireUser` gates it: this buffers up to 15 MB in memory and hands it to a native PDF parser on
// a host CLAUDE.md documents as memory-fragile (known-fragile item #2 — the reason pdf-parse is
// lazily imported at all). Unauthenticated, that is a trivial restart-cycling DoS. The route has no
// live caller today — both the app and website surfaces are "Coming Soon" pending the standalone
// statement-analyzer app — so requiring auth costs nothing now and the standalone app can
// authenticate like any other client.
statementRouter.post("/analyze", requireUser, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "file is required (field name 'file')" });

  const password = typeof req.body?.password === "string" ? req.body.password : undefined;
  const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
  const isCsv = file.mimetype === "text/csv" || file.originalname.toLowerCase().endsWith(".csv");

  if (!isPdf && !isCsv) {
    return res.status(400).json({ error: "Only PDF or CSV statements are supported right now" });
  }

  let rawText: string;
  try {
    if (isPdf) {
      // Loaded lazily, not at module import time — pdf-parse pulls in @napi-rs/canvas (a native
      // binary), which was loading into every single process on startup regardless of whether
      // anyone ever uploaded a PDF, on a memory-constrained shared host. Only pay that cost when a
      // PDF is actually being analyzed.
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: file.buffer, password });
      const result = await parser.getText();
      rawText = result.text;
      await parser.destroy();
    } else {
      rawText = file.buffer.toString("utf-8");
    }
  } catch (err: any) {
    if (err?.name === "PasswordException" || /password/i.test(err?.message ?? "")) {
      return res.status(422).json({ error: "This PDF is password-protected — provide the password and try again" });
    }
    // Not a password issue — a genuine parser bug looks identical to "bad file" to the user. Report
    // it so a regression in pdf-parse / the extractor is visible.
    Sentry.captureException(err, { tags: { route: "POST /statements/analyze" } });
    return res.status(422).json({ error: "Could not read this file — is it a valid PDF/CSV statement?" });
  }

  const transactions: StatementTransaction[] = isPdf
    ? extractTransactionsFromText(rawText)
    : extractTransactionsFromCsv(rawText);

  if (transactions.length === 0) {
    return res.status(422).json({
      error: "No transactions could be extracted from this file. Statement parsing is generic/heuristic right now — this layout may need tuning.",
      detectedIssuer: detectIssuer(rawText),
    });
  }

  const categorized = transactions.map((t) => ({ ...t, category: categorizeMerchant(t.description) ?? "other" }));
  const spends = categorized.filter((t) => t.type === "debit");

  const totalSpend = Math.round(spends.reduce((sum, t) => sum + t.amount, 0));
  const totalCredits = Math.round(categorized.filter((t) => t.type === "credit").reduce((sum, t) => sum + t.amount, 0));

  const byCategory = new Map<string, number>();
  for (const t of spends) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
  const categoryBreakdown = [...byCategory.entries()]
    .map(([category, total]) => ({ category, total: Math.round(total) }))
    .sort((a, b) => b.total - a.total);

  const byMerchant = new Map<string, number>();
  for (const t of spends) byMerchant.set(t.description, (byMerchant.get(t.description) ?? 0) + t.amount);
  const topMerchants = [...byMerchant.entries()]
    .map(([merchant, total]) => ({ merchant, total: Math.round(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const byMonth = new Map<string, number>();
  for (const t of spends) {
    const monthKey = t.date.slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + t.amount);
  }
  const monthlyBreakdown = [...byMonth.entries()]
    .map(([month, total]) => ({ month, total: Math.round(total) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const largestTransactions = [...spends]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((t) => ({ date: t.date, description: t.description, amount: t.amount, category: t.category }));

  // Hidden Fee & Penalty Radar — scans the raw text, not just the parsed transaction lines, since
  // finance charges/APR/forex-markup callouts are often in a fine-print summary block rather than
  // the line-item transaction table extractTransactionsFromText targets.
  const hiddenFees = isPdf ? detectHiddenFees(rawText) : [];

  res.json({
    detectedIssuer: detectIssuer(rawText),
    transactionCount: transactions.length,
    totalSpend,
    totalCredits,
    categoryBreakdown,
    topMerchants,
    monthlyBreakdown,
    largestTransactions,
    hiddenFees,
  });
});
