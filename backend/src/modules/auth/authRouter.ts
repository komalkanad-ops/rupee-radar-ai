import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import { verifyFirebaseIdToken, getFirebaseDiagnostics } from "../push/firebaseAdmin.js";
import { requireUser, requireRole, requireAdmin, type UserRequest } from "./authMiddleware.js";
import { authLimiter } from "../../lib/rateLimiters.js";
import { requireJwtSecret } from "../../lib/jwtSecret.js";

const VALID_ADMIN_ROLES = ["SUPER_ADMIN", "EDITOR", "VIEWER"];

const JWT_SECRET = requireJwtSecret();

export const authRouter = Router();

function issueUserToken(userId: string): string {
  return jwt.sign({ sub: userId, type: "user" }, JWT_SECRET, { expiresIn: "30d" });
}

// One-time bootstrap: creates the first admin user from env vars if none exists yet.
// Safe to call repeatedly — no-ops once an admin exists.
authRouter.post("/admin/bootstrap", async (_req, res) => {
  const existing = await prisma.adminUser.count();
  if (existing > 0) {
    return res.status(409).json({ error: "Admin already bootstrapped" });
  }
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    return res.status(400).json({ error: "Set ADMIN_BOOTSTRAP_EMAIL/PASSWORD in .env first" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.adminUser.create({ data: { email, passwordHash } });
  res.json({ id: admin.id, email: admin.email });
});

// The strict 20/15min limiter now applies only here and on /phone/request-otp — the two routes
// actually worth protecting against brute-force/spam — not the whole /auth prefix. It used to
// blanket every route including /auth/session (called on every app launch to bootstrap an
// anonymous session, and again on every real login) and GET/PATCH /auth/me (called every time
// Profile or Settings loads) — legitimate routine traffic from a handful of users behind one
// shared IP (a home/office Wi-Fi NAT) could exhaust 20 requests in 15 minutes with zero abuse
// involved, which is exactly what happened during this project's own testing. Those routes still
// get the app-wide generalLimiter (300/15min, applied globally in app.ts) — plenty for real usage,
// still a real ceiling against scripted abuse. Phone OTP verification's own brute-force protection
// is handled at the data level regardless (PhoneOtp.attempts caps at 5 per code, independent of
// IP), so moving /auth/session off the IP-based limiter doesn't weaken that.
authRouter.post("/admin/login", authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  // `type: "admin"` is what requireAdmin/requireRole use to reject a user session token — see
  // authMiddleware.rejectNonAdminToken. Both token families share JWT_SECRET, so this claim is the
  // only thing separating them.
  const token = jwt.sign({ sub: admin.id, role: admin.role, type: "admin" }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, role: admin.role });
});

const requireSuperAdmin = requireRole("SUPER_ADMIN");

// GET /admin/firebase-diagnostics — admin-only, safe (never returns the raw secret): reports
// whether FIREBASE_SERVICE_ACCOUNT_JSON is set on this exact running process, its length (so a
// truncated hPanel paste is visible without exposing the value), whether it parsed as JSON, which
// project_id it resolved to, and whether Admin SDK init actually succeeded — the only way to tell
// "env var missing/malformed on the live server" apart from "client token genuinely invalid" from
// outside, since /auth/session returns the same 401 for both.
authRouter.get("/admin/firebase-diagnostics", requireAdmin, (_req, res) => {
  res.json(getFirebaseDiagnostics());
});

// GET /admin/env-check — admin-only. FIREBASE_SERVICE_ACCOUNT_JSON stays presence/length only
// (never the raw secret); the other keys are deliberately tiny throwaway test values with no
// sensitivity at all, so their raw value is safe to return directly — this is what lets us test
// which specific characters a stuck hPanel env var edit corrupts (quotes vs. braces vs. brackets)
// without ever risking exposing anything real.
const ENV_CHECK_SECRET_KEYS = new Set(["FIREBASE_SERVICE_ACCOUNT_JSON"]);
const ENV_CHECK_ALLOWLIST = [
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "DEBUG_ENV_TEST",
  "TEST_BRACE_VAR",
  "TEST_QUOTE_VAR",
  "TEST_BRACKET_VAR",
];
authRouter.get("/admin/env-check", requireAdmin, (_req, res) => {
  const result: Record<string, { present: boolean; length: number; value?: string }> = {};
  for (const key of ENV_CHECK_ALLOWLIST) {
    const raw = process.env[key];
    result[key] = { present: !!raw, length: raw?.length ?? 0 };
    if (raw && !ENV_CHECK_SECRET_KEYS.has(key)) result[key].value = raw;
  }
  res.json(result);
});

