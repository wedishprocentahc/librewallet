#!/usr/bin/env bash
# Build LibreWallet.app, pack LibreWallet.zip + .pkg, optionally sign/notarize and publish.
#
# Usage:
#   ./scripts/release-macos.sh                 # unsigned local artifacts → dist/macos/
#   ./scripts/release-macos.sh --sign          # Developer ID sign (requires certs)
#   ./scripts/release-macos.sh --sign --notarize
#   ./scripts/release-macos.sh --sign --notarize --publish
#
# Version from macos/project.yml (MARKETING_VERSION). Tag: v<VERSION>
#
# Env (optional):
#   LW_TEAM_ID              Apple Team ID (10 chars) — required for --sign
#   LW_SIGN_IDENTITY        Developer ID Application identity
#   LW_INSTALLER_IDENTITY   Developer ID Installer identity
#   LW_NOTARY_PROFILE       notarytool keychain profile (default: librewallet-notary)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS="$ROOT/macos"
DIST="$ROOT/dist/macos"
PUBLISH=0
SIGN=0
NOTARIZE=0

for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --sign) SIGN=1 ;;
    --notarize) NOTARIZE=1; SIGN=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
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
PKG_NAME="LibreWallet-${VERSION}-mac-arm64.pkg"
APP_NAME="LibreWallet.app"

echo "==> Version ${VERSION} (build ${BUILD}), tag ${TAG}"
echo "==> Options: sign=${SIGN} notarize=${NOTARIZE} publish=${PUBLISH}"

cd "$MACOS"
echo "==> xcodegen generate"
xcodegen generate

echo "==> xcodebuild archive (Release)"
ARCHIVE_PATH="$DIST/LibreWallet.xcarchive"
rm -rf "$DIST"
mkdir -p "$DIST"

SIGN_ARGS=()
if [[ "$SIGN" -eq 1 ]]; then
  TEAM_ID="${LW_TEAM_ID:-}"
  if [[ -z "$TEAM_ID" ]]; then
    echo "Dla --sign ustaw LW_TEAM_ID (10-znakowy Team ID z developer.apple.com)." >&2
    exit 1
  fi
  IDENTITY="${LW_SIGN_IDENTITY:-Developer ID Application}"
  SIGN_ARGS=(
    CODE_SIGN_STYLE=Manual
    CODE_SIGN_IDENTITY="$IDENTITY"
    DEVELOPMENT_TEAM="$TEAM_ID"
    OTHER_CODE_SIGN_FLAGS="--timestamp"
    CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO
  )
  echo "==> Signing with team ${TEAM_ID}, identity ${IDENTITY}"
else
  SIGN_ARGS=(
    CODE_SIGN_IDENTITY="-"
    CODE_SIGNING_REQUIRED=NO
    CODE_SIGNING_ALLOWED=NO
  )
  echo "==> Building unsigned (Gatekeeper: prawy → Otwórz)"
fi

xcodebuild \
  -project LibreWallet.xcodeproj \
  -scheme LibreWallet \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -archivePath "$ARCHIVE_PATH" \
  "${SIGN_ARGS[@]}" \
  archive

APP_SRC="$ARCHIVE_PATH/Products/Applications/$APP_NAME"
if [[ ! -d "$APP_SRC" ]]; then
  echo "Archive did not contain $APP_NAME at $APP_SRC" >&2
  exit 1
fi

# Hardened runtime / deep sign pass when --sign (archive may already be signed).
if [[ "$SIGN" -eq 1 ]]; then
  IDENTITY="${LW_SIGN_IDENTITY:-Developer ID Application}"
  echo "==> codesign --deep --options runtime"
  codesign --force --deep --options runtime --timestamp --sign "$IDENTITY" "$APP_SRC"
  codesign --verify --deep --strict --verbose=2 "$APP_SRC"
fi

echo "==> Packing $ZIP_NAME"
(
  cd "$ARCHIVE_PATH/Products/Applications"
  ditto -c -k --keepParent "$APP_NAME" "$DIST/$ZIP_NAME"
)

echo "==> Building $PKG_NAME"
chmod +x "$ROOT/scripts/build-macos-native-pkg.sh"
"$ROOT/scripts/build-macos-native-pkg.sh" "$APP_SRC" arm64

if [[ "$NOTARIZE" -eq 1 ]]; then
  chmod +x "$ROOT/scripts/notarize-macos.sh"
  echo "==> Notarizing app + pkg"
  "$ROOT/scripts/notarize-macos.sh" "$APP_SRC" "$DIST/$PKG_NAME"
  # Refresh zip from stapled app
  (
    cd "$ARCHIVE_PATH/Products/Applications"
    rm -f "$DIST/$ZIP_NAME"
    ditto -c -k --keepParent "$APP_NAME" "$DIST/$ZIP_NAME"
  )
fi

NOTES_FILE="$DIST/release-notes.md"
{
  echo "## LibreWallet ${VERSION} (macOS native)"
  echo
  echo "Build: ${BUILD}"
  echo
  echo "### Instalacja"
  echo
  if [[ "$NOTARIZE" -eq 1 ]]; then
    echo "1. Pobierz \`${PKG_NAME}\` (preferowane) albo \`${ZIP_NAME}\`."
    echo "2. Zainstaluj / przenieś \`LibreWallet.app\` do **Aplikacje**."
    echo "3. Uruchom dwuklikiem (build notaryzowany)."
  else
    echo "1. Pobierz \`${ZIP_NAME}\` i rozpakuj (albo \`${PKG_NAME}\`)."
    echo "2. Przenieś \`LibreWallet.app\` do folderu Aplikacje."
    echo "3. Przy pierwszym otwarciu: **prawy przycisk → Otwórz** (Gatekeeper)."
  fi
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
ls -lh "$DIST/$ZIP_NAME" "$DIST/$PKG_NAME" "$NOTES_FILE"

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
    gh release upload "$TAG" "$DIST/$ZIP_NAME" "$DIST/$PKG_NAME" --clobber --repo wedishprocentahc/librewallet
  else
    gh release create "$TAG" \
      "$DIST/$ZIP_NAME" \
      "$DIST/$PKG_NAME" \
      --repo wedishprocentahc/librewallet \
      --title "LibreWallet $VERSION (macOS)" \
      --notes-file "$NOTES_FILE"
  fi
  echo "==> Published: https://github.com/wedishprocentahc/librewallet/releases/tag/${TAG}"
else
  echo "==> Done (local only)."
  echo "    Signed+notarized: $0 --sign --notarize"
  echo "    Publish:          $0 --sign --notarize --publish"
fi
