# Notarizacja LibreWallet (macOS)

Cel: użytkownik otwiera apkę **dwuklikiem**, bez „prawy → Otwórz”.

## Stan na tej maszynie

`security find-identity -v -p codesigning` musi pokazać m.in.:

- `Developer ID Application: … (TEAMID)`
- `Developer ID Installer: … (TEAMID)` — do podpisu `.pkg`

Jeśli jest **0 valid identities**, najpierw certyfikaty (krok 1–2). Build/test bez podpisu działa lokalnie.

## 1. Apple Developer Program

1. Dołącz do [Apple Developer Program](https://developer.apple.com/programs/) (płatne).
2. Zanotuj **Team ID** (10 znaków): [Membership details](https://developer.apple.com/account).

## 2. Certyfikaty

W [Certificates](https://developer.apple.com/account/resources/certificates/list):

1. **Developer ID Application** — podpis `LibreWallet.app`
2. **Developer ID Installer** — podpis `.pkg`

Albo w Xcode: **Settings → Accounts → Manage Certificates → + → Developer ID Application / Installer**.

Sprawdzenie:

```bash
security find-identity -v -p codesigning
```

## 3. Hasło do notarytool (raz)

W [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords → wygeneruj hasło.

Zapisz profil w Keychain (hasło nie trafia do repo):

```bash
xcrun notarytool store-credentials "librewallet-notary" \
  --apple-id "TWOJ@EMAIL" \
  --team-id "TEAMID" \
  --password "xxxx-xxxx-xxxx-xxxx"
```

## 4. Release ze signing + notarizacją

```bash
export LW_TEAM_ID=TEAMID
# opcjonalnie, jeśli auto-detect nie złapie nazwy:
# export LW_SIGN_IDENTITY="Developer ID Application: Imię Nazwisko (TEAMID)"
# export LW_INSTALLER_IDENTITY="Developer ID Installer: Imię Nazwisko (TEAMID)"

./scripts/release-macos.sh --sign --notarize
# albo od razu na GitHub:
./scripts/release-macos.sh --sign --notarize --publish
```

Samodzielnie na gotowych artefaktach:

```bash
./scripts/notarize-macos.sh dist/macos/LibreWallet.xcarchive/Products/Applications/LibreWallet.app \
  dist/macos/LibreWallet-0.5.0-mac-arm64.pkg
```

## 5. Weryfikacja

```bash
spctl --assess --type execute -vv path/to/LibreWallet.app
spctl --assess --type install -vv path/to/LibreWallet-….pkg
codesign -dv --verbose=4 path/to/LibreWallet.app
```

Oczekiwane: `source=Notarized Developer ID` / akceptacja Gatekeeper bez prawej myszy.

## Pliki w repo

| Plik | Rola |
|------|------|
| [`scripts/release-macos.sh`](../scripts/release-macos.sh) | archive → zip → pkg → opcjonalnie `--sign` / `--notarize` / `--publish` |
| [`scripts/notarize-macos.sh`](../scripts/notarize-macos.sh) | codesign + notarytool + stapler |
| [`macos/ExportOptions-DeveloperID.plist`](../macos/ExportOptions-DeveloperID.plist) | szablon eksportu Developer ID |

## Lokalny build bez notarizacji

```bash
cd macos && xcodegen generate
xcodebuild -scheme LibreWallet -destination 'platform=macOS' test \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
./scripts/release-macos.sh   # unsigned artifacts w dist/macos/
```
