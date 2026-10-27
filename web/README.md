# LibreWallet Web

Cross-platform version of LibreWallet (Windows, Linux, macOS) with the same features as the native macOS app, except two-way sync. A local backend + browser UI: **your data stays on your device**.

- Data lives in one folder per user: `%APPDATA%\LibreWallet` (Windows), `~/.local/share/librewallet` (Linux), `~/Library/Application Support/LibreWallet Web` (macOS). Override with `LIBREWALLET_DATA_DIR`.
- The server listens on `127.0.0.1` only. The only network traffic is quotes (Yahoo) and exchange rates (NBP).
- Daily rotating JSON backups are written to `Backups/` next to the database. The backup format is shared with the native app — see [../docs/backup-format.md](../docs/backup-format.md).

## Run

Requires Node ≥ 22.18 (Node 24 recommended). No dependencies to install for running or testing.

```sh
cd web
npm start            # opens http://127.0.0.1:8788 (use --no-open to skip the browser)
npm test
```

Single-file executable (no Node needed on the target machine), built per OS:

```sh
npm ci && npm run build   # → dist/librewallet(.exe)
```

CI builds all three platforms: `.github/workflows/web-release.yml` (tag `web-vX.Y.Z` to publish).

## Layout

| Path | What |
|---|---|
| `core/` | Pure TypeScript domain logic ported from the Swift app (calculator, bonds, tax, cashflow, alerts, importers, pricing, backup v2). Tests mirror the Swift tests. |
| `server/` | Local HTTP API, SQLite store (`node:sqlite`), refresh scheduler. |
| `ui/` | Browser UI (plain ES modules, no build step). `locales.js` is generated from the native `L10n.swift` (`node scripts/gen-locales.mjs`). |
| `scripts/` | Locale generator, single-file build. |

## Feature parity with the native app

Dashboard (value/contributions chart, benchmarks, allocation, currency exposure, profit per symbol, portfolio comparison, operation markers) · Positions (grouping, period returns, ticker mapping) · Transactions (add/edit/delete/search) · Import (XTB ZIP/XLSX/CSV, universal CSV/XLSX, IBKR CSV, duplicate detection) · Rebalancing · Bonds (presets, maturity calendar, early redemption) · Cashflow · Tax report (FIFO, NBP rate on trade date, IKE/IKZE exclusion, CSV) · Price and allocation-drift alerts · Settings (language, auto refresh, FX overrides, ticker mappings, backup/restore, CSV export) · local integration API (`/api/holdings`, `/api/portfolio`, `/api/agent-feed`).

Not included: two-way folder sync, system-level notifications (the browser's Notification API is used instead).
