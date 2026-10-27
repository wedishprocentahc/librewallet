import assert from "node:assert/strict";
import { test } from "node:test";
import { allocationDriftItems, bondMaturityLots, cashflowEvents, evaluateAlerts, exportTransactionsCsv, flatRateProvider, periodReturnPct, periodStartDate, taxReport, taxReportCsv, templateCsv } from "../core/reports.ts";
import { newId, type PriceAlert } from "../core/types.ts";
import { portfolio, quote, tx } from "./helpers.ts";

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const flat = flatRateProvider({ PLN: 1 });

test("YTD starts on January 1st", () => {
  const s = periodStartDate("YTD", d(2026, 8, 11));
  assert.deepEqual([s.getFullYear(), s.getMonth(), s.getDate()], [2026, 0, 1]);
});

test("return pct from history", () => {
  const pct = periodReturnPct("AAPL", 110, { AAPL: [{ date: d(2026, 7, 1), close: 100 }] }, "1M", d(2026, 8, 1));
  near(pct ?? -1, 10);
});

test("bond maturity open lots from buy", () => {
  const p = portfolio();
  const purchase = d(2025, 1, 15);
  const buy = tx({ typeRaw: "buy", portfolioId: p.id, date: purchase, symbol: "OTS", name: "OTS", quantity: 10, price: 100, gross: 1000, notes: "Bond OTS term=3m rate=3.0% margin=0 index=fixed cap=true fee=0", source: "Bond preset", assetType: "bond" });
  const entries = bondMaturityLots([buy], [p], purchase);
  assert.equal(entries.length, 1);
  near(entries[0]!.quantity, 10, 0.001);
  assert.equal(entries[0]!.symbol, "OTS");
  assert.equal(entries[0]!.maturityDate.getMonth(), 3); // April
});

test("csv template has headers", () => {
  const text = templateCsv();
  assert.ok(text.includes("date,type,symbol"));
  assert.ok(text.includes("AAPL.US"));
});

test("tax: realized gain on sell", () => {
  const p = portfolio();
  const buy = tx({ typeRaw: "buy", portfolioId: p.id, date: d(2024, 1, 10), symbol: "AAA", quantity: 10, price: 10, gross: 100 });
  const sell = tx({ typeRaw: "sell", portfolioId: p.id, date: d(2024, 6, 10), symbol: "AAA", quantity: 10, price: 15, gross: 150 });
  const s = taxReport({ year: 2024, transactions: [buy, sell], portfolios: [p], rateOnDate: flat }).summary;
  near(s.realizedGains, 50); near(s.realizedLosses, 0); near(s.capitalProceeds, 150); near(s.capitalCosts, 100);
});

test("tax: FIFO uses prior-year buys", () => {
  const p = portfolio({ name: "Broker" });
  const buy = tx({ typeRaw: "buy", portfolioId: p.id, date: d(2023, 1, 10), symbol: "AAA", quantity: 10, price: 10, gross: 100 });
  const sell = tx({ typeRaw: "sell", portfolioId: p.id, date: d(2024, 6, 10), symbol: "AAA", quantity: 10, price: 15, gross: 150 });
  const s = taxReport({ year: 2024, transactions: [buy, sell], portfolios: [p], rateOnDate: flat }).summary;
  near(s.capitalProceeds - s.capitalCosts, 50);
});

test("tax: FIFO consumes oldest lots first", () => {
  const p = portfolio({ name: "Broker" });
  const b = (date: Date, qty: number, gross: number) => tx({ typeRaw: "buy", portfolioId: p.id, date, symbol: "AAA", quantity: qty, price: gross / qty, gross });
  const sell = tx({ typeRaw: "sell", portfolioId: p.id, date: d(2024, 3, 1), symbol: "AAA", quantity: 5, price: 30, gross: 150 });
  const r = taxReport({ year: 2024, transactions: [b(d(2024, 1, 1), 5, 50), b(d(2024, 2, 1), 5, 100), sell], portfolios: [p], rateOnDate: flat });
  near(r.summary.capitalCosts, 50); near(r.summary.realizedGains, 100); assert.equal(r.sells.length, 1);
});

