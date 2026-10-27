import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { diskAssets } from "../server/assets.ts";
import { createApp } from "../server/http.ts";
import { Service } from "../server/service.ts";
import { Store } from "../server/store.ts";
import type { FetchFn } from "../core/pricing.ts";
import { makeXlsx, makeZip } from "./zipwriter.ts";

const dir = mkdtempSync(join(tmpdir(), "lw-http-"));
const uiDir = join(dir, "ui");
let base = "";
let server: ReturnType<typeof createApp>;
let service: Service;

// Offline network: Yahoo + NBP answered locally.
const fakeFetch: FetchFn = async (url) => {
  const json = url.includes("tables/A")
    ? [{ rates: [{ code: "USD", mid: 4 }] }]
    : url.includes("nbp.pl")
      ? { rates: [{ effectiveDate: "2024-01-03", mid: 4 }, { effectiveDate: "2024-06-01", mid: 4 }, { effectiveDate: "2030-01-01", mid: 4 }] }
      : { chart: { result: [{ meta: { regularMarketPrice: 200, currency: "USD", regularMarketTime: 1_700_000_000 } }] } };
  return { ok: true, status: 200, json: async () => json };
};

before(async () => {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(uiDir);
  writeFileSync(join(uiDir, "index.html"), "<h1>ok</h1>");
  service = new Service(new Store(join(dir, "data")), { version: "9.9.9", fetchFn: fakeFetch });
  server = createApp(service, { assets: diskAssets(uiDir) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); service.store.close(); rmSync(dir, { recursive: true, force: true }); });

const api = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
  const res = await fetch(base + path, {
    ...init,
    headers: { "X-LibreWallet": "1", ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.headers as Record<string, string>) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await res.text();
  return { status: res.status, text, json: () => JSON.parse(text) as any };
};

test("serves the UI and health, rejects foreign hosts and header-less writes", async () => {
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await api("/api/health")).json().version, "9.9.9");
  const status = await new Promise<number>((resolve) => {
    const r = httpRequest({ host: "127.0.0.1", port: new URL(base).port, path: "/api/health", headers: { Host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    r.end();
  });
  assert.equal(status, 403);
  const noHeader = await fetch(base + "/api/clear", { method: "POST" });
  assert.equal(noHeader.status, 403);
  assert.equal((await fetch(base + "/../../etc/passwd")).status === 200, false);
});

test("end-to-end: create portfolio, add operations, compute dashboard, refresh quotes", async () => {
  const p = (await api("/api/portfolios", { method: "POST", json: { name: "Test", baseCurrency: "USD" } })).json();
  assert.equal((await api("/api/transactions", { method: "POST", json: { portfolioId: p.id, type: "deposit", date: "2024-01-02", gross: 1000, cashDelta: 1000, currency: "USD" } })).status, 200);
  assert.equal((await api("/api/transactions", { method: "POST", json: { portfolioId: p.id, type: "buy", date: "2024-01-03", symbol: "aapl.us", quantity: 5, price: 100, gross: 500, cashDelta: -500, currency: "USD" } })).status, 200);

  const refreshed = (await api("/api/refresh/quotes", { method: "POST", json: {} })).json();
  assert.equal(refreshed.updated, 1);
  const dash = (await api(`/api/dashboard?scope=portfolio:${p.id}`)).json();
  assert.equal(dash.scope.totalValue, 1000 - 500 + 5 * 200);
  assert.ok(dash.history.length > 100);
  const pos = (await api(`/api/positions?scope=all`)).json();
  assert.equal(pos.positions[0].symbol, "AAPL.US");
  assert.equal(pos.positions[0].priceSource, "quote");
  const tx = (await api(`/api/transactions?scope=all&q=aapl`)).json();
  assert.equal(tx.total, 1);
  assert.equal((await api("/api/agent-feed")).json().positions.length, 1);
});

test("rebalance targets, bonds and alerts", async () => {
  const p = service.data.portfolios[0]!;
  await api("/api/targets", { method: "PUT", json: { scope: "all", assetType: "stock", pct: 100 } });
  const rb = (await api("/api/rebalance?scope=all")).json();
  assert.equal(rb.targets.stock, 100);
  assert.ok(rb.suggestions.length >= 1);

  const bond = (await api("/api/bonds", { method: "POST", json: { portfolioId: p.id, preset: "EDO", count: 10, date: "2024-01-01" } })).json();
  assert.ok(bond.estimatedValue > 1000);
  const held = (await api("/api/bonds")).json().held;
  assert.equal(held.length, 1);
  assert.equal((await api("/api/bonds/redeem", { method: "POST", json: { key: held[0].key, quantity: 4 } })).status, 200);
  assert.equal((await api("/api/bonds")).json().held[0].quantity, 6);

  await api("/api/alerts", { method: "POST", json: { symbol: "aapl.us", currency: "USD", targetPrice: 150, above: true } });
  const fired = (await api("/api/alerts/check", { method: "POST", json: {} })).json().fired;
  assert.equal(fired.filter((n: { kind: string }) => n.kind === "price").length, 1);
  assert.equal((await api("/api/alerts/check", { method: "POST", json: {} })).json().fired.filter((n: { kind: string }) => n.kind === "price").length, 0);
  assert.equal((await api("/api/notifications")).json().notifications.length >= 1, true);
});

test("tax report with historical FX, cashflow", async () => {
  const p = service.data.portfolios[0]!;
  await api("/api/transactions", { method: "POST", json: { portfolioId: p.id, type: "sell", date: "2024-06-01", symbol: "aapl.us", quantity: 5, price: 120, gross: 600, currency: "USD" } });
  const tax = (await api("/api/tax?year=2024&scope=all")).json();
  assert.equal(tax.summary.year, 2024);
  assert.equal(tax.summary.capitalProceeds, 600 * 4);
  assert.equal(tax.summary.capitalCosts, 500 * 4);
  assert.ok((await api("/api/tax.csv?year=2024")).text.includes("# sells"));
  const cf = (await api("/api/cashflow?scope=all&year=2024")).json();
  assert.ok(cf.events.length >= 1);
});

test("import preview → commit, backup export → restore, clear", async () => {
  const cash = makeXlsx("Cash Operations", [["Type", "Instrument", "Ticker", "Category", "Time", "Amount", "ID", "Comment", "Product"], ["Deposit", "", "", "", 45000.5, 2000, "id-1", "x", ""]]);
  const zip = makeZip({ "777/PLN_777_x.xlsx": cash });
  const prev = (await api("/api/import/preview", { method: "POST", body: zip, headers: { "X-Filename": "xtb.zip", "Content-Type": "application/octet-stream" } })).json();
  assert.equal(prev.newCount, 1);
  const done = (await api("/api/import/commit", { method: "POST", json: { token: prev.token } })).json();
  assert.equal(done.saved, 1);
  assert.equal((await api("/api/import/commit", { method: "POST", json: { token: prev.token } })).status, 404);

  const backup = (await api("/api/backup")).text;
  const counts = service.data.transactions.length;
  await api("/api/clear", { method: "POST", json: {} });
  assert.equal(service.data.transactions.length, 0);
  const restored = (await api("/api/backup/restore", { method: "POST", body: backup, headers: { "Content-Type": "application/json" } })).json();
  assert.equal(restored.transactions, counts);
  assert.equal((await api("/api/backup/restore", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).status, 400);
});

test("ticker mapping: test a Yahoo symbol without saving, resolution flag on positions", async () => {
  const t = (await api("/api/quotes/test", { method: "POST", json: { symbol: "AAPL.US", providerSymbol: "AAPL", currency: "USD" } })).json();
  assert.equal(t.ok, true);
  assert.equal(t.price, 200);
  assert.deepEqual(service.settings.symbolMappings, []);
  const bad = (await api("/api/quotes/test", { method: "POST", json: { symbol: "BARE", providerSymbol: "", currency: "PLN" } })).json();
  assert.equal(bad.ok, false);
  await api("/api/settings", { method: "PUT", json: { symbolMappings: [{ id: "bare", provider: "yahoo", providerSymbol: "bare.wa", note: "x" }] } });
  assert.deepEqual(service.settings.symbolMappings, [{ id: "BARE", provider: "yahoo", providerSymbol: "BARE.WA", note: "x" }]);
});
