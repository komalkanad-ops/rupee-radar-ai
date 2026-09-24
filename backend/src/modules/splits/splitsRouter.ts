import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";

// Splits: a bill shared between the user and people who are NOT app users. Participants are plain
// names, never linked accounts — no contacts permission and no cross-user data. Unlike most routers
// here this one does NOT spread req.body into prisma: shares, total and payer must stay mutually
// consistent, so every field is picked and validated explicitly.
export const splitsRouter = Router();

const MAX_TITLE = 100;
const MAX_NOTE = 500;
const MAX_NAME = 40;
const MIN_PARTICIPANTS = 2;
const MAX_PARTICIPANTS = 20;
const MAX_AMOUNT = 1e9;
// Shares are entered/rounded per person, so they rarely add up to the paise; a rupee of slack.
const SHARE_SUM_TOLERANCE = 1.0;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

interface Participant {
  name: string;
  share: number;
  settled: boolean;
}

interface SplitFields {
  title: string;
  totalAmount: number;
  paidBy: string;
  expenseDate: Date;
  note: string | null;
  participants: Participant[];
}

type Validated = { ok: true; value: SplitFields } | { ok: false; error: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseStoredParticipants(json: string): Participant[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseDate(v: unknown): Date | null {
  // A Date is legitimate here: PUT merges the stored row (whose expenseDate is a Date) under the
  // request before validating the whole thing.
  if (!(v instanceof Date) && typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Validates a COMPLETE set of fields — for PUT the caller merges the stored row under the request
// first, so a partial update (e.g. just toggling one participant's `settled`) is still checked
// against the whole.
function validate(input: Record<string, unknown>): Validated {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > MAX_TITLE) return { ok: false, error: `title is required (max ${MAX_TITLE} characters)` };

  const totalAmount = input.totalAmount;
  if (!isFiniteNumber(totalAmount) || totalAmount <= 0 || totalAmount > MAX_AMOUNT) {
    return { ok: false, error: `totalAmount must be a number greater than 0 and at most ${MAX_AMOUNT}` };
  }

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== "string" || input.note.length > MAX_NOTE) {
      return { ok: false, error: `note must be text of at most ${MAX_NOTE} characters` };
    }
    note = input.note.trim() || null;
  }

  const expenseDate = parseDate(input.expenseDate);
  if (!expenseDate) return { ok: false, error: "expenseDate must be a valid date" };

  const rawParticipants = input.participants;
  if (!Array.isArray(rawParticipants) || rawParticipants.length < MIN_PARTICIPANTS || rawParticipants.length > MAX_PARTICIPANTS) {
    return { ok: false, error: `participants must be a list of ${MIN_PARTICIPANTS} to ${MAX_PARTICIPANTS} people` };
  }

  const participants: Participant[] = [];
  const seen = new Set<string>();
  let shareSum = 0;
  for (const p of rawParticipants) {
    if (typeof p !== "object" || p === null) return { ok: false, error: "each participant must be an object" };
    const { name: rawName, share, settled } = p as Record<string, unknown>;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name || name.length > MAX_NAME) return { ok: false, error: `each participant needs a name (max ${MAX_NAME} characters)` };
    if (!isFiniteNumber(share) || share < 0 || share > MAX_AMOUNT) {
      return { ok: false, error: `each participant's share must be a number between 0 and ${MAX_AMOUNT}` };
    }
    if (typeof settled !== "boolean") return { ok: false, error: "each participant's settled must be true or false" };
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `participant names must be unique ("${name}" appears twice)` };
    seen.add(key);
    shareSum += share;
    participants.push({ name, share, settled });
  }

  if (Math.abs(shareSum - totalAmount) > SHARE_SUM_TOLERANCE) {
    return { ok: false, error: "participant shares must add up to the total amount" };
  }

  const paidByInput = typeof input.paidBy === "string" ? input.paidBy.trim().toLowerCase() : "";
  const payer = participants.find((p) => p.name.toLowerCase() === paidByInput);
  if (!payer) return { ok: false, error: "paidBy must be one of the participants" };

  return { ok: true, value: { title, totalAmount, paidBy: payer.name, expenseDate, note, participants } };
}

function serialize(row: {
  id: string;
  userId: string;
  title: string;
  totalAmount: number;
  paidBy: string;
  expenseDate: Date;
  note: string | null;
  participantsJson: string;
  active: boolean;
  createdAt: Date;
}) {
  return { ...row, participants: parseStoredParticipants(row.participantsJson) };
}

async function loadOwned(id: string, userId: string) {
  const existing = await prisma.splitExpense.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  return existing;
}

splitsRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const rows = await prisma.splitExpense.findMany({
    where: { userId: req.userId, active: true },
    orderBy: { expenseDate: "desc" },
  });
  res.json(rows.map(serialize));
});

splitsRouter.post("/", requireUser, async (req: UserRequest, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  let id: string | undefined;
  if (body.id !== undefined) {
    if (typeof body.id !== "string" || !ID_PATTERN.test(body.id)) {
      return res.status(400).json({ error: "id must be up to 40 letters, numbers, dashes or underscores" });
    }
    id = body.id;
  }

  const result = validate(body);
  if (!result.ok) return res.status(400).json({ error: result.error });
  const v = result.value;

  if (id && (await prisma.splitExpense.findUnique({ where: { id }, select: { id: true } }))) {
    return res.status(409).json({ error: "That id is already in use" });
  }

  const row = await prisma.splitExpense.create({
    data: {
      ...(id ? { id } : {}),
      // userId always comes from the verified token, never the request body.
      userId: req.userId!,
      title: v.title,
      totalAmount: v.totalAmount,
      paidBy: v.paidBy,
      expenseDate: v.expenseDate,
      note: v.note,
      participantsJson: JSON.stringify(v.participants),
    },
  });
  res.status(201).json(serialize(row));
});

splitsRouter.put("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwned(req.params.id, req.userId!);
  if (!owned || !owned.active) return res.status(404).json({ error: "Not found" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  // Stored values fill in whatever the request omits, then the WHOLE thing is re-validated.
  const merged: Record<string, unknown> = {
    title: owned.title,
    totalAmount: owned.totalAmount,
    paidBy: owned.paidBy,
    expenseDate: owned.expenseDate,
    note: owned.note,
    participants: parseStoredParticipants(owned.participantsJson),
  };
  for (const key of ["title", "totalAmount", "paidBy", "expenseDate", "note", "participants"] as const) {
    if (body[key] !== undefined) merged[key] = body[key];
  }

  const result = validate(merged);
  if (!result.ok) return res.status(400).json({ error: result.error });
  const v = result.value;

  const row = await prisma.splitExpense.update({
    where: { id: owned.id },
    data: {
      title: v.title,
      totalAmount: v.totalAmount,
      paidBy: v.paidBy,
      expenseDate: v.expenseDate,
      note: v.note,
      participantsJson: JSON.stringify(v.participants),
    },
  });
  res.json(serialize(row));
});

splitsRouter.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const owned = await loadOwned(req.params.id, req.userId!);
  if (!owned) return res.status(404).json({ error: "Not found" });
  // Soft delete — the row stays so a re-sync from another device doesn't resurrect it.
  await prisma.splitExpense.update({ where: { id: owned.id }, data: { active: false } });
  res.status(204).send();
});
