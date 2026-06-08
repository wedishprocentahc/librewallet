# LibreWallet — lokalny tracker portfela

Aplikacja działa **wyłącznie na Twoim komputerze**. Dane portfela są w przeglądarce (`localStorage`) — nic nie wysyłasz na cudzy serwer. Do pobierania cen z internetu używany jest tylko lokalny proxy (Yahoo Finance).

## Pobierz

Najnowszą wersję znajdziesz na stronie **[Releases](https://github.com/wedishprocentahc/librewallet/releases)** (zakładka *Releases* w tym repozytorium).

| System | Plik |
|--------|------|
| macOS (Apple Silicon — M1/M2/M3/M4) | `LibreWallet-1.1.1-mac-arm64.pkg` |
| macOS (Intel) | `LibreWallet-1.1.1-mac-x64.pkg` |
| Windows | `LibreWallet-1.1.1-win.exe` |

---

## Instalacja na Macu (Apple Silicon) — krok po kroku

Poniższa instrukcja jest dla Maców z procesorem **Apple Silicon** (M1, M2, M3, M4). Nie wymaga znajomości programowania.

### Krok 0 — sprawdź, czy masz właściwy Mac

1. Kliknij **** (jabłko) w lewym górnym rogu ekranu.
2. Wybierz **Informacje o tym Macu**.
3. Przy pozycji **Chip** powinno być np. *Apple M1*, *Apple M2*, *Apple M3* lub *Apple M4*.
4. Jeśli widzisz **Intel**, pobierz plik `mac-x64.pkg`, nie `mac-arm64.pkg`.

### Krok 1 — pobierz instalator

1. Wejdź na: https://github.com/wedishprocentahc/librewallet/releases
2. Kliknij najnowszą wersję (np. **v1.1.1**).
3. W sekcji **Assets** pobierz plik **`LibreWallet-1.1.1-mac-arm64.pkg`**.
4. Plik trafi do folderu **Pobrane** (ang. *Downloads*).

### Krok 2 — uruchom instalator (ważne: macOS może zablokować plik)

LibreWallet nie pochodzi z App Store i nie ma podpisu Apple — **przy pierwszym uruchomieniu macOS często odmawia zwykłego dwukliku**. To normalne. Zrób tak:

**Sposób A — kliknij prawym przyciskiem i „Otwórz” (najprostszy):**

1. Otwórz **Finder** → **Pobrane**.
2. Znajdź plik `LibreWallet-…-mac-arm64.pkg`.
3. **Kliknij prawym przyciskiem** na plik (nie lewym!).
4. Wybierz **Otwórz** z menu.
5. W okienku z ostrzeżeniem kliknij ponownie **Otwórz** (nie „Anuluj”).

**Sposób B — jeśli nadal nie działa, przez Ustawienia systemowe:**

1. Spróbuj dwukliknąć plik `.pkg` lewym przyciskiem — macOS pokaże komunikat, że nie można otworzyć.
2. Otwórz **Ustawienia systemowe** (ikona koła zębatego w Docku lub z menu ).
3. Wejdź w **Prywatność i ochrona** (ang. *Privacy & Security*).
4. Przewiń w dół do sekcji **Bezpieczeństwo**.
5. Powinien być komunikat o zablokowanym pliku LibreWallet — kliknij **Otwórz mimo to** (ang. *Open Anyway*).
6. Potwierdź hasłem administratora Maca, jeśli system poprosi.
7. Wróć do **Pobrane** i ponownie uruchom instalator (dwuklik lub prawy przycisk → Otwórz).

### Krok 3 — przejdź kreator instalacji

1. Otworzy się instalator macOS.
2. Klikaj **Kontynuuj** / **Dalej**.
3. Na końcu kliknij **Zainstaluj** i podaj hasło do Maca, jeśli trzeba.
4. Poczekaj, aż pasek dojdzie do końca — pojawi się **Instalacja zakończona pomyślnie**.

### Krok 4 — wybierz język

1. Po instalacji pojawi się małe okienko: **Polski** lub **English**.
2. Wybierz język — możesz go później zmienić w aplikacji (**Import i ustawienia → Język**).

### Krok 5 — pierwsze uruchomienie aplikacji

1. LibreWallet trafia do folderu **Aplikacje**.
2. Aplikacja powinna uruchomić się sama i otworzyć przeglądarkę pod adresem `http://127.0.0.1:8787`.
3. Jeśli macOS **zablokuje samą aplikację** (nie instalator, tylko LibreWallet w Aplikacjach):
   - Otwórz **Finder** → **Aplikacje** → znajdź **LibreWallet**.
   - **Prawy przycisk** → **Otwórz** → w okienku **Otwórz** ponownie.
   - Albo: **Ustawienia systemowe** → **Prywatność i ochrona** → **Otwórz mimo to** (jak w kroku 2).

### Krok 6 — gotowe

- Aplikacja działa w przeglądarce (Safari, Chrome lub Firefox).
- Dane zostają **tylko na Twoim komputerze**.
- Kopia zapasowa: **Import i ustawienia → Kopia zapasowa** (plik JSON).

---

## Windows (skrót)

1. Pobierz `LibreWallet-1.1.1-win.exe` z [Releases](https://github.com/wedishprocentahc/librewallet/releases).
2. Uruchom dwuklikiem — otworzy się przeglądarka.

Więcej w pliku **`INSTALL.txt`**.

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
- rebalancing i alokacja,
- język polski i angielski.

## Prywatność

- Operacje i portfele: **localStorage** w Twojej przeglądarce.
- Serwer lokalny wysyła na zewnątrz tylko symbole instrumentów (ceny).
- Rób kopię JSON: **Import i ustawienia → Kopia zapasowa**.

## Wymagania

- macOS 11+ lub Windows 10+.
- Przeglądarka: Chrome, Firefox, Safari lub Edge.

## Import XTB

Używaj arkusza `Cash Operations`. Najlepiej importować całą paczkę ZIP z rachunkami PLN + EUR + USD naraz.
