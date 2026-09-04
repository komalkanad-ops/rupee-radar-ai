import type { NextFunction, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import type { UserRequest } from "./authMiddleware.js";

/**
 * Gates any endpoint that spends mesh-api (LLM) calls on behalf of an end user — per product
 * policy, AI-backed capabilities (SMS parsing fallback, narrative insight summaries, etc.) are
 * PRO-only. Free users still get everything that doesn't touch the LLM (regex SMS parsing, the
 * full card catalog, recurring/net-worth tracking, budget-vs-baseline math).
 *
 * Must run after requireUser in the middleware chain (`requireUser, requirePro`) — reads the
 * verified userId off the request, never a client-supplied query/body value.
 */
export async function requirePro(req: UserRequest, res: Response, next: NextFunction) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "Missing Authorization header" });

  const entitlement = await prisma.proEntitlement.findUnique({ where: { userId } });
  const isActive = entitlement?.status === "active" && (entitlement.expiryAt?.getTime() ?? 0) > Date.now();

  if (!isActive) {
    return res.status(403).json({ error: "This feature requires Rupee Radar AI PRO", proRequired: true });
  }
  next();
}
