#!/usr/bin/env bash
# Build LibreWallet.pkg installer from a built LibreWallet.app (native SwiftUI).
#
# Usage:
#   ./scripts/build-macos-native-pkg.sh <path-to-LibreWallet.app> [arm64|x64]
#
# Output:
#   dist/macos/LibreWallet-<version>-mac-<arch>.pkg

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS="$ROOT/macos"
APP_SRC="${1:?Użycie: build-macos-native-pkg.sh <LibreWallet.app> [arm64|x64]}"
ARCH="${2:-arm64}"

case "$ARCH" in
  arm64) HOST_ARCH="arm64" ;;
  x64) HOST_ARCH="x86_64" ;;
  *)
    echo "Nieznana architektura: $ARCH (arm64 lub x64)" >&2
    exit 1
    ;;
esac

if [[ ! -d "$APP_SRC" ]]; then
  echo "Brak aplikacji: $APP_SRC" >&2
  exit 1
fi

if ! command -v pkgbuild >/dev/null 2>&1 || ! command -v productbuild >/dev/null 2>&1; then
  echo "Wymagane narzędzia Xcode: pkgbuild i productbuild" >&2
  exit 1
fi

VERSION="$(ruby -ryaml -e 'puts YAML.load_file(ARGV[0]).dig("settings","base","MARKETING_VERSION")' "$MACOS/project.yml")"
DIST="$ROOT/dist/macos"
PKG_OUT="$DIST/LibreWallet-${VERSION}-mac-${ARCH}.pkg"
WORK="$ROOT/dist/pkg-work-native-${ARCH}"

rm -rf "$WORK"
mkdir -p "$WORK/Applications"
export COPYFILE_DISABLE=1
ditto "$APP_SRC" "$WORK/Applications/LibreWallet.app"
xattr -cr "$WORK/Applications/LibreWallet.app" 2>/dev/null || true
find "$WORK/Applications/LibreWallet.app" -type d -exec chmod 755 {} \;
find "$WORK/Applications/LibreWallet.app" -type f -exec chmod 644 {} \;
chmod 755 "$WORK/Applications/LibreWallet.app/Contents/MacOS/"*

SCRIPTS="$WORK/scripts"
mkdir -p "$SCRIPTS"

cat > "$SCRIPTS/preinstall" <<'EOF'
#!/bin/bash
rm -rf "/Applications/LibreWallet.app"
rm -rf "/Applications/librewallet"
rm -rf "/Applications/LibreWallet"
exit 0
EOF
chmod +x "$SCRIPTS/preinstall"

cat > "$SCRIPTS/postinstall" <<'EOF'
#!/bin/bash
APP="/Applications/LibreWallet.app"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
chmod 755 "$APP/Contents/MacOS"/*
exit 0
EOF
chmod +x "$SCRIPTS/postinstall"

COMPONENT_PLIST="$WORK/components.plist"
cat > "$COMPONENT_PLIST" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
  <dict>
    <key>BundleHasStrictIdentifier</key>
    <true/>
    <key>BundleIsRelocatable</key>
    <false/>
    <key>BundleIsVersionChecked</key>
    <true/>
    <key>BundleOverwriteAction</key>
    <string>replace</string>
    <key>RootRelativeBundlePath</key>
    <string>LibreWallet.app</string>
  </dict>
</array>
</plist>
EOF

COMPONENT="$WORK/LibreWallet-component.pkg"
pkgbuild \
  --root "$WORK/Applications" \
  --component-plist "$COMPONENT_PLIST" \
  --identifier "com.librewallet.app" \
  --version "$VERSION" \
  --install-location "/Applications" \
  --ownership recommended \
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
  <p><strong>PL:</strong> Natywna aplikacja macOS. Dane zostają na Twoim komputerze.</p>
  <p><strong>EN:</strong> Native macOS app. Your data stays on your computer.</p>
  <p>Przy pierwszym uruchomieniu może być potrzebne: prawy przycisk → Otwórz.</p>
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

mkdir -p "$DIST"
productbuild \
  --distribution "$WORK/Distribution.xml" \
  --package-path "$WORK" \
  "$PKG_OUT"

rm -rf "$WORK"
echo "Instalator: $PKG_OUT"
