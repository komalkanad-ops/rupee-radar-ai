// Single source for the signing secret behind every session token (user and admin alike).
//
// Both call sites used to do `process.env.JWT_SECRET || "changeme"`, which fails *open*: a missing
// or blanked env var silently downgrades the whole auth system to a publicly-known secret, and
// nothing in the app would look broken — tokens would still be issued and accepted. Fail closed
// instead, and do it at module load so the process refuses to come up rather than serving forgeable
// tokens.
//
// Deliberately NOT gated on NODE_ENV: this app's Hostinger deployment doesn't set it, so a
// `NODE_ENV === "production"` guard would never fire in the one environment that matters. Local dev
// and CI both already supply a real secret (see `.env` and .github/workflows/ci.yml), so a hard
// requirement costs them nothing.
const MIN_LENGTH = 16;

export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "changeme" || secret.length < MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET is unset, too short (<${MIN_LENGTH} chars), or left at the placeholder value. ` +
        "Refusing to start — every session and admin token would be forgeable.",
    );
  }
  return secret;
}
