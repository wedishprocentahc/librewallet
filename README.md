# LibreWallet — local portfolio tracker

**Language:** [Polski](README.pl.md) · **English**

Track your investments on your computer. **Your data never leaves your machine** — no cloud account, no third-party server.

## Screenshots

*Fictional example data — Apple, Microsoft, Google, Amazon, NVIDIA, Tesla, Meta, and more.*

![LibreWallet — charts and performance](docs/screenshots/dashboard-charts.png)

![LibreWallet — allocation and rebalancing](docs/screenshots/allocation.png)

## Download

Get the latest version from **[Releases](https://github.com/wedishprocentahc/librewallet/releases).

| System | File |
|--------|------|
| macOS (Apple Silicon — M1/M2/M3/M4) | `LibreWallet-1.1.5-mac-arm64.pkg` |
| macOS (Intel) | `LibreWallet-*-mac-x64.pkg` (if available in Releases) |
| Windows | `LibreWallet-*-win.exe` (if available in Releases) |

---

## Install on Mac (Apple Silicon) — step by step

For Macs with **Apple Silicon** (M1, M2, M3, M4).

### Step 1 — check you have the right Mac

1. Click the **** menu (top-left).
2. Choose **About This Mac**.
3. Under **Chip**, you should see *Apple M1*, *Apple M2*, *Apple M3*, or *Apple M4*.
4. If you see **Intel**, download `mac-x64.pkg`, not `mac-arm64.pkg`.

### Step 2 — download the installer

1. Go to [Releases](https://github.com/wedishprocentahc/librewallet/releases).
2. Open the latest version (e.g. **v1.1.5**).
3. Download **`LibreWallet-1.1.5-mac-arm64.pkg`**.
4. The file goes to your **Downloads** folder.

### Step 3 — run the installer (macOS may block the file)

LibreWallet is not from the App Store — **a normal double-click often does not work the first time**. That is normal.

**Easiest way — right-click and Open:**

1. Open **Finder** → **Downloads**.
2. Find `LibreWallet-…-mac-arm64.pkg`.
3. **Right-click** the file (not left-click).
4. Choose **Open**.
5. In the warning dialog, click **Open** again.

**If it still does not work — System Settings:**

1. Try double-clicking the `.pkg` — macOS will show a block message.
2. Open **System Settings** → **Privacy & Security**.
3. Scroll down to **Security**.
4. Click **Open Anyway** next to the LibreWallet message.
5. Enter your Mac password if asked.
6. Run the installer again from **Downloads**.

### Step 4 — complete the installer

1. Click **Continue** through the steps.
2. Click **Install** and enter your Mac password if asked.
3. Wait until you see **The installation was successful**.

### Step 5 — choose language

After install, pick **Polski** or **English**. You can change this later in **Import & settings → Language**.

### Step 6 — first launch

1. LibreWallet is in **Applications** and should open your browser automatically.
2. If macOS **blocks the app** (not the installer):
   - **Finder** → **Applications** → **LibreWallet**
   - **Right-click** → **Open** → **Open**
   - Or: **System Settings** → **Privacy & Security** → **Open Anyway**

### Step 7 — done

- Use Safari, Chrome, or Firefox.
- Your portfolio data stays **only on this computer**.
- Back up anytime: **Import & settings → Backup**.

---

## Windows

1. Download `LibreWallet-*-win.exe` from [Releases](https://github.com/wedishprocentahc/librewallet/releases) (if available).
2. Double-click to run — your browser will open.

More details in **`INSTALL.en.txt`** ([Polish](INSTALL.txt)).

---

## What LibreWallet does

- track portfolios and XTB accounts (PLN, EUR, USD),
- import trades from XTB ZIP exports or a universal CSV/XLSX template,
- show live prices, charts, and benchmarks,
- manage bonds, targets, and rebalancing,
- Polish and English interface.

## Your data

Everything stays on your computer. Make regular backups in **Import & settings → Backup**. Internet is only needed to refresh stock prices.

**Import:** use the **Import** button in the app — choose XTB import (`.zip` file) or universal import (download the CSV template from the modal).

**XTB tip:** import the full ZIP export with all your accounts (PLN + EUR + USD) at once.
