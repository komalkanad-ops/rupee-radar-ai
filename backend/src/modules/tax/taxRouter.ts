import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import { requirePro } from "../auth/proMiddleware.js";

export const taxRouter = Router();

const LIMIT_80C = 150000;
const LIMIT_80D = 25000;
// The sub-limit within 80D for preventive health checkups (hospital/diagnostic/pharmacy spends) —
// distinct from, and much smaller than, the main health-insurance-premium limit above. Kept
// separate so the app never overstates how much of a hospital bill is actually deductible.
const LIMIT_80D_PREVENTIVE = 5000;

// Kept independent of merchantCategorizer.ts's shared taxonomy rather than extending it — this is
// a narrow Section-80-specific concern, not worth touching a high-traffic shared classifier for.
const TAX_KEYWORDS: Record<"80C" | "80D" | "80D_MEDICAL", string[]> = {
  "80C": [
    "lic", "life insurance", "elss", "ppf", "provident fund", "epf", "tax saver",
    "hdfc life", "icici pru", "sbi life", "max life", "term insurance",
    "nsc", "sukanya samriddhi", "tax saving fd", "tax saver fd",
  ],
  "80D": [
    "health insurance", "mediclaim", "star health", "hdfc ergo", "icici lombard",
    "care health", "niva bupa", "bajaj allianz health",
  ],
  // Hospital/diagnostic/pharmacy spends are NOT automatically 80D-deductible the way an insurance
  // premium is — real eligibility is narrow (the ₹5,000 preventive-checkup sub-limit, or unreimbursed
  // medical expenses for a senior citizen without insurance). Tagged separately from "80D" so the
  // UI can show an eligibility caveat instead of implying the full spend qualifies.
  "80D_MEDICAL": [
    "hospital", "clinic", "diagnostic", "pathology", "pharmacy", "apollo", "fortis",
    "max healthcare", "manipal hospital", "medplus", "netmeds", "1mg", "practo",
  ],
};

function guessTaxSection(merchant: string | null): "80C" | "80D" | "80D_MEDICAL" | null {
  if (!merchant) return null;
  const lower = merchant.toLowerCase();
  for (const section of Object.keys(TAX_KEYWORDS) as Array<"80C" | "80D" | "80D_MEDICAL">) {
    if (TAX_KEYWORDS[section].some((keyword) => lower.includes(keyword))) return section;
  }
  return null;
}

// Indian financial year: Apr 1 - Mar 31. Returns e.g. "2026-27" for any date in that window.
function currentFinancialYear(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function financialYearBounds(fy: string): { startYear: number; start: Date; end: Date } | null {
  const startYear = Number(fy.split("-")[0]);
  if (!startYear) return null;
  return {
    startYear,
    start: new Date(Date.UTC(startYear, 3, 1)),
    end: new Date(Date.UTC(startYear + 1, 3, 1)),
  };
}

async function loadMatchedTaxTransactions(userId: string, start: Date, end: Date) {
  const transactions = await prisma.smsTransaction.findMany({
    where: { userId, txnDate: { gte: start, lt: end }, category: { not: "income" } },
  });
  return transactions
    .map((t) => ({ ...t, section: t.taxSection ?? guessTaxSection(t.merchant) }))
    .filter(
      (t): t is typeof t & { section: "80C" | "80D" | "80D_MEDICAL" } =>
        t.section === "80C" || t.section === "80D" || t.section === "80D_MEDICAL",
    );
}

// GET /tax/status?financialYear=2026-27
taxRouter.get("/status", requireUser, requirePro, async (req: UserRequest, res) => {
  const { financialYear } = req.query;
  const uid = req.userId!;

  const fy = String(financialYear || currentFinancialYear());
  const bounds = financialYearBounds(fy);
  if (!bounds) return res.status(400).json({ error: "financialYear must look like '2026-27'" });
  const { startYear, start, end } = bounds;

  const matched = await loadMatchedTaxTransactions(uid, start, end);

  const spent80C = matched.filter((t) => t.section === "80C").reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const spent80D = matched.filter((t) => t.section === "80D").reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const spent80DMedical = matched.filter((t) => t.section === "80D_MEDICAL").reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const fyEnd = new Date(Date.UTC(startYear + 1, 2, 31));
  const daysLeftInFY = Math.max(0, Math.ceil((fyEnd.getTime() - Date.now()) / 86400000));

  res.json({
    financialYear: fy,
    section80C: { spent: Math.round(spent80C), limit: LIMIT_80C, headroom: Math.max(0, LIMIT_80C - spent80C) },
    section80D: { spent: Math.round(spent80D), limit: LIMIT_80D, headroom: Math.max(0, LIMIT_80D - spent80D) },
    // Medical spends aren't automatically deductible the way an insurance premium is — surfaced
    // against the much narrower preventive-checkup sub-limit, with a caveat, not the main 80D cap.
    section80DMedical: {
      spent: Math.round(spent80DMedical),
      limit: LIMIT_80D_PREVENTIVE,
      headroom: Math.max(0, LIMIT_80D_PREVENTIVE - spent80DMedical),
      caveat: "Hospital/pharmacy/diagnostic spends are only deductible under 80D in narrow cases (the ₹5,000 preventive-checkup sub-limit, or unreimbursed medical costs for a senior citizen without insurance) — verify eligibility before filing.",
    },
    daysLeftInFY,
    matchedTransactions: matched.map((t) => ({
      id: t.id,
      merchant: t.merchant,
      amount: t.amount,
      txnDate: t.txnDate,
      section: t.section,
      autoMatched: t.taxSection === null,
    })),
  });
});

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// GET /tax/export?financialYear=2026-27 — a downloadable annual tax-filing summary of every
// matched 80C/80D/80D_MEDICAL transaction for the year, so the user has something to hand to an
// accountant or attach to a filing without re-deriving it from the app screen by hand.
taxRouter.get("/export", requireUser, requirePro, async (req: UserRequest, res) => {
  const { financialYear } = req.query;
  const uid = req.userId!;

  const fy = String(financialYear || currentFinancialYear());
  const bounds = financialYearBounds(fy);
  if (!bounds) return res.status(400).json({ error: "financialYear must look like '2026-27'" });

  const matched = await loadMatchedTaxTransactions(uid, bounds.start, bounds.end);
  const rows = [
    ["Date", "Merchant", "Amount (INR)", "Section", "Auto-matched"],
    ...matched.map((t) => [
      t.txnDate.toISOString().slice(0, 10),
      csvEscape(t.merchant ?? "Unknown"),
      String(Math.abs(t.amount)),
      t.section,
      t.taxSection === null ? "Yes" : "No",
    ]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="tax-summary-${fy}.csv"`);
  res.send(csv);
});