test("tax: IKE excluded by default", () => {
  const ike = portfolio({ name: "XTB IKE (123)", kindRaw: "account" });
  const normal = portfolio({ name: "XTB PLN (999)", kindRaw: "account" });
  const mk = (p: typeof ike, sym: string, buy: number, sell: number) => [
    tx({ typeRaw: "buy", portfolioId: p.id, date: d(2024, 1, 1), symbol: sym, quantity: 1, price: buy, gross: buy }),
    tx({ typeRaw: "sell", portfolioId: p.id, date: d(2024, 6, 1), symbol: sym, quantity: 1, price: sell, gross: sell }),
  ];
  const all = [...mk(ike, "AAA", 10, 20), ...mk(normal, "BBB", 10, 12)];
  const ex = taxReport({ year: 2024, transactions: all, portfolios: [ike, normal], rateOnDate: flat }).summary;
  near(ex.realizedGains, 2); assert.equal(ex.excludedTaxExemptCount, 1);
  const inc = taxReport({ year: 2024, transactions: all, portfolios: [ike, normal], includeTaxExemptAccounts: true, rateOnDate: flat }).summary;
  near(inc.realizedGains, 12);
});

test("tax: uses the FX rate valid on each date", () => {
  const p = portfolio({ name: "Broker" });
  const buy = tx({ typeRaw: "buy", portfolioId: p.id, date: d(2023, 1, 10), symbol: "AAPL.US", quantity: 1, price: 100, gross: 100, currency: "USD" });
  const sell = tx({ typeRaw: "sell", portfolioId: p.id, date: d(2024, 6, 10), symbol: "AAPL.US", quantity: 1, price: 110, gross: 110, currency: "USD" });
  const r = taxReport({ year: 2024, transactions: [buy, sell], portfolios: [p], rateOnDate: (c, date) => (c !== "USD" ? 1 : date.getFullYear() === 2023 ? 4 : 5) });
  near(r.summary.capitalCosts, 400); near(r.summary.capitalProceeds, 550); near(r.summary.realizedGains, 150);
  assert.ok(taxReportCsv(r).includes("# sells"));
});

test("cashflow: dividends in, fees/tax out, bond redemption in", () => {
  const p = portfolio();
  const events = cashflowEvents([
    tx({ typeRaw: "dividend", portfolioId: p.id, gross: 10, date: d(2024, 3, 1) }),
    tx({ typeRaw: "tax", portfolioId: p.id, gross: 2, date: d(2024, 3, 2) }),
    tx({ typeRaw: "sell", portfolioId: p.id, gross: 1000, assetType: "bond", date: d(2024, 3, 3) }),
    tx({ typeRaw: "sell", portfolioId: p.id, gross: 500, assetType: "stock", date: d(2024, 3, 4) }),
  ], [p], { year: 2024 });
  assert.deepEqual(events.map((e) => e.amount), [1000, -2, 10]);
});

test("price alerts: threshold + once-a-day cooldown", () => {
  const a: PriceAlert = { id: newId(), symbol: "AAPL.US", currency: "USD", targetPrice: 200, above: true, enabled: true, lastTriggeredAt: null };
  const q = [quote("AAPL.US", "USD", 201)];
  assert.equal(evaluateAlerts(q, [a]).length, 1);
  assert.equal(evaluateAlerts(q, [{ ...a, lastTriggeredAt: new Date() }]).length, 0);
  assert.equal(evaluateAlerts(q, [{ ...a, lastTriggeredAt: new Date() }], true).length, 1);
  assert.equal(evaluateAlerts([quote("AAPL.US", "USD", 199)], [a]).length, 0);
  assert.equal(evaluateAlerts(q, [{ ...a, enabled: false }]).length, 0);
});

test("allocation drift flags only targets beyond the threshold", () => {
  const items = allocationDriftItems({ totalValueBase: 1000, allocationByType: { etf: 700, stock: 300 } }, { etf: 60, stock: 35, bond: 5 }, 6);
  assert.deepEqual(items.map((i) => i.assetType), ["etf"]);
  near(items[0]!.driftPct, 10);
});

test("transactions csv escapes commas and quotes", () => {
  const p = portfolio({ name: "A, B" });
  const csv = exportTransactionsCsv([tx({ typeRaw: "buy", portfolioId: p.id, symbol: "X", notes: 'say "hi"', gross: 1.5 })], [p]);
  assert.ok(csv.includes('"A, B"'));
  assert.ok(csv.includes('"say ""hi"""'));
});
