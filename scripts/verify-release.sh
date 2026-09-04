#!/usr/bin/env bash
#
# verify-release.sh — post-deploy / scheduled production health probe.
#
# Read-only: every check is a plain GET/HEAD against a public endpoint, no auth token, no writes.
# Safe to run from CI without secrets, from a laptop, or on a cron schedule.
#
# Covers the three production incidents this project shipped in a fortnight, none of which anything
# in CI caught:
#   - an APK the CDN served as text/html (users got a renamed .html)                  -> checks 7
#   - a backend change that never reached prod because the backend-root push was missed -> check 6
#   - two silent DB outages where /health returned 200 while every DB route 500'd      -> checks 2,3
#
# Usage:
#   scripts/verify-release.sh                         # checks 1-4, 7  (the scheduled set)
#   scripts/verify-release.sh --new-route /budgets    # + check 6: a route added in this release
#   scripts/verify-release.sh --check-deploy          # + check 5: prod versionCode == build.gradle.kts
#
# Exit code is non-zero if ANY check fails (WARN does not fail the run).

set -euo pipefail

API="${API_BASE:-https://api.rupeeradarai.com}"
SITE="${SITE_BASE:-https://rupeeradarai.com}"
ADMIN="${ADMIN_BASE:-https://admin.rupeeradarai.com}"
GRADLE_FILE="${GRADLE_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/android/app/build.gradle.kts}"

NEW_ROUTE=""
CHECK_DEPLOY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --new-route) NEW_ROUTE="${2:-}"; shift 2 ;;
    --check-deploy) CHECK_DEPLOY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
warn() { printf 'WARN  %s\n' "$1"; }

# curl helper: prints the body to stdout, HTTP status to fd 3-substitute via a temp var.
http_get() { curl -sS --max-time 20 -w '\n%{http_code}' "$1"; }

# ---------------------------------------------------------------------------------------------------
# 1  GET /health -> 200, body.ok === true
# ---------------------------------------------------------------------------------------------------
resp="$(http_get "$API/health")" || true
code="${resp##*$'\n'}"; body="${resp%$'\n'*}"
if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"ok":[[:space:]]*true'; then
  pass "1  /health -> 200 ok:true"
else
  fail "1  /health -> $code  body: $body"
fi

# ---------------------------------------------------------------------------------------------------
# 2  GET /health/db -> 200 (NOT 503) — the real DB check; 503 = the known wedged-pool outage
# ---------------------------------------------------------------------------------------------------
resp="$(http_get "$API/health/db")" || true
code="${resp##*$'\n'}"; body="${resp%$'\n'*}"
if [ "$code" = "200" ]; then
  pass "2  /health/db -> 200 (DB reachable)"
elif [ "$code" = "503" ]; then
  fail "2  /health/db -> 503 — wedged connection pool. Restart the Node app (Hostinger MCP)."
else
  fail "2  /health/db -> $code  body: $body"
fi

# ---------------------------------------------------------------------------------------------------
# 3  GET /cards -> 200, JSON array, length > 0 (a real DB-touching read path)
# ---------------------------------------------------------------------------------------------------
resp="$(http_get "$API/cards")" || true
code="${resp##*$'\n'}"; body="${resp%$'\n'*}"
count="$(printf '%s' "$body" | grep -o '"id"' | wc -l | tr -d ' ')"
if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '^\[' && [ "${count:-0}" -gt 0 ]; then
  pass "3  /cards -> 200, JSON array, ~$count entries"
else
  fail "3  /cards -> $code  (array? / non-empty? — got count=$count)"
fi

