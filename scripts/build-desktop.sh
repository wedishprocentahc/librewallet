#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -pe "require('$ROOT/package.json').version")"
DIST="$ROOT/dist/desktop"
mkdir -p "$DIST"

if ! command -v npx >/dev/null 2>&1; then
  echo "Brak npx. Zainstaluj Node.js 18+."
  exit 1
fi

echo "Budowanie aplikacji desktop (pkg)..."
cd "$ROOT"

build_target() {
  local target="$1"
  local output="$2"
  npx --yes pkg@5.8.1 package.json \
    --targets "$target" \
    --output "$DIST/$output" \
    --compress GZip
}

build_macos_pkg() {
  if [ "$(uname -s)" != "Darwin" ]; then
    return 0
  fi
  bash "$ROOT/scripts/build-macos-pkg.sh" "$1"
}

if [ "${1:-}" = "all" ]; then
  build_target node18-macos-arm64 "LibreWallet-${VERSION}-mac-arm64"
  build_macos_pkg arm64
  build_target node18-macos-x64 "LibreWallet-${VERSION}-mac-x64"
  build_macos_pkg x64
  build_target node18-win-x64 "LibreWallet-${VERSION}-win.exe"
else
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)
      build_target node18-macos-arm64 "LibreWallet-${VERSION}-mac-arm64"
      build_macos_pkg arm64
      ;;
    Darwin-x86_64)
      build_target node18-macos-x64 "LibreWallet-${VERSION}-mac-x64"
      build_macos_pkg x64
      ;;
    Linux-*)
      build_target node18-linux-x64 "LibreWallet-${VERSION}-linux-x64"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      build_target node18-win-x64 "LibreWallet-${VERSION}-win.exe"
      ;;
    *)
      echo "Nieznana platforma. Buduj ręcznie: npx pkg package.json --targets node18-macos-arm64 --output dist/desktop/LibreWallet"
      exit 1
      ;;
  esac
fi

cp "$ROOT/INSTALL.txt" "$DIST/"
echo "Gotowe w: $DIST"
