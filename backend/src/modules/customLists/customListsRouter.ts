import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireUser, type UserRequest } from "../auth/authMiddleware.js";
import {
  CLIENT_ID_PATTERN,
  MAX_ITEMS_PER_USER,
  isListKind,
  normalizeName,
  reservedReason,
} from "./customListRules.js";

// The user's own categories, payees, payers and payment methods (see CustomListItem in
// schema.prisma). The app keeps them locally and syncs by its own `clientId`: PUT creates or
// updates, DELETE removes, GET returns the whole set. Every field is picked and validated — the
// body is never spread into Prisma, and userId always comes from the token.
export const customListsRouter = Router();

function serialize(row: { clientId: string; kind: string; name: string; defaultCategory: string | null; updatedAt: Date }) {
  return {
    id: row.clientId,
    kind: row.kind,
    name: row.name,
    defaultCategory: row.defaultCategory,
    updatedAt: row.updatedAt.toISOString(),
  };
}

customListsRouter.get("/", requireUser, async (req: UserRequest, res) => {
  const rows = await prisma.customListItem.findMany({
    where: { userId: req.userId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    take: MAX_ITEMS_PER_USER,
  });
  res.json(rows.map(serialize));
});

customListsRouter.put("/:clientId", requireUser, async (req: UserRequest, res) => {
  const clientId = req.params.clientId;
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    return res.status(400).json({ error: "id must be up to 40 letters, numbers, dashes or underscores" });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isListKind(body.kind)) return res.status(400).json({ error: "kind is not a known list" });
  const kind = body.kind;
  const name = normalizeName(body.name);
  if (!name) return res.status(400).json({ error: "name is required (max 40 characters, letters or numbers)" });
  const reserved = reservedReason(kind, name);
  if (reserved) return res.status(400).json({ error: reserved });

  let defaultCategory: string | null = null;
  if (body.defaultCategory !== undefined && body.defaultCategory !== null && body.defaultCategory !== "") {
    if (kind !== "PAYEE" && kind !== "PAYER") {
      return res.status(400).json({ error: "only payees and payers have a default category" });
    }
    const dc = normalizeName(body.defaultCategory);
    if (!dc) return res.status(400).json({ error: "defaultCategory must be a category name (max 40 characters)" });
    defaultCategory = dc.toLowerCase();
  }

  const userId = req.userId!;
  const existing = await prisma.customListItem.findUnique({ where: { userId_clientId: { userId, clientId } } });
  if (existing) {
    // The kind of an item never changes — a category can't become a payee under the same id.
    if (existing.kind !== kind) return res.status(409).json({ error: "kind can't be changed" });
    const row = await prisma.customListItem.update({
      where: { id: existing.id },
      data: { name, defaultCategory },
    });
    return res.json(serialize(row));
  }

  if ((await prisma.customListItem.count({ where: { userId } })) >= MAX_ITEMS_PER_USER) {
    return res.status(409).json({ error: `You've reached the limit of ${MAX_ITEMS_PER_USER} saved items` });
  }
  const row = await prisma.customListItem.create({
    data: { userId, clientId, kind, name, defaultCategory },
  });
  res.status(201).json(serialize(row));
});

customListsRouter.delete("/:clientId", requireUser, async (req: UserRequest, res) => {
  // deleteMany scoped to the caller: another user's item with the same clientId is never touched,
  // and deleting something already gone is a no-op (the state the client wanted).
  await prisma.customListItem.deleteMany({ where: { userId: req.userId, clientId: String(req.params.clientId) } });
  res.status(204).send();
});
