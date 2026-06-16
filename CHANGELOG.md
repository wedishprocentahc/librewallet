# Changelog

## 1.1.7

- **`GET /api/holdings`** — returns active portfolio instruments (symbols, names, markets) from an in-memory cache for local integrations (e.g. Inwestor / OpenClaw).
- **`POST /api/holdings`** — accepts `{ portfolios, transactions }` from the frontend after each save; extracts positions with quantity > 0.
- Frontend syncs holdings to the local server on boot and after every `saveState()` (debounced 300 ms, silent fail if server unreachable).
- Drag-and-drop to move portfolios between groups in the sidebar.

## 1.1.6

- Portfolio and group creation in the import modal.
