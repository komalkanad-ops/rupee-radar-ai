# Rupee Radar AI — API & web

The public surfaces of [Rupee Radar AI](https://rupeeradarai.com), a personal-finance and Indian
credit-card-intelligence platform. The Android app (where most of the product logic lives) is
developed separately and is not in this repository.

| Path | What | Deployed to |
|---|---|---|
| `backend/` | Node.js · TypeScript · Express · Prisma · MySQL API | `api.rupeeradarai.com` |
| `web/` | React · Vite · Tailwind marketing site + free tools (EMI calculator, statement analyzer) | `rupeeradarai.com` |
| `admin-console/` | React · Vite · Tailwind admin panel — credit-card catalog CRUD, corrections queue, monitoring | `admin.rupeeradarai.com` |

All three are hosted on Hostinger under `rupeeradarai.com`. Every admin write is gated by a JWT
bearer token (`requireAdmin`) — the admin console's client code carries no privileged logic.

## Local development

```bash
# Backend  (needs a MySQL instance; copy backend/.env.example → backend/.env)
cd backend && npm install && npx prisma generate && npx prisma migrate deploy && npm run dev

# Web
cd web && npm install && npm run dev

# Admin console
cd admin-console && npm install && npm run dev
```

## Backend modules

`backend/src/modules/<domain>/` — one router per domain: auth, cards, corrections, sms, recurring,
networth, insights, budgets, goals, investments, places, billing, config, push, users, statements,
categorization, monitoring, and more. Schema changes go through real Prisma migrations under
`backend/prisma/migrations/` (`npx prisma migrate dev --name <desc>` locally, committed, applied
automatically on deploy).

## CI & scanning

- `.github/workflows/ci.yml` — typecheck + tests + build for all three surfaces, on every PR and
  every commit to `main`.
- `.github/workflows/security-scan.yml` — weekly (Wednesday): OSV-Scanner (dependency CVEs, with
  `osv-scanner.toml` triage), gitleaks (secrets), njsscan (backend SAST), and a production probe.
  Findings open a deduped tracking issue.
- `.github/workflows/verify-prod.yml` — a lightweight production health + APK-download check every
  few hours; opens an issue if it fails.

## Config not in git

`backend/.env` (local), the Hostinger environment variables (set in hPanel), and anything under a
gitignored `secrets/` directory. The repo contains no credentials — see `.gitleaks.toml`.
