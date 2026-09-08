#!/usr/bin/env bash
# Stages a pre-built signed release APK for the public download page (rupeeradarai.com/download).
#
# The Android app lives in a separate (local) repo. Build the signed release APK there first:
#   cd <android-repo>
#   export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
#   gradle -Dorg.gradle.java.home="$JAVA_HOME" :app:assembleRelease
# then run this from THIS repo with the path to that APK:
#   ./scripts/publish-apk.sh <android-repo>/app/build/outputs/apk/release/app-release.apk
#
# The CURRENT build is written to web/public/ under a VERSIONED name
# (rupee-radar-ai-<versionName>.apk) — Hostinger's CDN caches static assets ~1h and ignores
# Cache-Control, so a fixed filename would serve a stale APK each release. /download reads
# /app-version/latest and links to the versioned file. A stable rupee-radar-ai.apk is also written
# (that one needs a CDN purge to refresh).
#
# EVERY release (incl. the current one) is also uploaded to the GitHub release `apk-archive` on the
# public repo — the full history lives there. The website itself keeps only the newest KEEP_LOCAL
# builds in web/public/ and lists them in web/public/apk-versions.json; /download renders that as
# "Previous versions". (The GitHub archive is deliberately not surfaced on the site yet.)
set -euo pipefail

KEEP_LOCAL=4   # current build + 3 previous, shown on /download

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "usage: $0 /path/to/app-release.apk   (build it in the android repo first)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUB="$REPO_ROOT/web/public"

# versionName / versionCode from the APK itself — needs aapt/aapt2 (Android SDK build-tools).
# If they're not on PATH, pass them explicitly:  VN=1.0.40 VC=74 ./scripts/publish-apk.sh <apk>
DUMP=""
if command -v aapt2 >/dev/null 2>&1; then DUMP=$(aapt2 dump badging "$SRC")
elif command -v aapt  >/dev/null 2>&1; then DUMP=$(aapt  dump badging "$SRC"); fi
VN="${VN:-$(sed -nE "s/.*versionName='([^']+)'.*/\1/p" <<<"$DUMP")}"
VC="${VC:-$(sed -nE "s/.*versionCode='([0-9]+)'.*/\1/p" <<<"$DUMP")}"
if [ -z "$VN" ] || [ -z "$VC" ]; then
  echo "could not read versionName/versionCode from the APK — re-run with  VN=x.y.z VC=n  set" >&2
  exit 1
fi

cp "$SRC" "$PUB/rupee-radar-ai-${VN}.apk"
cp "$SRC" "$PUB/rupee-radar-ai.apk"

# Push this release to the GitHub archive (idempotent via --clobber). Needs `gh` auth.
if command -v gh >/dev/null 2>&1; then
  gh release upload apk-archive "$PUB/rupee-radar-ai-${VN}.apk" \
    --repo komalkanad-ops/rupee-radar-ai --clobber \
    && echo "==> Uploaded rupee-radar-ai-${VN}.apk to the GitHub apk-archive release"
else
  echo "WARN: gh not found — upload rupee-radar-ai-${VN}.apk to the apk-archive release by hand." >&2
fi

# Keep only the newest KEEP_LOCAL versioned APKs on the site; the rest stay on the GitHub archive.
(cd "$PUB" && ls -1 rupee-radar-ai-*.apk 2>/dev/null | sort -Vr | tail -n +$((KEEP_LOCAL + 1))) \
  | while IFS= read -r old; do
      [ -n "$old" ] || continue
      git -C "$REPO_ROOT" rm -q --ignore-unmatch "$PUB/$old" >/dev/null 2>&1 || true
      rm -f "$PUB/$old"
    done

# Regenerate the manifest /download reads for its "Previous versions" list (newest first).
(cd "$PUB" && ls -1 rupee-radar-ai-*.apk 2>/dev/null | sed -E 's/^rupee-radar-ai-(.*)\.apk$/\1/' | sort -Vr \
  | awk 'BEGIN{printf "["} {printf "%s%s\"%s\"", (NR>1?", ":""), "", $0} END{print "]"}') \
  > "$PUB/apk-versions.json"

SIZE_MB=$(( $(stat -f%z "$PUB/rupee-radar-ai.apk" 2>/dev/null || stat -c%s "$PUB/rupee-radar-ai.apk") / 1048576 ))

cat <<EOF

==> Staged  web/public/rupee-radar-ai-${VN}.apk  (+ stable rupee-radar-ai.apk)  ~${SIZE_MB} MB
==> Archived on GitHub release  apk-archive  (rendered on rupeeradarai.com/download → "Previous versions")

Next:
  git add web/public/rupee-radar-ai*.apk web/public/apk-versions.json && git commit && git push origin main
  POST /app-version { platform:"android", versionName:"${VN}", versionCode:${VC}, channel:"STABLE" }
  POST /changelog   { version:"${VN}", releaseDate:"$(date -u +%Y-%m-%d)", platforms:["android"], ... }
  purge the rupeeradarai.com CDN cache, then check the .apk content-type is
  application/vnd.android.package-archive  (scripts/verify-release.sh)
EOF
