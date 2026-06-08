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

ICON_SRC="$ROOT/assets/app-icon.png"
if [ -f "$ICON_SRC" ] && command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
  ICONSET="$WORK/AppIcon.iconset"
  rm -rf "$ICONSET"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP_PATH/Contents/Resources/AppIcon.icns"
  rm -rf "$ICONSET"
fi

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
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
</dict>
</plist>
EOF

SCRIPTS="$WORK/scripts"
mkdir -p "$SCRIPTS"
cat > "$SCRIPTS/postinstall" <<'EOF'
#!/bin/bash
RESOURCES="/Applications/LibreWallet.app/Contents/Resources"
mkdir -p "$RESOURCES"
LANG_CHOICE=$(osascript -e 'display dialog "Choose language / Wybierz język:" buttons {"Polski", "English"} default button "Polski" with title "LibreWallet"' -e 'button returned of result' 2>/dev/null || echo "Polski")
if [ "$LANG_CHOICE" = "English" ]; then
  echo "en" > "$RESOURCES/default-locale"
else
  echo "pl" > "$RESOURCES/default-locale"
fi
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
  <p><strong>PL:</strong> Lokalny tracker portfela. Dane zostają na Twoim komputerze.</p>
  <p><strong>EN:</strong> Local portfolio tracker. Your data stays on your computer.</p>
  <p>Po instalacji wybierzesz język / You will choose the language after install.</p>
</body></html>
EOF

cat > "$WORK/conclusion.html" <<EOF
<!DOCTYPE html>
<html><body>
  <h1>Gotowe / Done</h1>
  <p>LibreWallet trafi do folderu Aplikacje i uruchomi się automatycznie.</p>
  <p>LibreWallet will be installed to Applications and launch automatically.</p>
</body></html>
EOF

productbuild \
  --distribution "$WORK/Distribution.xml" \
  --package-path "$WORK" \
  "$PKG_OUT"

rm -rf "$WORK"
echo "Instalator: $PKG_OUT"
