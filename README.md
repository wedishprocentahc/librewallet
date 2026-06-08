# LibreWallet — lokalny tracker portfela

Aplikacja działa **wyłącznie na Twoim komputerze**. Dane portfela są w przeglądarce (`localStorage`) — nic nie wysyłasz na cudzy serwer. Do pobierania cen z internetu używany jest tylko lokalny proxy (Yahoo Finance).

## Pobierz i uruchom

| System | Plik |
|--------|------|
| macOS (Apple Silicon) | `LibreWallet-1.0.0-mac-arm64.pkg` |
| macOS (Intel) | `LibreWallet-1.0.0-mac-x64.pkg` |
| Windows | `LibreWallet-1.0.0-win.exe` |

### macOS
1. Pobierz plik `.pkg` dla swojego Maca (z GitHub Releases).
2. Dwuklik — otworzy się instalator macOS.
3. Po instalacji aplikacja trafia do **Aplikacje** i uruchamia się automatycznie.
4. Przeglądarka otworzy się pod `http://127.0.0.1:8787`.

### Windows
1. Pobierz `LibreWallet-1.0.0-win.exe`.
2. Uruchom dwuklikiem — otworzy się przeglądarka.

Szczegóły w pliku **`INSTALL.txt`**.

---

## Rozwój (dla autora projektu)

```bash
npm start              # uruchomienie z kodu źródłowego
npm run build:desktop  # zbuduj instalatory do dystrybucji
```

Wynik buildu w `dist/desktop/`.

---

## Funkcje

- portfele i grupy rachunków XTB (PLN/EUR/USD),
- import XTB z CSV/XLSX/ZIP,
- live ceny i historia notowań,
- wykresy, benchmarki, znaczniki operacji,
- obligacje, kopia zapasowa JSON,
- rebalancing i alokacja.

## Prywatność

- Operacje i portfele: **localStorage** w Twojej przeglądarce.
- Serwer lokalny wysyła na zewnątrz tylko symbole instrumentów (ceny).
- Rób kopię JSON: **Import i ustawienia → Kopia zapasowa**.

## Wymagania

- macOS 11+ lub Windows 10+.
- Przeglądarka: Chrome, Firefox, Safari lub Edge.

## Import XTB

Używaj arkusza `Cash Operations`. Najlepiej importować całą paczkę ZIP z rachunkami PLN + EUR + USD naraz.
