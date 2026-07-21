#!/usr/bin/env bash
# Build unsigned LibreWallet.app, pack LibreWallet.zip, optionally create a GitHub Release.
#
# Usage:
#   ./scripts/release-macos.sh              # build ZIP only → dist/macos/
#   ./scripts/release-macos.sh --publish    # build + gh release create (requires gh auth)
#
# Version comes from macos/project.yml (MARKETING_VERSION / CURRENT_PROJECT_VERSION).
# Tag format: v<MARKETING_VERSION>  e.g. v0.1.0

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS="$ROOT/macos"
DIST="$ROOT/dist/macos"
PUBLISH=0

for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required (brew install xcodegen)" >&2
  exit 1
fi

VERSION="$(ruby -ryaml -e 'puts YAML.load_file(ARGV[0]).dig("settings","base","MARKETING_VERSION")' "$MACOS/project.yml")"
BUILD="$(ruby -ryaml -e 'puts YAML.load_file(ARGV[0]).dig("settings","base","CURRENT_PROJECT_VERSION")' "$MACOS/project.yml")"
TAG="v${VERSION}"
ZIP_NAME="LibreWallet.zip"
APP_NAME="LibreWallet.app"

echo "==> Version ${VERSION} (build ${BUILD}), tag ${TAG}"

cd "$MACOS"
echo "==> xcodegen generate"
xcodegen generate

echo "==> xcodebuild archive (Release, unsigned)"
ARCHIVE_PATH="$DIST/LibreWallet.xcarchive"
rm -rf "$DIST"
mkdir -p "$DIST"

xcodebuild \
  -project LibreWallet.xcodeproj \
  -scheme LibreWallet \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -archivePath "$ARCHIVE_PATH" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  archive

APP_SRC="$ARCHIVE_PATH/Products/Applications/$APP_NAME"
if [[ ! -d "$APP_SRC" ]]; then
  echo "Archive did not contain $APP_NAME at $APP_SRC" >&2
  exit 1
fi

echo "==> Packing $ZIP_NAME"
(
  cd "$ARCHIVE_PATH/Products/Applications"
  ditto -c -k --keepParent "$APP_NAME" "$DIST/$ZIP_NAME"
)

NOTES_FILE="$DIST/release-notes.md"
{
  echo "## LibreWallet ${VERSION} (macOS native)"
  echo
  echo "Build: ${BUILD}"
  echo
  echo "### Instalacja"
  echo
  echo "1. Pobierz \`${ZIP_NAME}\` i rozpakuj."
  echo "2. Przenieś \`LibreWallet.app\` do folderu Aplikacje."
  echo "3. Przy pierwszym otwarciu: **prawy przycisk → Otwórz** (Gatekeeper)."
  echo
  if [[ -f "$ROOT/CHANGELOG.md" ]]; then
    echo "### Changelog"
    echo
    awk -v ver="$VERSION" '
      $0 ~ "^## \\[" ver "\\]" {p=1; print; next}
      p && $0 ~ /^## / {exit}
      p {print}
    ' "$ROOT/CHANGELOG.md" || true
  fi
} > "$NOTES_FILE"

echo "==> Artifacts:"
ls -lh "$DIST/$ZIP_NAME" "$NOTES_FILE"

if [[ "$PUBLISH" -eq 1 ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh CLI is required for --publish" >&2
    exit 1
  fi
  echo "==> Creating GitHub release ${TAG}"
  if ! git -C "$ROOT" rev-parse "$TAG" >/dev/null 2>&1; then
    git -C "$ROOT" tag -a "$TAG" -m "LibreWallet $VERSION"
  fi
  git -C "$ROOT" push origin "$TAG" 2>/dev/null || true

  if gh release view "$TAG" --repo wedishprocentahc/librewallet >/dev/null 2>&1; then
    gh release upload "$TAG" "$DIST/$ZIP_NAME" --clobber --repo wedishprocentahc/librewallet
  else
    gh release create "$TAG" \
      "$DIST/$ZIP_NAME" \
      --repo wedishprocentahc/librewallet \
      --title "LibreWallet $VERSION (macOS)" \
      --notes-file "$NOTES_FILE"
  fi
  echo "==> Published: https://github.com/wedishprocentahc/librewallet/releases/tag/${TAG}"
else
  echo "==> Done (local only). Publish with: $0 --publish"
fi
