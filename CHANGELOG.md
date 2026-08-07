# Changelog

Wszystkie istotne zmiany w projekcie są dokumentowane w tym pliku.

Format oparty o [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/).
Wersje natywnej aplikacji macOS (`macos/`) zaczynają się od **0.1.0** i są niezależne od starszych release’ów Electron/web (`1.x`).

## [0.1.3] — 2026-08-07

### Naprawione (native macOS)

- Import XTB czyta arkusz Cash Operations (wcześniej brał tylko Closed Positions).
- Wycena walorów w obcej walucie (np. NVDA.US na koncie PLN) przez kursy NBP.
- Zysk z obligacji (narosłe odsetki) oraz feedback po dodaniu obligacji.
- Widok portfela pokazuje pozycje; przywrócona zakładka Pozycje.

## [0.1.2] — 2026-07-22

### Naprawione (native macOS)

- Import XTB działa bez wcześniej utworzonego portfela — portfele tworzą się automatycznie z importu.

## [0.1.1] — 2026-07-22

### Naprawione (native macOS)

- Instalator `.pkg` ustawia poprawne uprawnienia wykonywania — aplikacja uruchamia się po instalacji.
- Preinstall usuwa stare ślady instalacji (`LibreWallet.app`, folder `librewallet` w Aplikacjach).

## [0.1.0] — 2026-07-21

### Dodane (native macOS)

- Natywna aplikacja SwiftUI z dashboardem, pozycjami, importem XTB i wykresami.
- Wersjonowanie (semver + build) oraz ekran „O programie”.
- Sprawdzanie aktualizacji przez GitHub Releases (bez autoinstalacji / bez Apple Developer ID).
- Strona pobierania z instrukcją Gatekeeper oraz skrypt/CI publikujący `LibreWallet.zip`.

## 1.1.16

- **Pozycje (Holdings):** widoczny przycisk „Usuń” obok pola ilości.

## 1.1.15

- **Pozycje (Holdings):** edycja wolumenu/ilości oraz możliwość usunięcia pozycji.

## 1.1.14

- **GPW/Yahoo:** ticker `EEE` jest ignorowany (nie wpływa na wyceny/historię), bo Yahoo potrafi zwracać wartości rozjechane względem rachunku.

## 1.1.12

- **macOS:** naprawiona instalacja `.pkg` — instalator nie nadpisywał uszkodzonej aplikacji (upgrade/relocation zostawiał tylko plik `default-locale`, ~3 bajty). Teraz preinstall usuwa starą aplikację, a paczka wymusza pełną podmianę bundle.

## 1.1.11

- Opisz co nowego w wersji 1.1.11
- ...
fixed installation error


## 1.1.10

- Opisz co nowego w wersji 1.1.10
- ...
fixed instllation issue


## 1.1.9

- **macOS:** naprawione uprawnienia w instalatorze `.pkg` — aplikacja nie pokazywała się jako „zero bajtów” i była niedostępna po instalacji (katalogi miały tryb `700` zamiast `755`).

## 1.1.8

- **Auto-odświeżanie cen** — nowy panel w zakładce „Import i ustawienia” pozwala ustawić automatyczne odświeżanie cen co 15 min / 30 min / 1 h / 2 h / 6 h (domyślnie 1 h). Po każdym cyklu ceny i historia dzienna aktualizują się automatycznie.

## 1.1.7

- **`GET /api/holdings`** — returns active portfolio instruments (symbols, names, markets) from an in-memory cache for local integrations (e.g. Inwestor / OpenClaw).
- **`POST /api/holdings`** — accepts `{ portfolios, transactions }` from the frontend after each save; extracts positions with quantity > 0.
- Frontend syncs holdings to the local server on boot and after every `saveState()` (debounced 300 ms, silent fail if server unreachable).
- Drag-and-drop to move portfolios between groups in the sidebar.

## 1.1.6

- Portfolio and group creation in the import modal.
