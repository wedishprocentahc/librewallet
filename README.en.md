# LibreWallet — local portfolio tracker

**Language:** [Polski](README.pl.md) · [English](README.en.md)

The app runs **only on your computer**. Portfolio data stays in your browser (`localStorage`) — nothing is sent to a third-party server. Live prices use a local proxy (Yahoo Finance) on your machine.

## Download

Get the latest build from **[Releases](https://github.com/wedishprocentahc/librewallet/releases).

| System | File |
|--------|------|
| macOS (Apple Silicon — M1/M2/M3/M4) | `LibreWallet-1.1.1-mac-arm64.pkg` |
| macOS (Intel) | `LibreWallet-1.1.1-mac-x64.pkg` |
| Windows | `LibreWallet-1.1.1-win.exe` |

---

## Install on Mac (Apple Silicon) — step by step

This guide is for Macs with **Apple Silicon** (M1, M2, M3, M4). No technical background required.

### Step 0 — check you have the right Mac

1. Click the **** menu (top-left).
2. Choose **About This Mac**.
3. Under **Chip**, you should see *Apple M1*, *Apple M2*, *Apple M3*, or *Apple M4*.
4. If you see **Intel**, download `mac-x64.pkg`, not `mac-arm64.pkg`.

### Step 1 — download the installer

1. Go to: https://github.com/wedishprocentahc/librewallet/releases
2. Open the latest release (e.g. **v1.1.1**).
3. Under **Assets**, download **`LibreWallet-1.1.1-mac-arm64.pkg`**.
4. The file goes to your **Downloads** folder.

### Step 2 — run the installer (macOS may block the file)

LibreWallet is not from the App Store and is not signed by Apple — **macOS often refuses a normal double-click on first launch**. That is expected. Do this:

**Method A — right-click and “Open” (easiest):**

1. Open **Finder** → **Downloads**.
2. Find `LibreWallet-…-mac-arm64.pkg`.
3. **Right-click** the file (not left-click).
4. Choose **Open** from the menu.
5. In the warning dialog, click **Open** again (not “Cancel”).

**Method B — if it still does not work, use System Settings:**

1. Try double-clicking the `.pkg` — macOS will say it cannot be opened.
2. Open **System Settings** (gear icon in the Dock or from the  menu).
3. Go to **Privacy & Security**.
4. Scroll down to the **Security** section.
5. You should see a message about LibreWallet being blocked — click **Open Anyway**.
6. Enter your Mac administrator password if prompted.
7. Go back to **Downloads** and run the installer again (double-click or right-click → Open).

### Step 3 — complete the installer

1. The macOS installer opens.
2. Click **Continue** through the steps.
3. At the end, click **Install** and enter your Mac password if asked.
4. Wait until you see **The installation was successful**.

### Step 4 — choose language

1. After install, a small dialog appears: **Polski** or **English**.
2. Pick your language — you can change it later in the app (**Import & settings → Language**).

### Step 5 — first launch

1. LibreWallet is installed to **Applications**.
2. It should launch automatically and open your browser at `http://127.0.0.1:8787`.
3. If macOS **blocks the app itself** (not the installer, but LibreWallet in Applications):
   - Open **Finder** → **Applications** → **LibreWallet**.
   - **Right-click** → **Open** → click **Open** in the dialog.
   - Or: **System Settings** → **Privacy & Security** → **Open Anyway** (same as step 2).

### Step 6 — done

- The app runs in your browser (Safari, Chrome, or Firefox).
- Data stays **only on your computer**.
- Backup: **Import & settings → Backup** (JSON file).

---

## Windows (short)

1. Download `LibreWallet-1.1.1-win.exe` from [Releases](https://github.com/wedishprocentahc/librewallet/releases).
2. Double-click to run — your browser will open.

More details in **`INSTALL.txt`**.

---

## Development

```bash
npm start              # run from source
npm run build:desktop  # build desktop installers
```

Build output: `dist/desktop/`.

---

## Features

- portfolios and XTB account groups (PLN/EUR/USD),
- XTB import from CSV/XLSX/ZIP,
- live prices and price history,
- charts, benchmarks, trade markers,
- bonds, JSON backup,
- rebalancing and allocation,
- Polish and English UI.

## Privacy

- Trades and portfolios: **localStorage** in your browser.
- The local server only sends ticker symbols outward (for prices).
- Back up JSON via **Import & settings → Backup**.

## Requirements

- macOS 11+ or Windows 10+.
- Browser: Chrome, Firefox, Safari, or Edge.

## XTB import

Use the `Cash Operations` sheet. Best practice: import the full ZIP with PLN + EUR + USD accounts at once.
