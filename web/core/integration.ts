import { detectAssetType } from "./assetType.ts";
import { aggregateToPLN, calculate, type ScopeResult } from "./calculator.ts";
import { convertToPLN, normalizeCurrency, type RatesToPLN } from "./currency.ts";
import { isIgnoredSymbol } from "./symbols.ts";
import { type Portfolio, type Quote, type Transaction, txType } from "./types.ts";

/** Local integration payloads (parity with the native app's `/api/holdings`, `/api/portfolio`, `/api/agent-feed`). */

export function inferMarket(symbol: string): string {
  const suffix = (symbol.split(".")[1] ?? "").toUpperCase();
  switch (suffix) {
    case "PL": case "WA": return "GPW";
    case "DE": return "Xetra";
    case "UK": case "L": return "LSE";
    case "US": return "NASDAQ";
    default: return "";
  }
}

export function formatInstrumentSymbol(symbol: string, market: string): string {
  const base = symbol.split(".")[0] ?? symbol;
  switch (market) {
    case "GPW": return `${base}.PL`;
    case "Xetra": return symbol.endsWith(".DE") ? symbol : `${symbol}.DE`;
    case "LSE": return symbol.endsWith(".UK") ? symbol : `${symbol}.UK`;
    case "NASDAQ": return symbol.endsWith(".US") ? symbol : `${symbol}.US`;
    default: return symbol;
  }
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export function holdingsResponse(portfolios: Portfolio[], transactions: Transaction[], now: Date = new Date()) {
  const names = new Map(portfolios.map((p) => [p.id, p.name]));
  const positions = new Map<string, { symbol: string; name: string; currency: string; assetType: string; portfolioName: string; quantity: number }>();
  for (const tx of transactions) {
    const symbol = (tx.symbol ?? "").trim().toUpperCase();
    if (symbol === "" || isIgnoredSymbol(symbol)) continue;
    const currency = normalizeCurrency(tx.currency);
    const key = `${tx.portfolioId ?? "-"}|${symbol}|${currency}`;
    let pos = positions.get(key);
    if (!pos) {
      pos = { symbol, name: tx.name ?? symbol, currency, assetType: tx.assetType ?? detectAssetType(tx.symbol, tx.name), portfolioName: (tx.portfolioId && names.get(tx.portfolioId)) || "", quantity: 0 };
      positions.set(key, pos);
    }
    if (tx.name) pos.name = tx.name;
    const t = txType(tx);
    if (t === "buy") pos.quantity += Math.abs(tx.quantity ?? 0);
    else if (t === "sell") pos.quantity -= Math.abs(tx.quantity ?? 0);
  }
  const instruments = [...positions.values()]
    .filter((p) => p.quantity > 0.0000001)
    .map((p) => {
      const market = inferMarket(p.symbol);
      return { symbol: formatInstrumentSymbol(p.symbol, market), name: p.name, currency: p.currency, assetType: p.assetType, market, portfolioName: p.portfolioName };
    })
    .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
  return { instruments, updatedAt: iso(now), portfolioCount: portfolios.length };
}

export function portfolioSummary(portfolios: Portfolio[], transactions: Transaction[], quotes: Quote[], rates: RatesToPLN, now: Date = new Date()) {
  const scope: ScopeResult = portfolios.length === 1
    ? calculate(portfolios[0]!, transactions, quotes, { ratesToPLN: rates })
    : aggregateToPLN(portfolios, transactions, quotes, rates);
  return {
    totalValue: scope.totalValueBase,
    netInvested: scope.netInvestedBase,
    totalProfit: scope.totalProfitBase,
    returnPct: scope.returnPct,
    baseCurrency: scope.baseCurrency,
    cashByCurrency: Object.fromEntries(scope.cashRows.filter((r) => r.value > 0.0001).map((r) => [r.currency, r.value])),
    allocationByType: scope.allocationByType,
    allocationByCurrency: scope.allocationByCurrency,
    fetchedAt: iso(now),
  };
}

export function portfolioResponse(portfolios: Portfolio[], transactions: Transaction[], quotes: Quote[], rates: RatesToPLN, now: Date = new Date()) {
  if (portfolios.length === 0 || transactions.length === 0) return { status: "no_data", message: "Brak danych portfela." };
  return { status: "ok", summary: portfolioSummary(portfolios, transactions, quotes, rates, now), holdings: holdingsResponse(portfolios, transactions, now) };
}

// ------------------------------------------------------------------ agent feed

const STALE_QUOTE_HOURS = 36;
const round = (v: number, f: number) => Math.round(v * f) / f;
const money = (v: number) => round(v, 100);
const roundMap = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, money(v)]));