// GET /admin/admins — SUPER_ADMIN only; the admin console's admin-user-management page.
authRouter.get("/admin/admins", requireSuperAdmin, async (_req, res) => {
  const admins = await prisma.adminUser.findMany({
    select: { id: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(admins);
});

// POST /admin/admins — { email, password, role? } — SUPER_ADMIN only, creates a new admin user.
authRouter.post("/admin/admins", requireSuperAdmin, async (req, res) => {
  const { email, password, role } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  if (role !== undefined && !VALID_ADMIN_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ADMIN_ROLES.join(", ")}` });
  }
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "An admin with that email already exists" });

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.adminUser.create({
    data: { email, passwordHash, role: role || "EDITOR" },
  });
  res.status(201).json({ id: admin.id, email: admin.email, role: admin.role });
});

// PATCH /admin/admins/:id/role — { role } — SUPER_ADMIN only, the actual RBAC control surface.
authRouter.patch("/admin/admins/:id/role", requireSuperAdmin, async (req, res) => {
  const { role } = req.body ?? {};
  if (!VALID_ADMIN_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ADMIN_ROLES.join(", ")}` });
  }
  const admin = await prisma.adminUser.update({
    where: { id: req.params.id },
    data: { role },
    select: { id: true, email: true, role: true },
  });
  res.json(admin);
});

// --- End-user auth (phone / Google via Firebase, with a custom-OTP phone path kept ready to swap
// in later — see AuthConfig.kt on Android for the switch). Distinct from the /admin/* routes above:
// issues a "type": "user" JWT (requireUser), never an admin one. ---

// POST /auth/phone/request-otp — { phone } — only used by the custom-OTP path; Firebase's own phone
// flow is entirely client-side until the final /auth/session verify step and never calls this.
authRouter.post("/phone/request-otp", authLimiter, async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ error: "phone is required" });

  const code = crypto.randomInt(100000, 1000000).toString();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await prisma.phoneOtp.create({ data: { phone, codeHash, expiresAt } });

  // No SMS gateway is configured yet (needs an MSG91/Twilio-style API key) — log server-side, and
  // outside production echo the code back in the response so the flow is actually testable today
  // without tailing logs. Real SMS delivery is documented as a "blocked on the user" follow-up.
  console.log(`[OTP] ${phone} -> ${code}`);
  // Independent second way to earn a visible devCode in production: an admin-allowlisted phone
  // number (LoginBypassEntry, see its schema doc comment) — lets a specific named beta tester log
  // in with a real identity while there's still no SMS gateway, without weakening verification
  // itself (the code is still hashed and compared for real in POST /auth/session, this only
  // changes who gets shown it directly instead of it going nowhere).
  const bypassEntry = await prisma.loginBypassEntry.findFirst({ where: { phone, enabled: true } });
  const devCode = process.env.NODE_ENV !== "production" || bypassEntry ? code : undefined;
  res.json({ sent: true, devCode });
});

