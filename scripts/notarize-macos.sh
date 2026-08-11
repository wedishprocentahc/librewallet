#!/usr/bin/env bash
# Sign + notarize LibreWallet.app and/or .pkg for Gatekeeper.
#
# Prerequisites:
#   1. Apple Developer Program
#   2. Certificates in Keychain:
#        - Developer ID Application
#        - Developer ID Installer  (for .pkg)
#   3. Notary credentials stored once:
#        xcrun notarytool store-credentials "librewallet-notary" \
#          --apple-id YOU@EMAIL --team-id TEAMID --password APP_SPECIFIC_PASSWORD
#
# Usage:
#   ./scripts/notarize-macos.sh path/to/LibreWallet.app
#   ./scripts/notarize-macos.sh path/to/LibreWallet-0.5.0-mac-arm64.pkg
#   ./scripts/notarize-macos.sh path/to/LibreWallet.app path/to/LibreWallet-….pkg
#
# Env overrides:
#   LW_NOTARY_PROFILE   keychain profile (default: librewallet-notary)
#   LW_SIGN_IDENTITY    Application identity (auto-detected if empty)
#   LW_INSTALLER_IDENTITY  Installer identity for pkg (auto-detected if empty)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${LW_NOTARY_PROFILE:-librewallet-notary}"

if [[ $# -lt 1 ]]; then
  sed -n '2,24p' "$0"
  exit 1
fi

find_identity() {
  local needle="$1"
  security find-identity -v -p codesigning 2>/dev/null \
    | awk -v n="$needle" 'index($0, n) && $0 !~ /CSSMERR/ { print $2; exit }'
}

APP_IDENTITY="${LW_SIGN_IDENTITY:-$(find_identity "Developer ID Application")}"
INSTALLER_IDENTITY="${LW_INSTALLER_IDENTITY:-$(find_identity "Developer ID Installer")}"

if [[ -z "${APP_IDENTITY}" ]]; then
  echo "Brak certyfikatu „Developer ID Application” w Keychain." >&2
  echo "Utwórz go w https://developer.apple.com/account/resources/certificates/list" >&2
  echo "albo ustaw LW_SIGN_IDENTITY=\"Developer ID Application: Imię Nazwisko (TEAMID)\"." >&2
  exit 1
fi

echo "==> Application identity: ${APP_IDENTITY}"
if [[ -n "${INSTALLER_IDENTITY}" ]]; then
  echo "==> Installer identity:   ${INSTALLER_IDENTITY}"
else
  echo "==> Installer identity:   (brak — .pkg nie zostanie podpisany Installerem)"
fi

notarize_file() {
  local path="$1"
  echo "==> notarytool submit $(basename "$path")"
  xcrun notarytool submit "$path" --keychain-profile "$PROFILE" --wait
  echo "==> stapler staple $(basename "$path")"
  xcrun stapler staple "$path"
  xcrun stapler validate "$path"
}

sign_app() {
  local app="$1"
  echo "==> codesign app: $(basename "$app")"
  # Deep sign nested frameworks/binaries, then the bundle.
  codesign --force --deep --options runtime --timestamp \
    --sign "$APP_IDENTITY" \
    "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
}

sign_pkg() {
  local pkg="$1"
  if [[ -z "${INSTALLER_IDENTITY}" ]]; then
    echo "Pomijam podpis .pkg (brak Developer ID Installer)." >&2
    return 0
  fi
  local signed="${pkg%.pkg}-signed.pkg"
  echo "==> productsign pkg: $(basename "$pkg")"
  productsign --sign "$INSTALLER_IDENTITY" "$pkg" "$signed"
  mv "$signed" "$pkg"
  pkgutil --check-signature "$pkg" || true
}

for path in "$@"; do
  if [[ ! -e "$path" ]]; then
    echo "Nie znaleziono: $path" >&2
    exit 1
  fi

  case "$path" in
    *.app)
      sign_app "$path"
      # Apple wants a zip for app notarization submission.
      TMP_ZIP="$(mktemp -t LibreWallet-notarize).zip"
      ditto -c -k --keepParent "$path" "$TMP_ZIP"
      notarize_file "$TMP_ZIP"
      # Staple the app (stapler works on the app after zip was notarized with same binary).
      # Re-staple app after successful zip notarization:
      xcrun stapler staple "$path" || {
        echo "Uwaga: stapler na .app może wymagać ponownego submitu samego .app w zip." >&2
      }
      rm -f "$TMP_ZIP"
      echo "==> spctl assess"
      spctl --assess --type execute -vv "$path" || true
      ;;
    *.pkg)
      sign_pkg "$path"
      notarize_file "$path"
      spctl --assess --type install -vv "$path" || true
      ;;
    *)
      echo "Nieobsługiwany plik (oczekiwano .app lub .pkg): $path" >&2
      exit 1
      ;;
  esac
done

echo "==> Done."
