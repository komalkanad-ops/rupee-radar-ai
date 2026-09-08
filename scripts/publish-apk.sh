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
# Published under a VERSIONED name (rupee-radar-ai-<versionName>.apk) because Hostinger's CDN caches
# static assets ~1h and ignores Cache-Control — a fixed filename would serve a stale APK each
# release. /download reads /app-version/latest and links to the versioned file. A stable copy is
# also written (that one needs a CDN purge to refresh).
#
# Every past versioned APK is kept in web/public/apk/ (served at apk.rupeeradarai.com) instead of
# being deleted, with an auto-generated index.html. The current release also gets a copy there so
# the archive is always complete; git dedupes the identical blob.
set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "usage: $0 /path/to/app-release.apk   (build it in the android repo first)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUB="$REPO_ROOT/web/public"
ARCHIVE="$PUB/apk"
mkdir -p "$ARCHIVE"

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

# Move any older versioned APK out of web/public/ into the archive (keeps the web build lean —
# only the current version + the stable pointer stay on the main site).
find "$PUB" -maxdepth 1 -name 'rupee-radar-ai-*.apk' ! -name "rupee-radar-ai-${VN}.apk" -exec mv -f {} "$ARCHIVE/" \;

cp "$SRC" "$PUB/rupee-radar-ai-${VN}.apk"
cp "$SRC" "$PUB/rupee-radar-ai.apk"
cp "$SRC" "$ARCHIVE/rupee-radar-ai-${VN}.apk"

# Keep only the newest KEEP_LOCAL versioned APKs in the in-repo archive; push the rest to the
# GitHub `apk-archive` release (unlimited, no repo/deploy bloat) and drop them locally. The index
# generator reads the release's asset list live, so those versions still show up on
# apk.rupeeradarai.com — just served from GitHub. Needs `gh` auth; skipped with a warning if absent.
KEEP_LOCAL=6
OLD_APKS=$(cd "$ARCHIVE" && ls -1 rupee-radar-ai-*.apk 2>/dev/null | sort -Vr | tail -n +$((KEEP_LOCAL + 1)) || true)
if [ -n "$OLD_APKS" ]; then
  if command -v gh >/dev/null 2>&1; then
    (cd "$ARCHIVE" && gh release upload apk-archive $OLD_APKS --repo komalkanad-ops/rupee-radar-ai --clobber) \
      && (cd "$ARCHIVE" && for a in $OLD_APKS; do git rm -q --ignore-unmatch "$a" >/dev/null 2>&1 || rm -f "$a"; done) \
      && echo "==> Aged $(printf '%s\n' "$OLD_APKS" | grep -c .) old APK(s) onto the GitHub apk-archive release"
  else
    echo "WARN: gh not found — old APKs kept in-repo. Install gh + rerun to age them onto GitHub Releases." >&2
  fi
fi

bash "$REPO_ROOT/scripts/gen-apk-archive-index.sh"

SIZE_MB=$(( $(stat -f%z "$PUB/rupee-radar-ai.apk" 2>/dev/null || stat -c%s "$PUB/rupee-radar-ai.apk") / 1048576 ))
ARCHIVE_COUNT=$(ls -1 "$ARCHIVE"/rupee-radar-ai-*.apk 2>/dev/null | wc -l | tr -d ' ')

cat <<EOF

==> Staged  web/public/rupee-radar-ai-${VN}.apk  (+ stable rupee-radar-ai.apk)  ~${SIZE_MB} MB
==> Archive web/public/apk/  now holds ${ARCHIVE_COUNT} versions (apk.rupeeradarai.com)

Next:
  git add web/public/rupee-radar-ai*.apk web/public/apk && git commit && git push origin main
  POST /app-version { platform:"android", versionName:"${VN}", versionCode:${VC}, channel:"STABLE" }
  POST /changelog   { version:"${VN}", releaseDate:"$(date -u +%Y-%m-%d)", platforms:["android"], ... }
  purge the rupeeradarai.com CDN cache, then check the .apk content-type is
  application/vnd.android.package-archive  (scripts/verify-release.sh)
EOF
