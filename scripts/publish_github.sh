#!/usr/bin/env bash
# Publish public repo + Release vX.Y.Z. Requires: gh auth login
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(tr -d '[:space:]' < VERSION)"
OWNER="${GITHUB_OWNER:-shastitko1970-netizen}"
REPO="${GITHUB_REPO:-substudio-browser}"
SLUG="$OWNER/$REPO"

python3 tests/test_overlay.py
python3 scripts/build_release.py
python3 scripts/build_setup.py

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

NOTES="$(cat <<EOF
## SubStudio Browser $VERSION

**Windows:** скачайте \`SubStudioBrowser-Setup-$VERSION.exe\` и откройте — свой установщик (не NSIS). По умолчанию качает официальный Firefox ESR в \`%LOCALAPPDATA%\\SubStudioBrowser\\runtime\`. Либо выберите «Copy the Firefox I already have». Повседневный Firefox не трогаем.

**Windows:** download \`SubStudioBrowser-Setup-$VERSION.exe\`. Custom installer UI. Default: official Firefox ESR into a private folder. Or copy the Firefox you already have. Daily Firefox is never patched.

ESR is fetched at install time, so Setup.exe stays small. Overlay zip is still the in-app updater payload.

Unsigned companion XPI persists on ESR / Developer Edition. Firefox Release may drop the Grok sidecar.

Launcher reads public GitHub Releases. This release is not a draft.
EOF
)"

if gh release view "v$VERSION" --repo "$SLUG" >/dev/null 2>&1; then
  gh release upload "v$VERSION" --repo "$SLUG" --clobber \
    dist/SubStudioBrowser-"$VERSION".zip \
    dist/SubStudioBrowser-"$VERSION".zip.sha256 \
    dist/SubStudioBrowser-Setup-"$VERSION".exe \
    dist/SubStudioBrowser-Setup-"$VERSION".exe.sha256 \
    dist/substudio-companion-"$VERSION".xpi \
    dist/updates.json
else
  gh release create "v$VERSION" \
    --repo "$SLUG" \
    --title "SubStudio Browser $VERSION" \
    --notes "$NOTES" \
    dist/SubStudioBrowser-"$VERSION".zip \
    dist/SubStudioBrowser-"$VERSION".zip.sha256 \
    dist/SubStudioBrowser-Setup-"$VERSION".exe \
    dist/SubStudioBrowser-Setup-"$VERSION".exe.sha256 \
    dist/substudio-companion-"$VERSION".xpi \
    dist/updates.json
fi

echo "https://github.com/$SLUG/releases/tag/v$VERSION"
