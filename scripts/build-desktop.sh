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

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    build_target node18-macos-arm64 "Torba-${VERSION}-mac-arm64"
    ;;
  Darwin-x86_64)
    build_target node18-macos-x64 "Torba-${VERSION}-mac-x64"
    ;;
  Linux-*)
    build_target node18-linux-x64 "Torba-${VERSION}-linux-x64"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    build_target node18-win-x64 "Torba-${VERSION}-win.exe"
    ;;
  *)
    echo "Nieznana platforma. Buduj ręcznie: npx pkg package.json --targets node18-macos-arm64 --output dist/desktop/Torba"
    exit 1
    ;;
esac

cp "$ROOT/INSTALL.txt" "$DIST/"
echo "Gotowe w: $DIST"
