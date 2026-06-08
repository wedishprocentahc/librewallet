# LibreWallet — lokalny tracker portfela

Aplikacja działa **wyłącznie na Twoim komputerze**. Dane portfela są w przeglądarce (`localStorage`) — nic nie wysyłasz na cudzy serwer. Do pobierania cen z internetu używany jest tylko lokalny proxy (Yahoo Finance).

## Pobierz i uruchom

| System | Plik |
|--------|------|
| macOS (Apple Silicon) | `Torba-1.0.0-mac-arm64` |
| macOS (Intel) | `Torba-1.0.0-mac-x64` |
| Windows | `Torba-1.0.0-win.exe` |

1. Pobierz plik dla swojego systemu (z GitHub Releases).
2. Uruchom dwuklikiem.
3. Otworzy się przeglądarka pod `http://127.0.0.1:8787`.
4. **Nie zamykaj** okna terminala — to lokalny serwer aplikacji.

Szczegóły w pliku **`INSTALL.txt`**.

---

## Rozwój (dla autora projektu)

```bash
npm start              # uruchomienie z kodu źródłowego
npm run build:desktop  # zbuduj binarkę do dystrybucji
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

- System operacyjny: macOS lub Windows.
- Przeglądarka: Chrome, Firefox, Safari lub Edge.

## Import XTB

Używaj arkusza `Cash Operations`. Najlepiej importować całą paczkę ZIP z rachunkami PLN + EUR + USD naraz.
