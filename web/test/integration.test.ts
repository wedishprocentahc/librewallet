import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentFeed, formatInstrumentSymbol, holdingsResponse, inferMarket, portfolioResponse } from "../core/integration.ts";
import { portfolio, quote, tx } from "./helpers.ts";

test("market inference and symbol formatting", () => {
  assert.equal(inferMarket("PKN.PL"), "GPW");
  assert.equal(formatInstrumentSymbol("PKN.WA", "GPW"), "PKN.PL");
  assert.equal(inferMarket("AAPL.US"), "NASDAQ");
  assert.equal(inferMarket("VUSA.UK"), "LSE");
  assert.equal(inferMarket("BARE"), "");
});

test("holdings lists only open, non-ignored positions", () => {
  const p = portfolio({ name: "XTB" });
  const txs = [
    tx({ typeRaw: "buy", portfolioId: p.id, symbol: "AAPL.US", quantity: 2, gross: 200 }),
    tx({ typeRaw: "buy", portfolioId: p.id, symbol: "OLD.US", quantity: 1, gross: 10 }),
    tx({ typeRaw: "sell", portfolioId: p.id, symbol: "OLD.US", quantity: 1, gross: 12 }),
    tx({ typeRaw: "buy", portfolioId: p.id, symbol: "EEE.PL", quantity: 1, gross: 10 }),
  ];
  const h = holdingsResponse([p], txs);
  assert.deepEqual(h.instruments.map((i) => i.symbol), ["AAPL.US"]);
  assert.equal(portfolioResponse([], [], [], { PLN: 1 }).status, "no_data");
});

test("agent feed reports weights, stale and missing quotes", () => {
  const p = portfolio({ name: "XTB", baseCurrency: "USD" });
  const txs = [
    tx({ typeRaw: "buy", portfolioId: p.id, symbol: "AAA.US", quantity: 1, price: 100, gross: 100, currency: "USD" }),
    tx({ typeRaw: "buy", portfolioId: p.id, symbol: "BBB.US", quantity: 1, price: 100, gross: 100, currency: "USD" }),
  ];
  const old = quote("AAA.US", "USD", 150);
  old.asOf = new Date(Date.now() - 48 * 3600_000);
  const feed = buildAgentFeed({ portfolios: [p], transactions: txs, quotes: [old], rates: { PLN: 1, USD: 4 }, appVersion: "t" });
  assert.equal(feed.schemaVersion, 1);
  assert.deepEqual(feed.staleSymbols, ["AAA.US"]);
  assert.deepEqual(feed.missingQuotes, ["BBB.US"]);
  assert.equal(feed.positions.length, 2);
  assert.equal(feed.totalValue, 1000); // (150 + 100 at cost) USD × 4
  assert.equal((feed.positions[0] as { weightPct: number }).weightPct, 60);
});
