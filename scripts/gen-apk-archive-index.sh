#!/usr/bin/env bash
# Regenerates web/public/apk/index.html — the listing served at apk.rupeeradarai.com — from
# whatever rupee-radar-ai-<version>.apk files are currently in web/public/apk/.
# Called by publish-apk.sh; safe to run standalone after adding/removing an APK by hand.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$REPO_ROOT/web/public/apk"
OUT="$DIR/index.html"

size_of() { local b; b=$(stat -f%z "$1" 2>/dev/null || stat -c%s "$1"); awk -v b="$b" 'BEGIN{printf "%.1f MB", b/1000000}'; }

# version-sort the APKs, newest first (portable: no mapfile — macOS ships bash 3.2)
APKS=$(cd "$DIR" && ls -1 rupee-radar-ai-*.apk 2>/dev/null | sort -Vr)
COUNT=$(printf '%s\n' "$APKS" | grep -c . || true)

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

  printf '%s\n' "$APKS" | while IFS= read -r apk; do
    [ -n "$apk" ] || continue
    ver="${apk#rupee-radar-ai-}"; ver="${ver%.apk}"
    sz="$(size_of "$DIR/$apk")"
    printf '    <li><a href="%s" download>Version %s</a><span class="meta">%s</span></li>\n' "$apk" "$ver" "$sz"
  done

  cat <<HTML
  </ul>
  <p class="note">Older builds are provided as-is. Generated $(date -u +%Y-%m-%d).</p>
</div>
</body>
</html>
HTML
} > "$OUT"

echo "wrote $OUT  (${COUNT} versions)"
