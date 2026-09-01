#!/usr/bin/env bash
# Publish public repo + Release v0.1.0. Requires: gh auth login
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(tr -d '[:space:]' < VERSION)"
OWNER="${GITHUB_OWNER:-shastitko1970-netizen}"
REPO="${GITHUB_REPO:-substudio-browser}"
SLUG="$OWNER/$REPO"

python3 tests/test_overlay.py
python3 scripts/build_release.py

if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated. Run: gh auth login" >&2
  echo "Then: $0" >&2
  exit 1
fi

if ! gh repo view "$SLUG" >/dev/null 2>&1; then
  gh repo create "$SLUG" --public --source=. --remote=github --push --description "SubStudio Browser — Firefox overlay, not a fork"
else
  git remote get-url github >/dev/null 2>&1 || git remote add github "https://github.com/$SLUG.git"
  git push github HEAD:main
  git push github "v$VERSION"
fi

if gh release view "v$VERSION" --repo "$SLUG" >/dev/null 2>&1; then
  echo "Release v$VERSION already exists"
else
  gh release create "v$VERSION" \
    --repo "$SLUG" \
    --title "SubStudio Browser $VERSION" \
    --notes "Private Firefox copy + Grok sidecar. Launcher is the primary updater. Unsigned XPI needs ESR/Dev or AMO signing on Release." \
    dist/SubStudioBrowser-"$VERSION".zip \
    dist/SubStudioBrowser-"$VERSION".zip.sha256 \
    dist/substudio-companion-"$VERSION".xpi \
    dist/updates.json
fi

echo "https://github.com/$SLUG/releases/tag/v$VERSION"
