import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import * as Sentry from "@sentry/node";
import { requireJwtSecret } from "../../lib/jwtSecret.js";

const JWT_SECRET = requireJwtSecret();

export interface AdminRequest extends Request {
  adminId?: string;
  adminRole?: string;
}

// Admin session JWTs and user session JWTs are signed with the SAME `JWT_SECRET`, so signature
// validity alone proves nothing about which family a token belongs to. Rejecting `type === "user"`
// is what actually separates them: every user token carries `type: "user"` (see
// authRouter.issueUserToken), so this closes the escalation path completely while leaving admin
// tokens issued before `type: "admin"` existed (7d expiry) working through the rollover.
// Once those have expired this should tighten to a positive `payload.type !== "admin"` check.
function rejectNonAdminToken(payload: { type?: string }): boolean {
  return payload.type === "user";
}

export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string; role?: string; type?: string };
    if (rejectNonAdminToken(payload)) {
      return res.status(401).json({ error: "Invalid token type" });
    }
    req.adminId = payload.sub;
    req.adminRole = payload.role;
    Sentry.setUser({ id: `admin:${payload.sub}` });
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Stricter than requireAdmin — any valid admin JWT still passes requireAdmin (role granularity is
// opt-in per route, not retrofitted everywhere at once), but a route wrapped in requireRole also
// needs the token's role claim to be one of the allowed roles. Older tokens issued before the role
// claim existed have no `role` in their payload — treated as SUPER_ADMIN (matches AdminUser.role's
// own default), not as a role-less rejection, so no admin loses access from this change alone.
export function requireRole(...allowedRoles: string[]) {
  return (req: AdminRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string; role?: string; type?: string };
      // Same escalation as requireAdmin, and worse here: a user token has no `role` claim, so the
      // `?? "SUPER_ADMIN"` fallback below would promote it past every role gate.
      if (rejectNonAdminToken(payload)) {
        return res.status(401).json({ error: "Invalid token type" });
      }
      const role = payload.role ?? "SUPER_ADMIN";
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: "Your admin role does not have access to this action" });
      }
      req.adminId = payload.sub;
      req.adminRole = role;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

export interface UserRequest extends Request {
  userId?: string;
}

// Verifies this app's own session JWT (issued by POST /auth/session after a Firebase/custom-OTP
// login, or the anonymous device-id path) — distinct from requireAdmin's token via the `type`
// claim, so a user token can never be mistaken for an admin token or vice versa. Enforced on every
// user-scoped route since Phase 0 (see CLAUDE.md Session 4) — no route trusts a plain `userId`
// param anymore.
export function requireUser(req: UserRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string; type?: string };
    if (payload.type !== "user") return res.status(401).json({ error: "Invalid token type" });
    req.userId = payload.sub;
    Sentry.setUser({ id: payload.sub }); // id only — never email/phone (see instrument.ts scrubber)
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Same verification as requireUser, but never blocks the request — sets req.userId when a valid
// user token is present, otherwise just calls next() with req.userId left undefined. Used by routes
// that accept submissions from both the (always-authenticated, even anonymously) app and the public
// website (which has no login/session concept at all), where "was there a real user token" is
// itself the signal for request-specific behavior (e.g. feedbackRouter.ts awarding coins only when
// a real session exists) — never trust a client-supplied flag for that distinction instead.
export function optionalUser(req: UserRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string; type?: string };
      if (payload.type === "user") {
        req.userId = payload.sub;
        Sentry.setUser({ id: payload.sub });
      }
    } catch {
      // Invalid/expired token on an optional-auth route — treat as unauthenticated rather than
      // rejecting the request.
    }
  }
  next();
}