// POST /auth/session — { provider: "firebase", idToken } | { provider: "phone_custom", phone, otp }
//   | { provider: "anonymous", deviceId }
// All branches converge on the same upsert-User-then-issue-JWT shape. Handles Google *and*
// Firebase-phone login identically (both arrive as a Firebase ID token) — which provider was used
// is read off the decoded token's sign-in-provider claim, not passed by the client.
authRouter.post("/session", async (req, res) => {
  const { provider } = req.body ?? {};

  if (provider === "anonymous") {
    // Backs the "skip login" path — issues a real, verifiable token for the same anonymous UUID
    // UserSession.kt already generates client-side (no new ID scheme; deviceId becomes User.id
    // directly). This closes two problems at once: (1) without it, every user-scoped endpoint
    // trusted a client-supplied userId with zero verification, so anyone could read/write anyone
    // else's data by passing a different id; (2) no anonymous user previously had a backing User
    // row at all, so their very first write (a foreign-key-constrained insert) would 500 — this
    // upsert guarantees the row exists before that ever happens.
    const { deviceId } = req.body ?? {};
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    // The anonymous path proves nothing beyond "the caller knows this id string" — so it must
    // NEVER hand back a session for a row that belongs to a real, signed-in account. Otherwise
    // anyone who learns another user's User.id (e.g. a household member) could mint a 30-day token
    // for that account here. An anonymous row can only ever be (re)claimed anonymously.
    const existing = await prisma.user.findUnique({ where: { id: deviceId } });
    if (existing && existing.authProvider && existing.authProvider !== "anonymous") {
      return res.status(409).json({
        error: "This account is signed in with Google or a phone number — sign in with that instead.",
      });
    }

    const user = await prisma.user.upsert({
      where: { id: deviceId },
      create: { id: deviceId, authProvider: "anonymous", lastLoginAt: new Date() },
      update: { lastLoginAt: new Date() },
    });
    return res.json({ token: issueUserToken(user.id), userId: user.id });
  }

  if (provider === "firebase") {
    const { idToken } = req.body ?? {};
    if (!idToken) return res.status(400).json({ error: "idToken is required" });

    const decoded = await verifyFirebaseIdToken(idToken);
    if (!decoded) return res.status(401).json({ error: "Invalid or unverifiable Firebase token" });

    const signInProvider = (decoded.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
    const authProvider = signInProvider === "google.com" ? "google" : "phone_firebase";

    try {
      const user = await prisma.user.upsert({
        where: { firebaseUid: decoded.uid },
        create: {
          firebaseUid: decoded.uid,
          phone: decoded.phone_number ?? undefined,
          email: decoded.email ?? undefined,
          name: (decoded.name as string | undefined) ?? undefined,
          photoUrl: (decoded.picture as string | undefined) ?? undefined,
          authProvider,
          lastLoginAt: new Date(),
        },
        update: {
          phone: decoded.phone_number ?? undefined,
          email: decoded.email ?? undefined,
          name: (decoded.name as string | undefined) ?? undefined,
          photoUrl: (decoded.picture as string | undefined) ?? undefined,
          lastLoginAt: new Date(),
        },
      });
      return res.json({ token: issueUserToken(user.id), userId: user.id });
    } catch (err: any) {
      if (err.code === "P2002") {
        // The new firebaseUid couldn't be created because its email/phone already belongs to a
        // *different* row — the real-world case is the same person who already has an account
        // via one sign-in method (e.g. phone) now also verifying a second one (e.g. Google) that
        // happens to share that email/phone, not two different people colliding. Rather than a
        // dead-end 409, attach this Firebase identity to that existing account instead — same
        // "same person, another provider" merge Firebase's own native account-linking does.
        // Known, accepted tradeoff: this moves firebaseUid to the new credential, so a future
        // sign-in via the *older* method's own firebaseUid (if it had a different one) would no
        // longer match this row — acceptable since re-authenticating via email/phone still finds
        // it either way.
        const existing = await prisma.user.findFirst({
          where: {
            OR: [
              decoded.email ? { email: decoded.email } : undefined,
              decoded.phone_number ? { phone: decoded.phone_number } : undefined,
            ].filter((c): c is NonNullable<typeof c> => !!c),
          },
        });
        if (existing) {
          const merged = await prisma.user.update({
            where: { id: existing.id },
            data: {
              firebaseUid: decoded.uid,
              phone: decoded.phone_number ?? undefined,
              email: decoded.email ?? undefined,
              name: (decoded.name as string | undefined) ?? undefined,
              photoUrl: (decoded.picture as string | undefined) ?? undefined,
              authProvider,
              lastLoginAt: new Date(),
            },
          });
          return res.json({ token: issueUserToken(merged.id), userId: merged.id });
        }
        return res.status(409).json({ error: "That phone/email is already linked to a different account" });
      }
      throw err;
    }
  }

  if (provider === "phone_custom") {
    const { phone, otp } = req.body ?? {};
    if (!phone || !otp) return res.status(400).json({ error: "phone and otp are required" });

    const record = await prisma.phoneOtp.findFirst({
      where: { phone, expiresAt: { gte: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!record) return res.status(401).json({ error: "No active OTP for this number — request a new one" });
    if (record.attempts >= 5) return res.status(429).json({ error: "Too many attempts — request a new OTP" });

    const ok = await bcrypt.compare(otp, record.codeHash);
    if (!ok) {
      await prisma.phoneOtp.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      return res.status(401).json({ error: "Incorrect code" });
    }

    const user = await prisma.user.upsert({
      where: { phone },
      create: { phone, authProvider: "phone_custom", lastLoginAt: new Date() },
      update: { authProvider: "phone_custom", lastLoginAt: new Date() },
    });
    await prisma.phoneOtp.deleteMany({ where: { phone } });
    return res.json({ token: issueUserToken(user.id), userId: user.id });
  }

  res.status(400).json({ error: "provider must be 'anonymous', 'firebase', or 'phone_custom'" });
});

// GET /auth/me — the logged-in user's profile, for the Profile screen.
// Both serviceOrderJson/quickActionRoutesJson are flat JSON-encoded string arrays — the client
// sends/receives real arrays, this is purely a storage-shape detail. null (never set, or an
// invalid stored value) means "no override," not "empty list" — callers fall back to the admin
// default order / hardcoded quick actions in that case.
function parseJsonArray(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The layout-quiz answers are a plain `{ [questionId]: string[] }` object; null means "not taken".
function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeUser(user: {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  authProvider: string | null;
  city: string | null;
  incomeBracket: string | null;
  salaryDayOfMonth: number | null;
  gender: string | null;
  persona: string | null;
  serviceOrderJson: string | null;
  quickActionRoutesJson: string | null;
  layoutQuizJson: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    photoUrl: user.photoUrl,
    authProvider: user.authProvider,
    city: user.city,
    incomeBracket: user.incomeBracket,
    salaryDayOfMonth: user.salaryDayOfMonth,
    gender: user.gender,
    // "SALARIED" | "BUSINESS" | "CREATOR" | "OTHER" — drives persona-aware copy on the client
    // (salary vs revenue vs avg income, job-loss vs business-loss runway framing) and which
    // services are shown. Column is NOT NULL default "SALARIED", so this is never actually null
    // for a real row; the `| null` is only for pre-generate typing slack.
    persona: user.persona ?? "SALARIED",
    serviceOrder: parseJsonArray(user.serviceOrderJson),
    quickActionRoutes: parseJsonArray(user.quickActionRoutesJson),
    // Raw "Set up my layout" quiz answers, `{ "<questionId>": ["<answerId>", ...] }` — null until
    // the user takes the quiz. The client re-opens the quiz pre-filled from this.
    layoutQuiz: parseJsonObject(user.layoutQuizJson),
    createdAt: user.createdAt,
  };
}

authRouter.get("/me", requireUser, async (req: UserRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(serializeUser(user));
});

// PATCH /auth/me — { name?, email?, gender?, persona?, city?, incomeBracket?, salaryDayOfMonth?,
// serviceOrder?, quickActionRoutes? } — lets Profile/Settings edit the fields peer benchmarking
// and the cash-flow calendar depend on, (name/email/gender/persona) the phone-login profile-
// completion form + onboarding persona step, and (serviceOrder/quickActionRoutes) the Arrange
// Services screen's own save action.
const PERSONAS = ["SALARIED", "BUSINESS", "CREATOR", "OTHER"];

authRouter.patch("/me", requireUser, async (req: UserRequest, res) => {
  const { name, email, gender, persona, city, incomeBracket, salaryDayOfMonth, serviceOrder, quickActionRoutes, layoutQuiz } = req.body ?? {};

  if (persona !== undefined && !PERSONAS.includes(persona)) {
    return res.status(400).json({ error: `persona must be one of ${PERSONAS.join(", ")}` });
  }
  if (serviceOrder !== undefined && !Array.isArray(serviceOrder)) {
    return res.status(400).json({ error: "serviceOrder must be an array of route keys" });
  }
  if (quickActionRoutes !== undefined) {
    if (!Array.isArray(quickActionRoutes) || quickActionRoutes.length > 4) {
      return res.status(400).json({ error: "quickActionRoutes must be an array of at most 4 route keys" });
    }
  }
  // layoutQuiz is opaque to the server — a plain object of answer selections the client scores
  // itself; null explicitly clears it. Just reject a non-object so a bad client can't store junk.
  if (layoutQuiz !== undefined && layoutQuiz !== null && (typeof layoutQuiz !== "object" || Array.isArray(layoutQuiz))) {
    return res.status(400).json({ error: "layoutQuiz must be an object or null" });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        name,
        email,
        gender,
        persona,
        city,
        incomeBracket,
        salaryDayOfMonth,
        serviceOrderJson: serviceOrder !== undefined ? JSON.stringify(serviceOrder) : undefined,
        quickActionRoutesJson: quickActionRoutes !== undefined ? JSON.stringify(quickActionRoutes) : undefined,
        layoutQuizJson: layoutQuiz !== undefined ? (layoutQuiz === null ? null : JSON.stringify(layoutQuiz)) : undefined,
      },
    });
    // Returns the exact same full shape GET /auth/me does — the Android client parses both
    // responses into the same UserProfileDto, and Moshi's strict parsing throws on any missing
    // required field (this previously returned only a handful of fields and silently failed to
    // parse everywhere the response was swallowed via runCatching, until a caller that surfaces
    // the error directly — the phone-login profile-completion form — made it visible as
    // "Required value 'createdAt' missing at $").
    res.json(serializeUser(user));
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "That email is already linked to a different account" });
    }
    throw err;
  }
});

