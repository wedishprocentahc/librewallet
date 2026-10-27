# Web / cross-platform port — plan

Goal: one web UI + local backend packaged for Windows and Linux (macOS optional); the native SwiftUI app stays. All user data is stored **locally** on the device; backups use the shared format in [backup-format.md](backup-format.md). Two-way sync is out of scope.

## Architecture

- **`core/` (TypeScript, no I/O)** — domain logic ported from `macos/LibreWalletDomain`, `LibreWalletImport`, `LibreWalletPricing`. Pure functions, tested against the same samples as Swift (`docs/backup-samples/`).
- **Local backend (Node)** — SQLite file in the per-user data dir (`%APPDATA%\LibreWallet`, `~/.local/share/librewallet`, `~/Library/Application Support/LibreWallet Web`), bound to `127.0.0.1` only. Proxies quotes/FX (Yahoo, NBP) and writes rotating JSON backups next to the DB. OS notifications via `server/notify.ts`.
- **Web UI** — replaces legacy `app.js` (browser `localStorage`).
- **Packaging** — single-file Node SEA binary (`web/scripts/build-sea.mjs`); CI publishes per-OS zips on `web-v*` tags. Tauri shell remains optional later.

## Feature inventory (native 0.5.x vs web)

| Area | Native (Swift) | Web | Status |
|---|---|---|---|
| Portfolio calc, positions, cash, daily timeline | `PortfolioCalculator` | `core/calculator.ts` | Done |
| Period returns | `PeriodReturns` | `core/reports.ts` | Done |
| FX | `NBPExchangeRateService`, overrides | `core/pricing.ts` + settings | Done |
| Quotes / history | `PricingService`, `SymbolResolver`, mappings | Yahoo + mappings + test quote | Done |
| Bonds | `BondPricing`, maturity calendar, presets | `core/bonds.ts` + UI (maturity override, overdue) | Done |
| Tax report | `TaxReport` | `core/reports.ts` + UI/CSV | Done |
| Cashflow | `CashflowReport` | Done | Done |
| Price alerts + allocation drift | `PriceAlertService` | Done + OS notifications | Done |
| Rebalancing / targets | `RebalanceView` | Done | Done |
| Import XTB / universal / IBKR | importers + dedupe | Done | Done |
| CSV export / backup v2 | native | Done (shared format) | Done |
| Agent feed / local API | `LocalIntegrationAPI` | `/api/holdings`, `/api/portfolio`, `/api/agent-feed` | Done |
| Update checker | `UpdateChecker` | `/api/updates/check` (`web-v*` tags) | Done |
| Two-way folder sync | `SyncEngine` | – | Out of scope |
| i18n PL/EN | `L10n` | generated `locales.js` + `strings.js` | Done |

## Milestones

1. **Done:** backup format v2 + samples; native backup includes bonds and alerts.
2. **Done:** `core/` + backup v2 reader/writer + tests against `docs/backup-samples/`.
3. **Done:** Backend with SQLite in the user data dir, auto JSON backups, quote/FX proxy.
4. **Done:** Calculator, returns, bonds, tax, cashflow, rebalance (test-driven).
5. **Done:** Importers (XTB, universal CSV, IBKR).
6. **Done:** UI (dashboard, positions, transactions, allocation, tax, alerts, settings) with Swift feature parity excluding sync.
7. **Done:** SEA packaging for Windows/Linux/macOS; CI builds. (Tauri shell optional later.)
