import assert from "node:assert/strict";
import { test } from "node:test";
import { attachBenchmark, benchmarkOptions, benchmarkSeries, DaySeries, rebalanceSuggestions, setTargetPct, targetPercentages } from "../core/scope.ts";
import { emptyDataset } from "../core/types.ts";
import type { HistoryRow } from "../core/calculator.ts";
import { portfolio } from "./helpers.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("rebalance suggests buys/reductions beyond the noise threshold, largest first", () => {
  const s = rebalanceSuggestions({ totalValueBase: 1000, allocationByType: { etf: 700, stock: 300 } }, { etf: 60, stock: 30, bond: 10 });
  assert.deepEqual(s.map((x) => x.assetType), ["etf", "bond"]);
  near(s[0]!.deltaValue, -100);
  near(s[1]!.deltaValue, 100);
  assert.deepEqual(rebalanceSuggestions({ totalValueBase: 0, allocationByType: {} }, { etf: 50 }), []);
});

test("group targets are written to every member and read from the first", () => {
  const data = emptyDataset();
  const a = portfolio({ groupId: "g1" }), b = portfolio({ groupId: "g1" }), c = portfolio({ groupId: "g2" });
  data.portfolios.push(a, b, c);
  setTargetPct(data, { kind: "group", id: "g1" }, "etf", 70);
  assert.equal(data.targets.length, 2);
  assert.deepEqual(targetPercentages(data, { kind: "group", id: "g1" }), { etf: 70 });
  setTargetPct(data, { kind: "all" }, "etf", 50);
  setTargetPct(data, { kind: "all" }, "etf", 55);
  assert.deepEqual(targetPercentages(data, { kind: "all" }), { etf: 55 });
  assert.deepEqual(targetPercentages(data, { kind: "portfolio", id: c.id }), {});
});

test("benchmark: contributions are invested at the benchmark price on the day they happen", () => {
  const rows = (vals: [string, number][]): HistoryRow[] => vals.map(([k, inv]) => ({ date: new Date(k), dayKey: k, value: 0, invested: inv, positions: 0, cash: 0 }));
  const series = new DaySeries({ "2024-01-01": 10, "2024-01-02": 20, "2024-01-03": 40 });
  const out = attachBenchmark(rows([["2024-01-01", 100], ["2024-01-02", 100], ["2024-01-03", 100]]), series);
  assert.deepEqual(out, [100, 200, 400]); // 10 units bought at 10, then priced at 10/20/40
  assert.deepEqual(attachBenchmark(rows([["2024-01-01", 0]]), series), [null]);
});

test("benchmark: composite averages normalised components and converts currency", () => {
  const day = (d: string, close: number) => ({ date: new Date(`${d}T12:00:00`), close });
  const cfg = benchmarkOptions().find((o) => o.id === "wig")!;
  const s = benchmarkSeries(cfg, {
    "wig:ETFBW20TR.WA": [day("2024-01-01", 10), day("2024-01-02", 20)],
    "wig:ETFBM40TR.WA": [day("2024-01-01", 100), day("2024-01-02", 100)],
  }, "PLN", { PLN: 1 });
  near(s.values["2024-01-01"]!, 1);
  near(s.values["2024-01-02"]!, 1.5);
  const sp = benchmarkSeries(benchmarkOptions().find((o) => o.id === "sp500")!, { sp500: [day("2024-01-01", 100)] }, "PLN", { PLN: 1, USD: 4 });
  near(sp.values["2024-01-01"]!, 400);
});