// DELETE /auth/me — permanently deletes the requesting user's account and every row that has a
// real foreign-key constraint pointing at it. No onDelete: Cascade exists anywhere on User's
// relations (confirmed by reading the full schema) — adding it retroactively would mean an
// ALTER TABLE across ~25 foreign keys on a live production schema, a far riskier change than an
// explicit, reviewable, ordered application-level delete. Order matters only where a table-to-be-
// deleted itself has a foreign key into another table-to-be-deleted in this same list (documented
// inline below); everything else is independent and could run in any order.
//
// Feedback and BugReport are deliberately NOT deleted — both already have a nullable userId (a
// website Feedback submission or app crash report has no user at all), so an account deletion
// disowns them (sets userId to null) rather than erasing them. They're admin-facing product/
// triage history, not personal data the user necessarily expects gone with their account, and the
// schema's own nullable-userId design already anticipates "no owning user" as a valid state.
//
// MeshUsageLog.userId and AppEventLog.userId are plain nullable strings with no @relation/foreign
// key at all (confirmed in schema.prisma) — deleting a User can never violate a constraint via
// these two, so they're left untouched (internal operational/telemetry logs, same reasoning as
// Feedback/BugReport but with even less user-facing relevance).
//
// Household.ownerUserId is also a plain string with no foreign key — if the deleted user owned a
// household, the Household row and its other members' data are deliberately left intact (a
// household's other members shouldn't lose their shared data because the owner deleted their own
// account); only this user's own HouseholdMember row is removed below.
authRouter.delete("/me", requireUser, async (req: UserRequest, res) => {
  const userId = req.userId!;

  await prisma.$transaction([
    // LoungeVisit has no direct userId — it hangs off UserCreditCard, which is about to be
    // deleted below, so its rows must go first or the UserCreditCard delete would violate
    // LoungeVisit's foreign key.
    prisma.loungeVisit.deleteMany({ where: { userCreditCard: { userId } } }),
    // BillPayment optionally references RecurringPayment (recurringPaymentId) — delete before
    // RecurringPayment for the same reason as LoungeVisit/UserCreditCard above.
    prisma.billPayment.deleteMany({ where: { userId } }),
    prisma.userChallenge.deleteMany({ where: { userId } }),
    prisma.userBadge.deleteMany({ where: { userId } }),
    prisma.userCreditCard.deleteMany({ where: { userId } }),
    prisma.device.deleteMany({ where: { userId } }),
    prisma.proEntitlement.deleteMany({ where: { userId } }),
    prisma.chatUsage.deleteMany({ where: { userId } }),
    prisma.smsTransaction.deleteMany({ where: { userId } }),
    prisma.recurringPayment.deleteMany({ where: { userId } }),
    prisma.todoItem.deleteMany({ where: { userId } }),
    // LentMoneyRepayment/LentMoneyInstallment already cascade at the DB level from LentMoney.
    prisma.lentMoney.deleteMany({ where: { userId } }),
    prisma.netWorthSnapshot.deleteMany({ where: { userId } }),
    prisma.healthScoreSnapshot.deleteMany({ where: { userId } }),
    prisma.householdMember.deleteMany({ where: { userId } }),
    prisma.coinLedgerEntry.deleteMany({ where: { userId } }),
    prisma.voucherRedemption.deleteMany({ where: { userId } }),
    // A ReferralConversion can have this user on either side.
    prisma.referralConversion.deleteMany({ where: { OR: [{ referrerUserId: userId }, { referredUserId: userId }] } }),
    prisma.bankLink.deleteMany({ where: { userId } }),
    prisma.creditScoreSnapshot.deleteMany({ where: { userId } }),
    prisma.loan.deleteMany({ where: { userId } }),
    prisma.parkingTicket.deleteMany({ where: { userId } }),
    prisma.productRecord.deleteMany({ where: { userId } }),
    prisma.wishlistItem.deleteMany({ where: { userId } }),
    // SavingsContribution already cascades at the DB level from SavingsInstrument.
    prisma.savingsInstrument.deleteMany({ where: { userId } }),
    prisma.budget.deleteMany({ where: { userId } }),
    prisma.goal.deleteMany({ where: { userId } }),
    prisma.investment.deleteMany({ where: { userId } }),
    prisma.merchantCategoryOverride.deleteMany({ where: { userId } }),
    prisma.featureUsageEvent.deleteMany({ where: { userId } }),
    prisma.feedback.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.bugReport.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  res.status(204).send();
});
