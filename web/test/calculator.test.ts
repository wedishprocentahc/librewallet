import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateToPLN, calculate } from "../core/calculator.ts";
import { bondCurrentPrice, parseBondNotes, termsFromPreset, BOND_PRESETS } from "../core/bonds.ts";
import { portfolio, quote, tx, utcDate } from "./helpers.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("simple buy/sell profit", () => {
  const p = portfolio();
  const buy = tx({ typeRaw: "buy", portfolioId: p.id, date: new Date(0), symbol: "AAPL.US", name: "Apple", quantity: 10, price: 100, gross: 1000 });
  const sell = tx({ typeRaw: "sell", portfolioId: p.id, date: new Date(86400_000), symbol: "AAPL.US", name: "Apple", quantity: 5, price: 120, gross: 600 });
  const scope = calculate(p, [buy, sell], [quote("AAPL.US", "PLN", 130)]);
  assert.equal(scope.positions.length, 1);
  const pos = scope.positions[0]!;
  near(pos.quantity, 5);
  near(pos.invested, 500);
  near(pos.currentValue, 650);
  near(pos.profit, 150);
  near(pos.realized, 100);
  near(scope.totalValueBase, 650);
  near(scope.totalProfitBase, 250);
  near(scope.netInvestedBase, 400);
  near(scope.returnPct, 62.5);
});

test("foreign quote converted into account currency", () => {
  const p = portfolio({ name: "PLN", kindRaw: "account" });
  const buy = tx({ typeRaw: "buy", portfolioId: p.id, symbol: "NVDA.US", name: "Nvidia", quantity: 1, price: 100, gross: 400 });
  const scope = calculate(p, [buy], [quote("NVDA.US", "USD", 200)], { ratesToPLN: { PLN: 1, USD: 4 } });
  assert.equal(scope.positions.length, 1);
  near(scope.positions[0]!.currentPrice, 800);
  near(scope.positions[0]!.currentValue, 800);
  near(scope.totalValueBase, 800);
});

test("bond portfolio without deposits does not poison aggregate cash", () => {
  const bonds = portfolio({ name: "Obligacje" });
  const broker = portfolio({ name: "XTB EUR (1)", baseCurrency: "EUR", kindRaw: "account" });
  const bondBuy = tx({ typeRaw: "buy", portfolioId: bonds.id, symbol: "EDO", name: "EDO", quantity: 12, price: 100, gross: 1200, assetType: "bond" });
  const dep = tx({ typeRaw: "deposit", portfolioId: broker.id, gross: 2.38, currency: "EUR", cashDelta: 2.38 });
  const scope = aggregateToPLN([bonds, broker], [bondBuy, dep], [], { PLN: 1, EUR: 4 });
  near(scope.cashValueBase, 2.38 * 4);
  near(scope.allocationByType.cash ?? -1, 2.38 * 4);
  assert.ok(!scope.cashRows.some((r) => r.currency === "PLN" && r.value < 0));
});

test("drops opposite-sign internal transfer legs", () => {
  const p = portfolio({ name: "XTB PLN (53254345)", kindRaw: "account" });
  const notes = "Transfer from 53254345 to 53255466";
  const txs = [
    tx({ typeRaw: "deposit", portfolioId: p.id, date: new Date(0), gross: 200, cashDelta: 200 }),
    tx({ typeRaw: "transfer", portfolioId: p.id, date: new Date(1000), gross: 200, cashDelta: 200, notes }),
    tx({ typeRaw: "transfer", portfolioId: p.id, date: new Date(2000), gross: 200, cashDelta: -200, notes }),
  ];
  near(calculate(p, txs, []).cashValueBase, 0);
});

test("capitalized bond accrues compound interest", () => {
  const terms = termsFromPreset(BOND_PRESETS.find((b) => b.code === "EDO")!);
  near(bondCurrentPrice(terms, utcDate("2024-01-01"), utcDate("2025-01-01")), 106.3, 0.05);
});

test("coupon bond accrues only the current year fraction", () => {
  const terms = termsFromPreset(BOND_PRESETS.find((b) => b.code === "COI")!);
  near(bondCurrentPrice(terms, utcDate("2024-01-01"), utcDate("2024-07-01")), 100 * (1 + 0.0605 * 0.5), 0.2);
});

test("parses bond notes written by the bonds screen", () => {
  const t = parseBondNotes("Bond EDO term=120m rate=6.3% margin=2.0 index=cpi cap=true fee=2.0")!;
  assert.equal(t.code, "EDO");
  assert.equal(t.termMonths, 120);
  near(t.firstYearRate, 6.3);
  assert.equal(t.capitalization, true);
});

test("portfolio shows bond profit", () => {
  const p = portfolio();
  const buy = tx({
    typeRaw: "buy", portfolioId: p.id, date: utcDate("2024-01-01"), symbol: "EDO", name: "EDO – 10-letnie indeksowane inflacją",
    quantity: 10, price: 100, gross: 1000, notes: "Bond EDO term=120m rate=6.3% margin=2.0 index=cpi cap=true fee=2.0", assetType: "bond",
  });
  const scope = calculate(p, [buy], []);
  assert.equal(scope.positions.length, 1);
  assert.ok(scope.positions[0]!.currentValue > 1000);
  assert.ok(scope.positions[0]!.profit > 0);
  assert.ok(scope.totalProfitBase > 0);
});
