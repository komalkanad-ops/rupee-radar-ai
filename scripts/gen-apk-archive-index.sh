#!/usr/bin/env bash
# Regenerates web/public/apk/index.html — the listing served at apk.rupeeradarai.com.
#
# Lists EVERY past release. Recent builds live in web/public/apk/ (served straight off the site).
# Older builds are attached to the GitHub release `apk-archive` on the public repo so they don't
# bloat this repo or every Hostinger deploy — see ARCHIVED_VERSIONS below.
#
# Called by publish-apk.sh; safe to run standalone after adding/removing a local APK by hand.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$REPO_ROOT/web/public/apk"
OUT="$DIR/index.html"

GH_BASE="https://github.com/komalkanad-ops/rupee-radar-ai/releases/download/apk-archive"

# Versions on the GitHub `apk-archive` release. Preferably read live via `gh` (self-maintaining);
# the hardcoded list is the fallback for CI / offline / no-gh. (1.0.15–1.0.18 have no archived build.)
ARCHIVED_VERSIONS_FALLBACK="
1.0.0 1.0.1 1.0.2 1.0.3 1.0.4 1.0.5 1.0.6 1.0.7 1.0.8 1.0.9
1.0.10 1.0.11 1.0.12 1.0.13 1.0.14
1.0.19 1.0.20 1.0.21 1.0.22 1.0.23 1.0.24 1.0.25 1.0.26 1.0.27 1.0.28 1.0.29
1.0.30 1.0.31 1.0.32 1.0.33 1.0.34 1.0.35 1.0.36 1.0.37 1.0.38 1.0.39 1.0.40 1.0.41
1.0.42 1.0.43
"
ARCHIVED_VERSIONS=$(
  gh release view apk-archive --repo komalkanad-ops/rupee-radar-ai --json assets \
    --jq '.assets[].name | sub("^rupee-radar-ai-";"") | sub("\\.apk$";"")' 2>/dev/null \
  || printf '%s' "$ARCHIVED_VERSIONS_FALLBACK"
)

size_of() { local b; b=$(stat -f%z "$1" 2>/dev/null || stat -c%s "$1"); awk -v b="$b" 'BEGIN{printf "%.1f MB", b/1000000}'; }

LOCAL_VERSIONS=$(cd "$DIR" && ls -1 rupee-radar-ai-*.apk 2>/dev/null | sed -E 's/^rupee-radar-ai-(.*)\.apk$/\1/' || true)

# Union of local + archived, version-sorted newest first, deduped.
ALL_VERSIONS=$(printf '%s\n%s\n' "$LOCAL_VERSIONS" "$ARCHIVED_VERSIONS" | tr ' ' '\n' | grep -E '^[0-9]' | sort -Vru)
COUNT=$(printf '%s\n' "$ALL_VERSIONS" | grep -c . || true)
LOCAL_COUNT=$(printf '%s\n' "$LOCAL_VERSIONS" | grep -c . || true)

{
  cat <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Rupee Radar AI — APK archive</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0A0A12; color:#E8E8EC; font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:640px; margin:0 auto; padding:48px 20px; }
  h1 { font-size:1.5rem; margin:0 0 4px; }
  p.sub { color:#9A9AA6; margin:0 0 32px; }
  a.latest { color:#C6FF4A; }
  ul { list-style:none; padding:0; margin:0; }
  li { border:1px solid #23232E; border-radius:12px; padding:14px 16px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
  li a { color:#E8E8EC; text-decoration:none; font-weight:600; }
  li a:hover { color:#C6FF4A; }
  li .meta { color:#9A9AA6; font-size:.85rem; white-space:nowrap; }
  .note { margin-top:28px; color:#9A9AA6; font-size:.85rem; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Rupee Radar AI — APK archive</h1>
  <p class="sub">Every past release. For the current version, use <a class="latest" href="https://rupeeradarai.com/download">rupeeradarai.com/download</a>.</p>
  <ul>
HTML

  printf '%s\n' "$ALL_VERSIONS" | while IFS= read -r ver; do
    [ -n "$ver" ] || continue
    apk="rupee-radar-ai-${ver}.apk"
    if [ -f "$DIR/$apk" ]; then
      href="$apk"; meta="$(size_of "$DIR/$apk")"
    else
      href="$GH_BASE/$apk"; meta="GitHub"
    fi
    printf '    <li><a href="%s" download>Version %s</a><span class="meta">%s</span></li>\n' "$href" "$ver" "$meta"
  done

  cat <<HTML
  </ul>
  <p class="note">Older builds are provided as-is, hosted on GitHub. Generated $(date -u +%Y-%m-%d).</p>
</div>
</body>
</html>
HTML
} > "$OUT"

echo "wrote $OUT  (${COUNT} versions; ${LOCAL_COUNT} local, rest on GitHub)"
