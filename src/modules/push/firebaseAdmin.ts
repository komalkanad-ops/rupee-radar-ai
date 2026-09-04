import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

// FIREBASE_SERVICE_ACCOUNT_JSON_B64 holds the full service-account JSON, base64-encoded, as a
// single-line string. This is the primary path — Hostinger's env var injection pipeline was
// confirmed (2026-08-28, via a minimal {x}/"x"/[x] test-var reproduction) to corrupt curly braces
// specifically (inserting a stray backslash before every { and }), which silently breaks any raw
// JSON value stored directly. Base64 output contains no braces at all, so it passes through intact
// regardless of that platform bug. FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON, no base64) is kept as a
// fallback for local/dev environments that don't have this corruption — never required in
// production once the B64 var is set.
function readServiceAccountJson(): string | null {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64;
  if (b64) {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch (err) {
      console.error("Failed to base64-decode FIREBASE_SERVICE_ACCOUNT_JSON_B64", err);
      return null;
    }
  }
  return process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? null;
}

let app: App | null | undefined;

function getFirebaseApp(): App | null {
  if (app !== undefined) return app;

  const raw = readServiceAccountJson();
  if (!raw) {
    console.warn("No Firebase service account configured — push notifications are disabled");
    app = null;
    return app;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    console.error("Failed to initialize Firebase Admin — push notifications are disabled", err);
    app = null;
  }
  return app;
}

// Safe (non-secret) diagnostic for the admin console / a one-off admin check — reports whether the
// env var is present and whether Admin SDK init actually succeeded, without ever exposing the raw
// value. Built specifically because a black-box 401 from /auth/session looks identical whether the
// env var is missing, malformed, or the client's token is genuinely invalid — this makes those
// cases distinguishable from the outside.
// The service account JSON's private key sits in the middle of the string — the first/last 40
// characters are always just structural header/footer ("{"type":"service_account"..." and
// ...universe_domain":"googleapis.com"}"), never key material, so these are safe to return. The
// per-character counts (braces/quotes/backslashes) are a structural fingerprint: comparing them
// against a known-correct copy reveals *where* re-escaping corruption happened (e.g. "+31
// backslashes" tells you exactly how many extra escape characters got inserted) without ever
// exposing the actual secret bytes.
function structuralFingerprint(raw: string) {
  return {
    length: raw.length,
    first40: raw.slice(0, 40),
    last40: raw.slice(-40),
    braceOpenCount: (raw.match(/\{/g) ?? []).length,
    braceCloseCount: (raw.match(/\}/g) ?? []).length,
    quoteCount: (raw.match(/"/g) ?? []).length,
    backslashCount: (raw.match(/\\/g) ?? []).length,
  };
}

export function getFirebaseDiagnostics(): {
  usingBase64Source: boolean;
  envVarPresent: boolean;
  envVarLength: number;
  initialized: boolean;
  projectId: string | null;
  parseError: string | null;
  fingerprint: ReturnType<typeof structuralFingerprint> | null;
} {
  const usingBase64Source = !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64;
  const raw = readServiceAccountJson();
  const result = {
    usingBase64Source,
    envVarPresent: !!raw,
    envVarLength: raw?.length ?? 0,
    initialized: false,
    projectId: null as string | null,
    parseError: null as string | null,
    fingerprint: null as ReturnType<typeof structuralFingerprint> | null,
  };
  if (!raw) return result;

  result.fingerprint = structuralFingerprint(raw);

  try {
    const serviceAccount = JSON.parse(raw);
    result.projectId = serviceAccount.project_id ?? null;
  } catch (err) {
    result.parseError = err instanceof Error ? err.message : String(err);
    return result;
  }

  result.initialized = getFirebaseApp() !== null;
  return result;
}

export async function sendPushToTokens(
  tokens: string[],
  notification: { title: string; body: string },
): Promise<{ sent: number; failedTokens: string[] }> {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp || tokens.length === 0) return { sent: 0, failedTokens: [] };

  const result = await getMessaging(firebaseApp).sendEachForMulticast({
    tokens,
    notification,
  });

  const failedTokens = result.responses
    .map((r, i) => (r.success ? null : tokens[i]))
    .filter((t): t is string => t !== null);

  return { sent: result.successCount, failedTokens };
}

// Verifies a Firebase Auth ID token from the Android app's Google/phone sign-in flow, reusing this
// same already-installed Admin SDK (no new dependency). Returns null (not a throw) when Firebase
// isn't configured yet or the token is invalid — callers turn that into a 401/503, not a crash.
export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken | null> {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  try {
    return await getAuth(firebaseApp).verifyIdToken(idToken);
  } catch (err) {
    console.error("Firebase ID token verification failed", err);
    return null;
  }
}
