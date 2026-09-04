#!/usr/bin/env bash
# Weekly security scan — run from .github/workflows/security-scan.yml (and locally to test).
#
# Runs a set of read-only scanners over the repo + a production probe, and writes a markdown
# fragment to findings/<scanner>.md for anything that needs a human. The workflow's reporter step
# turns any fragments into a deduped GitHub issue. Exit 0 always — the workflow decides pass/fail
# from whether findings/ is empty.
#
# Scanners:
#   1. OSV-Scanner — dependency CVEs (npm lockfiles), reads lockfiles
#      directly so no `npm install` is needed; osv-scanner.toml holds triaged ignores.
#   2. gitleaks — secrets in the working tree (config: .gitleaks.toml)
#   3. njsscan — Node/Express SAST on backend/src (ERROR severity only)
#   4. scripts/verify-release.sh — production health + APK content-type
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mkdir -p findings
rm -f findings/*.md

section() { printf '\n### %s\n\n' "$1"; }
fence() { printf '```\n'; }

# ── 1. OSV-Scanner ─────────────────────────────────────────────────────────────────
if [ ! -x ./osv-scanner ]; then
  curl -sSL -o osv-scanner "https://github.com/google/osv-scanner/releases/latest/download/osv-scanner_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
  chmod +x osv-scanner
fi
echo "::group::OSV-Scanner"
# Explicit project dirs (not `.`) so a stray worktree / node_modules copy isn't scanned.
# osv-scanner.toml holds the triaged / not-applicable ignores.
./osv-scanner scan source --recursive --config osv-scanner.toml --format table \
  backend web admin-console > osv.txt 2>&1
osv_rc=$?
cat osv.txt
echo "::endgroup::"
# 1 = vulnerabilities found; 0 = clean; other = tool/config issue (surfaced in the log)
if [ "$osv_rc" = "1" ]; then
  { section "OSV-Scanner — known-vulnerable dependencies"; fence; tail -n 120 osv.txt; fence; } >> findings/osv.md
fi

# ── 2. gitleaks ────────────────────────────────────────────────────────────────────
if [ ! -x ./gitleaks ]; then
  GL_VER=8.21.2
  GL_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  GL_ARCH=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
  curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v${GL_VER}/gitleaks_${GL_VER}_${GL_OS}_${GL_ARCH}.tar.gz" | tar -xz gitleaks
  chmod +x gitleaks
fi
echo "::group::gitleaks"
./gitleaks dir . --config .gitleaks.toml --redact --report-format json --report-path gitleaks.json --exit-code 0
gl_count=$(python3 -c "import json; print(len(json.load(open('gitleaks.json'))))" 2>/dev/null || echo 0)
echo "gitleaks findings: $gl_count"
echo "::endgroup::"
if [ "$gl_count" != "0" ]; then
  {
    section "gitleaks — $gl_count potential secret(s) in the working tree (redacted)"
    fence
    python3 -c "import json; [print(f\"{x['File']}:{x.get('StartLine','?')}  {x['RuleID']}\") for x in json.load(open('gitleaks.json'))]" | head -n 40
    fence
    echo "gitleaks has false positives — verify each. Anything real: **rotate the credential now** and add its fingerprint to \`.gitleaksignore\`."
  } >> findings/gitleaks.md
fi

# ── 3. njsscan (backend SAST, ERROR severity only) ─────────────────────────────────
if command -v njsscan >/dev/null 2>&1 || pip install --quiet njsscan 2>/dev/null; then
  echo "::group::njsscan"
  njsscan --json -o njsscan.json backend/src >/dev/null 2>&1
  njsscan backend/src 2>&1 | tail -n 40 || true
  python3 scripts/ci/njsscan_errors.py njsscan.json > findings/njsscan.md || rm -f findings/njsscan.md
  [ -s findings/njsscan.md ] || rm -f findings/njsscan.md
  echo "::endgroup::"
else
  echo "njsscan install failed — skipping (non-fatal)"
fi

# ── 4. production probe ────────────────────────────────────────────────────────────
echo "::group::production probe"
if out=$(bash scripts/verify-release.sh 2>&1); then
  echo "$out"
else
  echo "$out"
  { section "Production probe FAILED"; fence; echo "$out"; fence; } >> findings/prod.md
fi
echo "::endgroup::"

# ── summary ───────────────────────────────────────────────────────────────────────
if ls findings/*.md >/dev/null 2>&1; then
  echo "SECURITY SCAN: findings written to findings/"
  cat findings/*.md
else
  echo "SECURITY SCAN: clean"
fi
exit 0
