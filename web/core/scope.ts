import { aggregateDailyTimelineToPLN, aggregateToPLN, buildDailyTimeline, calculate, type HistoryRow, type PriceHistory, type ScopeResult } from "./calculator.ts";
import { SUPPORTED_ASSET_TYPES } from "./assetType.ts";
import { convertToPLN, type RatesToPLN } from "./currency.ts";
import { dayKey } from "./dates.ts";
import { type AllocationTarget, type Dataset, newId, type Portfolio } from "./types.ts";

export type ScopeSel = { kind: "all" } | { kind: "group"; id: string } | { kind: "portfolio"; id: string };

export function scopedPortfolios(data: Pick<Dataset, "portfolios">, scope: ScopeSel): Portfolio[] {
  switch (scope.kind) {
    case "all": return data.portfolios;
    case "group": return data.portfolios.filter((p) => p.groupId === scope.id);
    case "portfolio": return data.portfolios.filter((p) => p.id === scope.id);
  }
}

export interface Ctx {
  data: Dataset;
  rates: RatesToPLN;
  histories?: PriceHistory;
}

export function scopeResult(ctx: Ctx, scope: ScopeSel, asOf?: Date): ScopeResult {
  const scoped = scopedPortfolios(ctx.data, scope);
  const c = { portfolios: ctx.data.portfolios, groups: ctx.data.groups };
  const only = scoped.length === 1 ? scoped[0] : undefined;
  return only
    ? calculate(only, ctx.data.transactions, ctx.data.quotes, { ratesToPLN: ctx.rates, ctx: c, asOf })
    : aggregateToPLN(scoped, ctx.data.transactions, ctx.data.quotes, ctx.rates, c, asOf);
}

export function scopeHistory(ctx: Ctx, scope: ScopeSel, today?: Date): HistoryRow[] {
  const scoped = scopedPortfolios(ctx.data, scope);
  const c = { portfolios: ctx.data.portfolios, groups: ctx.data.groups };
  const only = scoped.length === 1 ? scoped[0] : undefined;
  return only
    ? buildDailyTimeline(only, ctx.data.transactions, ctx.data.quotes, ctx.histories ?? {}, { ratesToPLN: ctx.rates, ctx: c, today })
    : aggregateDailyTimelineToPLN(scoped, ctx.data.transactions, ctx.data.quotes, ctx.rates, ctx.histories ?? {}, c, today);
}

// ------------------------------------------------------------------ rebalance

export interface RebalanceSuggestion { assetType: string; deltaValue: number; actualPct: number; targetPct: number }

export function actualPct(assetType: string, scope: Pick<ScopeResult, "totalValueBase" | "allocationByType">): number {
  return scope.totalValueBase > 0 ? ((scope.allocationByType[assetType] ?? 0) / scope.totalValueBase) * 100 : 0;
}

/** Targets for a scope: global (no portfolio) for "all"; the first member's targets for a group (kept in sync on write). */
export function targetPercentages(data: Pick<Dataset, "portfolios" | "targets">, scope: ScopeSel): Record<string, number> {
  let list: AllocationTarget[];
  if (scope.kind === "all") list = data.targets.filter((t) => t.portfolioId === null);
  else if (scope.kind === "group") {
    const first = data.portfolios.find((p) => p.groupId === scope.id);
    list = first ? data.targets.filter((t) => t.portfolioId === first.id) : [];
  } else list = data.targets.filter((t) => t.portfolioId === scope.id);
  return Object.fromEntries(list.map((t) => [t.assetType, t.targetPct]));
}

export function setTargetPct(data: Pick<Dataset, "portfolios" | "targets">, scope: ScopeSel, assetType: string, pct: number): void {
  const upsert = (portfolioId: string | null) => {
    const existing = data.targets.find((t) => t.assetType === assetType && t.portfolioId === portfolioId);
    if (existing) existing.targetPct = pct;
    else data.targets.push({ id: newId(), portfolioId, assetType, targetPct: pct, createdAt: new Date() });
  };
  if (scope.kind === "all") upsert(null);
  else if (scope.kind === "group") for (const p of data.portfolios.filter((x) => x.groupId === scope.id)) upsert(p.id);
  else if (data.portfolios.some((p) => p.id === scope.id)) upsert(scope.id);
}

export function rebalanceSuggestions(scope: Pick<ScopeResult, "totalValueBase" | "allocationByType">, targets: Record<string, number>): RebalanceSuggestion[] {
  const total = scope.totalValueBase;
  if (!(total > 0)) return [];
  const out: RebalanceSuggestion[] = [];
  for (const key of SUPPORTED_ASSET_TYPES) {
    const targetPct = targets[key] ?? 0;
    if (targetPct <= 0) continue;
    const currentValue = scope.allocationByType[key] ?? 0;
    const delta = (targetPct / 100) * total - currentValue;
    if (Math.abs(delta) < Math.max(1, total * 0.002)) continue;
    out.push({ assetType: key, deltaValue: delta, actualPct: (currentValue / total) * 100, targetPct });
  }
  return out.sort((a, b) => Math.abs(b.deltaValue) - Math.abs(a.deltaValue));
}

