# Web / cross-platform port — plan

Goal: one web UI + local backend packaged for Windows and Linux (macOS optional); the native SwiftUI app stays. All user data is stored **locally** on the device; backups use the shared format in [backup-format.md](backup-format.md). Two-way sync is out of scope.

## Architecture

- **`core/` (TypeScript, no I/O)** — domain logic ported from `macos/LibreWalletDomain`, `LibreWalletImport`, `LibreWalletPricing`. Pure functions, tested against the same samples as Swift (`docs/backup-samples/`).
- **Local backend (Node)** — SQLite file in the per-user data dir (`%APPDATA%\LibreWallet`, `~/.local/share/librewallet`, `~/Library/Application Support/LibreWallet`), bound to `127.0.0.1` only. Proxies quotes/FX (Yahoo, Stooq, NBP) and writes rotating JSON backups next to the DB.
- **Web UI** — replaces `app.js` (5.6k lines, state in browser `localStorage`, which is lost when the origin/port changes or browser data is cleared).
- **Packaging** — Tauri shell around the backend (Electron is the fallback; the old `pkg` build is legacy).

## Feature inventory (native 0.5.x vs current `app.js`)

| Area | Native (Swift) | Web `app.js` 1.x | Port work |
|---|---|---|---|
| Portfolio calc, positions, cash, daily timeline | `PortfolioCalculator` | `calculateScope`, `buildDailyTimeline` (own impl.) | Port Swift version (fixes from 0.5.7/0.5.9 are not in web) |
| Period returns | `PeriodReturns` | `positionPeriodReturn` | Port |
| FX | `NBPExchangeRateService`, overrides | NBP partly, static `DEFAULT_FX` | Port |
| Quotes / history | `PricingService`, `SymbolResolver`, symbol mappings | Yahoo + Stooq in `server.js`, no mappings | Port resolver + mappings |
| Bonds (pricing, maturity calendar, presets) | `BondPricing`, `BondMaturity`, `BondPresets` | present (own impl.) | Port Swift version |
| Tax report (PIT-38 style, CSV) | `TaxReport` | **missing** | New |
| Cashflow report | `CashflowReport` | basic | Port |
| Price alerts + allocation drift | `PriceAlertService` | **missing** | New (desktop notifications via Tauri) |
| Rebalancing / targets | `RebalanceView` | `renderRebalance` | Port |
| Import XTB ZIP/XLSX | `XTBZipImporter` (content-based dedupe) | `handleFiles` (older parsing) | Port |
| Import IBKR | `IBKRImporter` | **missing** | New |
| Import universal CSV + template | `UniversalImporter` | present | Port + share templates |
| CSV export | `CSVExport` | `exportTransactions` | Port |
| Backup JSON | v2 (`Backup.swift`) | different shape, `localStorage` blob | Implement v2 + read legacy web backup |
| Agent feed / local integration API | `AgentFeed`, `LocalIntegrationAPI` | minimal `/api/holdings` | Decide later |
| Two-way folder sync | `SyncEngine` | – | Out of scope |
| i18n PL/EN | `L10n` | `i18n.js` | Reuse `i18n.js` strings |

## Milestones

1. **Done:** backup format v2 + samples; native backup includes bonds and alerts.
2. `core/` skeleton + backup v2 reader/writer + tests against `docs/backup-samples/`.
3. Backend with SQLite in the user data dir, auto JSON backups, quote/FX proxy.
4. Port calculator, returns, bonds, tax, cashflow, rebalance (test-driven against Swift test cases).
5. Importers (XTB, universal CSV, IBKR).
6. UI (dashboard, positions, transactions, allocation, tax, alerts, settings).
7. Tauri packaging for Windows/Linux; CI builds.