export function buildAgentFeed(args: { portfolios: Portfolio[]; transactions: Transaction[]; quotes: Quote[]; rates: RatesToPLN; appVersion: string; now?: Date; source?: string }) {
  const { portfolios, transactions, quotes, rates } = args;
  const now = args.now ?? new Date();
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  const aggregate = aggregateToPLN(portfolios, transactions, quotes, rates);
  const positions: Record<string, unknown>[] = [];
  const cash: { currency: string; portfolioId: string; portfolioName: string; value: number; valueBase: number }[] = [];
  const missing = new Set<string>();
  const stale = new Set<string>();
  let newest: Date | null = null;

  for (const p of portfolios) {
    const scope = calculate(p, transactions, quotes, { ratesToPLN: rates });
    for (const row of scope.cashRows) {
      if (row.value > 0.0001) cash.push({ currency: row.currency, portfolioId: p.id, portfolioName: p.name, value: money(row.value), valueBase: money(convertToPLN(row.value, row.currency, rates)) });
    }
    for (const row of scope.positions) {
      if (!(Math.abs(row.quantity) > 0.0000001)) continue;
      const market = inferMarket(row.symbol);
      const symbolOut = formatInstrumentSymbol(row.symbol, market);
      const valueBase = convertToPLN(Math.max(0, row.currentValue), row.currency, rates);
      const quote = quoteBySymbol.get(row.symbol.toUpperCase());
      if (quote) {
        if (!newest || quote.asOf > newest) newest = quote.asOf;
        if ((now.getTime() - quote.asOf.getTime()) / 3_600_000 > STALE_QUOTE_HOURS) stale.add(symbolOut);
      } else if (row.assetType !== "bond") missing.add(symbolOut);
      positions.push({
        symbol: symbolOut, name: row.name, market, currency: row.currency, assetType: row.assetType, portfolioId: p.id, portfolioName: p.name,
        quantity: round(row.quantity, 1_000_000), avgCost: money(row.avgCost), invested: money(row.invested), currentPrice: money(row.currentPrice),
        priceAsOf: quote ? iso(quote.asOf) : null, currentValue: money(row.currentValue), valueBase: money(valueBase), profit: money(row.profit),
        profitPct: money(row.invested > 0.0001 ? (row.profit / row.invested) * 100 : 0), realized: money(row.realized), income: money(row.income),
        weightPct: money(aggregate.totalValueBase > 0.0001 ? (valueBase / aggregate.totalValueBase) * 100 : 0),
      });
    }
  }
  positions.sort((a, b) => (b.valueBase as number) - (a.valueBase as number) || ((a.symbol as string) < (b.symbol as string) ? -1 : 1));
  cash.sort((a, b) => (a.portfolioName === b.portfolioName ? (a.currency < b.currency ? -1 : 1) : a.portfolioName < b.portfolioName ? -1 : 1));
  return {
    schemaVersion: 1, generatedAt: iso(now), appVersion: args.appVersion, baseCurrency: "PLN", source: args.source ?? "librewallet-web",
    lastSyncAt: newest ? iso(newest) : null,
    totalValue: money(aggregate.totalValueBase), netInvested: money(aggregate.netInvestedBase), totalProfit: money(aggregate.totalProfitBase), returnPct: money(aggregate.returnPct),
    allocationByType: roundMap(aggregate.allocationByType), allocationByCurrency: roundMap(aggregate.allocationByCurrency),
    positions, cash,
    quotesAgeMinutes: newest ? Math.max(0, Math.floor((now.getTime() - newest.getTime()) / 60000)) : null,
    staleSymbols: [...stale].sort(), missingQuotes: [...missing].sort(),
  };
}
