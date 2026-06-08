#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -pe "require('$ROOT/package.json').version")"
ARCH="${1:?Użycie: build-macos-pkg.sh arm64|x64}"

case "$ARCH" in
  arm64) HOST_ARCH="arm64" ;;
  x64) HOST_ARCH="x86_64" ;;
  *)
    echo "Nieznana architektura: $ARCH (arm64 lub x64)"
    exit 1
    ;;
esac

DIST="$ROOT/dist/desktop"
BINARY="$DIST/LibreWallet-${VERSION}-mac-${ARCH}"
PKG_OUT="$DIST/LibreWallet-${VERSION}-mac-${ARCH}.pkg"
WORK="$ROOT/dist/pkg-work-${ARCH}"

if [ ! -f "$BINARY" ]; then
  echo "Brak binarki: $BINARY"
  exit 1
fi

if ! command -v pkgbuild >/dev/null 2>&1 || ! command -v productbuild >/dev/null 2>&1; then
  echo "Wymagane narzędzia Xcode: pkgbuild i productbuild"
  exit 1
fi

rm -rf "$WORK"
APP_PATH="$WORK/Applications/LibreWallet.app"
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

cp "$BINARY" "$APP_PATH/Contents/MacOS/LibreWallet"
chmod +x "$APP_PATH/Contents/MacOS/LibreWallet"

cat > "$APP_PATH/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>LibreWallet</string>
  <key>CFBundleIdentifier</key>
  <string>com.librewallet.app</string>
  <key>CFBundleName</key>
  <string>LibreWallet</string>
  <key>CFBundleDisplayName</key>
  <string>LibreWallet</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF

SCRIPTS="$WORK/scripts"
mkdir -p "$SCRIPTS"
cat > "$SCRIPTS/postinstall" <<'EOF'
#!/bin/bash
open -a "/Applications/LibreWallet.app" || true
exit 0
EOF
chmod +x "$SCRIPTS/postinstall"

COMPONENT="$WORK/LibreWallet-component.pkg"
pkgbuild \
  --root "$WORK/Applications" \
  --identifier "com.librewallet.app" \
  --version "$VERSION" \
  --install-location "/Applications" \
  --scripts "$SCRIPTS" \
  "$COMPONENT"

cat > "$WORK/Distribution.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
  <title>LibreWallet</title>
  <options customize="never" require-scripts="false" hostArchitectures="${HOST_ARCH}"/>
  <welcome file="welcome.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <choices-outline>
    <line choice="default">
      <line choice="com.librewallet.app"/>
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="com.librewallet.app" visible="false">
    <pkg-ref id="com.librewallet.app"/>
  </choice>
  <pkg-ref id="com.librewallet.app" version="${VERSION}">LibreWallet-component.pkg</pkg-ref>
</installer-gui-script>
EOF

cat > "$WORK/welcome.html" <<EOF
<!DOCTYPE html>
<html><body>
  <h1>LibreWallet</h1>
  <p>Lokalny tracker portfela inwestycyjnego. Dane zostają na Twoim komputerze.</p>
  <p>Instalator skopiuje LibreWallet do folderu Aplikacje.</p>
</body></html>
EOF

cat > "$WORK/conclusion.html" <<EOF
<!DOCTYPE html>
<html><body>
  <h1>Gotowe</h1>
  <p>LibreWallet został zainstalowany w folderze Aplikacje i uruchomi się automatycznie.</p>
  <p>Aby otworzyć ponownie: Finder → Aplikacje → LibreWallet.</p>
</body></html>
EOF

productbuild \
  --distribution "$WORK/Distribution.xml" \
  --package-path "$WORK" \
  "$PKG_OUT"

rm -rf "$WORK"
echo "Instalator: $PKG_OUT"
