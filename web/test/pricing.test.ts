import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchHistory, fetchNbpRates, fetchQuote, mergeRates, PricingError, rateToPLNOn, type FetchFn } from "../core/pricing.ts";

const respond = (body: unknown, status = 200): FetchFn => async () => ({ ok: status === 200, status, json: async () => body });
const chart = (meta: object, extra: object = {}) => ({ chart: { result: [{ meta, ...extra }] } });

test("quote: price, currency and market time from Yahoo meta", async () => {
  const q = await fetchQuote(respond(chart({ regularMarketPrice: 190.5, currency: "USD", regularMarketTime: 1700000000 })), "AAPL.US", "USD");
  assert.equal(q.price, 190.5);
  assert.equal(q.currency, "USD");
  assert.equal(q.asOf.getTime(), 1700000000_000);
  assert.equal(q.resolved.providerSymbol, "AAPL");
});

test("quote: USD listing is accepted on a PLN account (converted later with NBP)", async () => {
  const q = await fetchQuote(respond(chart({ regularMarketPrice: 120, currency: "USD" })), "NVDA.US", "PLN");
  assert.equal(q.currency, "USD");
});

test("quote: a London listing is not accepted when quoted in another currency", async () => {
  await assert.rejects(fetchQuote(respond(chart({ regularMarketPrice: 70, currency: "USD" })), "VUSA.UK", "GBP"), (e: unknown) => e instanceof PricingError && e.kind === "currencyMismatch");
});

test("quote: ignored and unresolved symbols fail before any request", async () => {
  const boom: FetchFn = async () => { throw new Error("no network expected"); };
  await assert.rejects(fetchQuote(boom, "EEE.PL", "PLN"), (e: unknown) => e instanceof PricingError && e.kind === "ignored");
  await assert.rejects(fetchQuote(boom, "BARE", "PLN"), (e: unknown) => e instanceof PricingError && e.kind === "unresolved");
});

test("quote: manual mapping resolves bare symbols", async () => {
  let url = "";
  const f: FetchFn = async (u) => { url = u; return { ok: true, status: 200, json: async () => chart({ regularMarketPrice: 10, currency: "PLN" }) }; };
  await fetchQuote(f, "BARE", "PLN", [{ id: "BARE", provider: "yahoo", providerSymbol: "BARE.WA" }]);
  assert.ok(url.includes("BARE.WA"));
});

test("quote: HTTP errors and empty data", async () => {
  await assert.rejects(fetchQuote(respond({}, 429), "AAPL.US", "USD"), (e: unknown) => e instanceof PricingError && e.kind === "http");
  await assert.rejects(fetchQuote(respond(chart({})), "AAPL.US", "USD"), (e: unknown) => e instanceof PricingError && e.kind === "noData");
});

test("history: skips null closes", async () => {
  const body = chart({ currency: "USD" }, { timestamp: [1, 2, 3], indicators: { quote: [{ close: [10, null, 12] }] } });
  const h = await fetchHistory(respond(body), "AAPL.US", "USD");
  assert.deepEqual(h.map((p) => p.close), [10, 12]);
});

test("NBP: latest table and override merging", async () => {
  const rates = await fetchNbpRates(respond([{ rates: [{ code: "usd", mid: 4 }, { code: "EUR", mid: 4.3 }] }]));
  assert.deepEqual(rates, { PLN: 1, USD: 4, EUR: 4.3 });
  assert.equal(mergeRates(rates, { USD: 3.9 }).USD, 3.9);
});

test("NBP: historical lookup walks back over weekends, falls back to latest", () => {
  const history = { USD: { "2024-06-07": 4.0 } };
  const latest = { PLN: 1, USD: 4.5 };
  assert.equal(rateToPLNOn("USD", new Date(2024, 5, 9), history, latest), 4.0); // Sunday → Friday
  assert.equal(rateToPLNOn("USD", new Date(2023, 0, 1), history, latest), 4.5);
  assert.equal(rateToPLNOn("USD", new Date(2024, 5, 9), history, latest, { USD: 3 }), 3);
  assert.equal(rateToPLNOn("IKE", new Date(), history, latest), 1);
});