// ------------------------------------------------------------------ benchmark

export interface BenchmarkOption { id: string; label: string; symbols: string[]; currency: string; isComposite: boolean }

export function benchmarkOptions(currency = "PLN"): BenchmarkOption[] {
  return [
    { id: "", label: "Brak", symbols: [], currency, isComposite: false },
    { id: "wig", label: "WIG", symbols: ["ETFBW20TR.WA", "ETFBM40TR.WA"], currency: "PLN", isComposite: true },
    { id: "wig20", label: "WIG20", symbols: ["ETFBW20TR.WA"], currency: "PLN", isComposite: false },
    { id: "mwig40", label: "mWIG40", symbols: ["ETFBM40TR.WA"], currency: "PLN", isComposite: false },
    { id: "sp500", label: "S&P 500", symbols: ["^GSPC"], currency: "USD", isComposite: false },
    { id: "vwce", label: "VWCE", symbols: ["VWCE.DE"], currency: "EUR", isComposite: false },
  ];
}

/** dayKey → price, with pointer-walk lookup of the last price on or before a day. */
export class DaySeries {
  readonly keys: string[];
  readonly values: Record<string, number>;
  private idx = 0;
  constructor(values: Record<string, number>) {
    this.values = values;
    this.keys = Object.keys(values).sort();
  }
  priceAtOrBefore(day: string): number {
    if (this.keys.length === 0) return 0;
    if (this.idx >= this.keys.length) this.idx = this.keys.length - 1;
    while (this.idx + 1 < this.keys.length && this.keys[this.idx + 1]! <= day) this.idx++;
    if (this.keys[this.idx]! > day) this.idx = 0;
    return this.values[this.keys[this.idx]!] ?? 0;
  }
}

function toScopeCurrency(amount: number, currency: string, scopeCurrency: string, rates: RatesToPLN): number {
  const scope = scopeCurrency.toUpperCase();
  const ccy = currency.toUpperCase();
  if (scope === ccy) return amount;
  const pln = convertToPLN(amount, ccy, rates);
  if (scope === "PLN") return pln;
  const scopeRate = rates[scope] ?? 0;
  return scopeRate > 0 ? pln / scopeRate : pln;
}

/** Average of the component series, each normalised to its first available price. */
function blendComposite(maps: Record<string, number>[]): DaySeries {
  if (maps.length === 0) return new DaySeries({});
  const dates = [...new Set(maps.flatMap((m) => Object.keys(m)))].sort();
  const series = maps.map((m) => new DaySeries(m));
  const starts = maps.map(() => 0);
  const normalized: Record<string, number>[] = maps.map(() => ({}));
  for (const d of dates) {
    series.forEach((s, i) => {
      const v = s.priceAtOrBefore(d);
      if (starts[i] === 0 && v > 0) starts[i] = v;
      if (starts[i]! > 0 && v > 0) normalized[i]![d] = v / starts[i]!;
    });
  }
  const blended: Record<string, number> = {};
  for (const d of dates) {
    const vals = normalized.map((n) => n[d]).filter((v): v is number => v !== undefined && v > 0);
    if (vals.length === maps.length) blended[d] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return new DaySeries(blended);
}

export type BenchmarkHistories = Record<string, { date: Date; close: number }[]>;

export function benchmarkSeries(cfg: BenchmarkOption, histories: BenchmarkHistories, scopeCurrency: string, rates: RatesToPLN): DaySeries {
  const toMap = (h: { date: Date; close: number }[]) => {
    const m: Record<string, number> = {};
    for (const row of h) m[dayKey(row.date)] = toScopeCurrency(row.close, cfg.currency, scopeCurrency, rates);
    return m;
  };
  if (cfg.isComposite) {
    const maps = cfg.symbols.flatMap((sym) => (histories[`${cfg.id}:${sym}`] ? [toMap(histories[`${cfg.id}:${sym}`]!)] : []));
    return blendComposite(maps);
  }
  const h = histories[cfg.id];
  return h ? new DaySeries(toMap(h)) : new DaySeries({});
}

/** What the same contributions would be worth if invested in the benchmark (units bought on each change of `invested`). */
export function attachBenchmark(rows: HistoryRow[], series: DaySeries): (number | null)[] {
  if (rows.length === 0 || series.keys.length === 0) return rows.map(() => null);
  let units = 0;
  let prevInvested = 0;
  return rows.map((r) => {
    const price = series.priceAtOrBefore(r.dayKey);
    const delta = r.invested - prevInvested;
    if (Math.abs(delta) > 0.005 && price > 0) {
      units += delta / price;
      if (units < 0) units = 0;
      prevInvested = r.invested;
    }
    if (!(price > 0) || !(units > 0)) return null;
    const v = units * price;
    return Number.isFinite(v) ? v : null;
  });
}
