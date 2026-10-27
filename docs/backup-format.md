# LibreWallet backup format (JSON)

Shared by the native macOS app and the web/desktop (Windows, Linux) app. Reference implementation: `macos/LibreWalletDomain/Backup.swift`. Sample files: `docs/backup-samples/` (both apps' tests should load them).

## Envelope

| Field | Type | Notes |
|---|---|---|
| `format` | string | always `"librewallet-backup"` |
| `version` | int | `2` is current. Readers reject versions newer than they know. |
| `exportedAt` | string | ISO 8601 UTC, e.g. `2026-10-01T09:00:00Z` (no fractional seconds) |
| `groups` | array | portfolio groups |
| `portfolios` | array | |
| `transactions` | array | |
| `targets` | array | allocation targets |
| `quotes` | array | last known prices |
| `bonds` | array | **v2**; absent in v1 files |
| `alerts` | array | **v2**; absent in v1 files |

All `id` fields are UUID strings. Dates are ISO 8601 UTC. Writers should sort keys and pretty-print.

## Records

- **group**: `id`, `name`, `colorHex`, `createdAt`
- **portfolio**: `id`, `groupId?`, `name`, `baseCurrency`, `colorHex`, `kindRaw` (`account` | `manual`), `createdAt`
- **transaction**: `id`, `portfolioId?`, `date`, `typeRaw` (`buy` `sell` `deposit` `withdrawal` `transfer` `fee` `tax` `dividend` `interest` `other`), `symbol?`, `name?`, `quantity?`, `price?`, `gross`, `fee`, `currency`, `cashDelta?`, `externalId?`, `notes?`, `source?`, `assetType?`
- **target**: `id`, `portfolioId?`, `assetType`, `targetPct`, `createdAt`
- **quote**: `id`, `symbol`, `currency`, `price`, `asOf`
- **bond** (v2): `id`, `portfolioId?`, `symbol`, `currency`, `termMonths`, `firstYearRate`, `margin`, `indexation` (`fixed` | `cpi` | `nbp`), `capitalization`, `earlyRedemptionFee`
- **alert** (v2): `id`, `symbol`, `currency`, `targetPrice`, `above`, `enabled`, `lastTriggeredAt?`

`?` = optional / may be `null` or missing. Unknown extra fields must be ignored, not rejected.

## Compatibility rules

- v1 files (no `bonds` / `alerts`) must still import; missing arrays mean "nothing to restore".
- A restore that wipes existing data replaces alerts only if the file contains `alerts`.
- The legacy web backup (`formatVersion: 1`, `data: {…state}`, string IDs) is a different shape; the web app converts it on import and writes v2 on export.