# ---------------------------------------------------------------------------------------------------
# 4  GET /app-version/latest -> 200; capture versionName / versionCode
# ---------------------------------------------------------------------------------------------------
PROD_VN=""; PROD_VC=""
resp="$(http_get "$API/app-version/latest")" || true
code="${resp##*$'\n'}"; body="${resp%$'\n'*}"
if [ "$code" = "200" ]; then
  # latestStable block: "...,"latestStable":{...,"versionName":"1.0.31","versionCode":65,...}
  stable="$(printf '%s' "$body" | sed -n 's/.*"latestStable":{\([^}]*\)}.*/\1/p')"
  PROD_VN="$(printf '%s' "$stable" | sed -n 's/.*"versionName":"\([^"]*\)".*/\1/p')"
  PROD_VC="$(printf '%s' "$stable" | sed -n 's/.*"versionCode":\([0-9]*\).*/\1/p')"
  if [ -n "$PROD_VN" ] && [ -n "$PROD_VC" ]; then
    pass "4  /app-version/latest -> 200  stable=$PROD_VN (vc $PROD_VC)"
  else
    fail "4  /app-version/latest -> 200 but could not parse latestStable version"
  fi
else
  fail "4  /app-version/latest -> $code"
fi

# ---------------------------------------------------------------------------------------------------
# 5  Deploy-landed: prod versionCode (from 4) === versionCode in android/app/build.gradle.kts
#    Only with --check-deploy (needs the repo checked out).
# ---------------------------------------------------------------------------------------------------
if [ "$CHECK_DEPLOY" = "1" ]; then
  if [ -f "$GRADLE_FILE" ]; then
    LOCAL_VC="$(grep -oE 'versionCode[[:space:]]*=[[:space:]]*[0-9]+' "$GRADLE_FILE" | grep -oE '[0-9]+' | head -n1)"
    if [ -n "$LOCAL_VC" ] && [ "$LOCAL_VC" = "$PROD_VC" ]; then
      pass "5  deploy-landed: build.gradle.kts vc $LOCAL_VC == /app-version/latest vc $PROD_VC"
    else
      fail "5  deploy-landed: build.gradle.kts vc $LOCAL_VC != prod vc $PROD_VC (forgot POST /app-version?)"
    fi
  else
    fail "5  deploy-landed: $GRADLE_FILE not found"
  fi
fi

# ---------------------------------------------------------------------------------------------------
# 6  Backend-deploy-landed: GET <route> -> 401 or 200, NOT 404.
#    /health returns 200 from the STALE build during a rollout; only a new route's 404->401/200
#    transition proves the backend deploy actually landed. Only with --new-route.
# ---------------------------------------------------------------------------------------------------
if [ -n "$NEW_ROUTE" ]; then
  code="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$API$NEW_ROUTE")" || true
  if [ "$code" = "404" ]; then
    fail "6  backend-deploy: GET $NEW_ROUTE -> 404 — new route not live, backend-root push missed?"
  elif [ "$code" = "200" ] || [ "$code" = "401" ] || [ "$code" = "403" ]; then
    pass "6  backend-deploy: GET $NEW_ROUTE -> $code (route is live)"
  else
    warn "6  backend-deploy: GET $NEW_ROUTE -> $code (not 404, but unexpected — check manually)"
  fi
fi

# ---------------------------------------------------------------------------------------------------
# 7  APK content-type on the VERSIONED file — the exact 1.0.24 bug (CDN served index.html as .apk).
# ---------------------------------------------------------------------------------------------------
if [ -n "$PROD_VN" ]; then
  APK_URL="$SITE/rupee-radar-ai-$PROD_VN.apk"
  headers="$(curl -sS --max-time 20 -I "$APK_URL")" || true
  hcode="$(printf '%s' "$headers" | sed -n 's/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p' | tail -n1)"
  ctype="$(printf '%s' "$headers" | tr -d '\r' | sed -n 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//p' | tail -n1)"
  if [ "$hcode" = "200" ] && printf '%s' "$ctype" | grep -qiE 'application/vnd.android.package-archive|application/octet-stream'; then
    pass "7  $APK_URL -> 200  content-type: $ctype"
  else
    fail "7  $APK_URL -> $hcode  content-type: '${ctype:-none}' (expected an APK type, NOT text/html)"
  fi

  # 7b  stable filename — expected to lag behind the CDN purge, so WARN not FAIL.
  headers="$(curl -sS --max-time 20 -I "$SITE/rupee-radar-ai.apk")" || true
  ctype="$(printf '%s' "$headers" | tr -d '\r' | sed -n 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//p' | tail -n1)"
  if printf '%s' "$ctype" | grep -qiE 'application/vnd.android.package-archive|application/octet-stream'; then
    pass "7b /rupee-radar-ai.apk (stable) -> content-type: $ctype"
  else
    warn "7b /rupee-radar-ai.apk (stable) -> '${ctype:-none}' — run hosting_clearWebsiteCacheV1 for rupeeradarai.com"
  fi
else
  fail "7  cannot check APK content-type — no versionName from check 4"
fi

echo
if [ "$FAILED" -ne 0 ]; then
  echo "RESULT  FAIL — one or more production checks did not pass"
  exit 1
fi
echo "RESULT  PASS — production looks healthy"
