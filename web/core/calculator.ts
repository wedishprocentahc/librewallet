import { type BondLot, bondCurrentPrice, resolveBondTerms } from "./bonds.ts";
import { assetTypeOrDetect } from "./assetTypeHelper.ts";
import { convertPrice, convertToPLN, normalizeCurrency, type RatesToPLN } from "./currency.ts";
import { addDays, dayKey, startOfDay } from "./dates.ts";
import { isIgnoredSymbol } from "./symbols.ts";
import { type Portfolio, type PortfolioGroup, type Quote, type Transaction, type TransactionType, txType } from "./types.ts";
import { grossMagnitude, parseDealComment, resolveType } from "./xtbParsing.ts";

const EPS = 0.0000001;

export interface PositionRow {
  id: string;
  symbol: string;
  name: string;
  currency: string;
  assetType: string;
  portfolioId: string | null;
  portfolioName: string;
  groupId: string | null;
  groupName: string;
  quantity: number;
  avgCost: number;
  invested: number;
  currentPrice: number;
  currentValue: number;
  profit: number;
  realized: number;
  income: number;
  totalProfit: number;
}

export interface CashRow {
  id: string;
  currency: string;
  value: number;
}

export interface HistoryRow {
  date: Date;
  dayKey: string;
  value: number;
  invested: number;
  positions: number;
  cash: number;
}

export interface ScopeResult {
  baseCurrency: string;
  transactions: Transaction[];
  hasCashOperations: boolean;
  positions: PositionRow[];
  cashRows: CashRow[];
  totalValueBase: number;
  positionValueBase: number;
  cashValueBase: number;
  totalProfitBase: number;
  netInvestedBase: number;
  returnPct: number;
  allocationByType: Record<string, number>;
  allocationByCurrency: Record<string, number>;
}

export interface CalcContext {
  portfolios?: Portfolio[];
  groups?: PortfolioGroup[];
}

export type PriceHistory = Record<string, { date: Date; close: number }[]>;

interface Accumulator {
  symbol: string;
  name: string;
  currency: string;
  assetType: string;
  quantity: number;
  invested: number;
  realized: number;
  income: number;
  lastPrice: number | null;
  anchorPrice: number | null;
  lastTradeDate: Date | null;
  bondLots: BondLot[];
}

interface Normalized {
  tx: Transaction;
  type: TransactionType;
  quantity: number;
  price: number;
  gross: number;
  fee: number;
  cashDelta: number | null;
}

const CASH_OP_TYPES = new Set(["deposit", "withdrawal", "transfer"]);
const sortByDate = (a: Transaction, b: Transaction) => a.date.getTime() - b.date.getTime();

function normalizeTransaction(tx: Transaction): Normalized {
  const signed = tx.cashDelta ?? tx.gross;
  const type = resolveType({
    rowType: "",
    sideText: tx.notes ?? "",
    amount: signed,
    symbol: tx.symbol,
    quantity: tx.quantity,
    price: tx.price,
    existingType: txType(tx),
  });
  const deal = parseDealComment(tx.notes);
  const quantity = Math.abs(tx.quantity ?? 0) > 0 ? Math.abs(tx.quantity ?? 0) : deal.quantity;
  const price = Math.abs(tx.price ?? 0) > 0 ? Math.abs(tx.price ?? 0) : deal.price;
  const gross = grossMagnitude(signed, quantity, price);
  let cashDelta: number | null;
  switch (type) {
    case "deposit": case "sell": case "dividend": case "interest":
      cashDelta = tx.cashDelta ?? (signed >= 0 ? Math.abs(signed) : signed);
      break;
    case "withdrawal": case "buy": case "fee": case "tax":
      cashDelta = tx.cashDelta ?? (signed <= 0 ? signed : -Math.abs(signed));
      break;
    default:
      cashDelta = tx.cashDelta;
  }
  return { tx, type, quantity, price, gross, fee: Math.abs(tx.fee), cashDelta };
}

function accountIdFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const open = name.lastIndexOf("(");
  const close = name.lastIndexOf(")");
  if (open < 0 || close < 0 || open >= close) return null;
  const id = name.slice(open + 1, close).trim();
  return /^\d+$/.test(id) ? id : null;
}

/** XTB lists both legs of an internal transfer; keep only the leg matching this account's role. */
function shouldApplyTransfer(notes: string | null, cashDelta: number, portfolioName: string | null | undefined): boolean {
  if (!(Math.abs(cashDelta) > EPS)) return true;
  const text = notes ?? "";
  const account = accountIdFromName(portfolioName);
  const pair = /Transfer from (\d+) to (\d+)/i.exec(text) ?? /from TA:\s*(\d+)\s*to:\s*(\d+)/i.exec(text);
  if (pair) {
    if (account) {
      if (account === pair[1]) return cashDelta < 0;
      if (account === pair[2]) return cashDelta > 0;
    }
    return true;
  }
  if (/Transfer out operation on account with id \d+/i.test(text)) return cashDelta < 0;
  if (/Transfer in operation on account with id \d+/i.test(text)) return cashDelta > 0;
  return true;
}

function reduceBondLots(lots: BondLot[], selling: number): BondLot[] {
  let remaining = selling;
  const next: BondLot[] = [];
  for (const lot of lots) {
    if (!(remaining > EPS)) {
      next.push(lot);
      continue;
    }
    if (lot.quantity <= remaining + EPS) {
      remaining -= lot.quantity;
    } else {
      next.push({ ...lot, quantity: lot.quantity - remaining });
      remaining = 0;
    }
  }
  return next;
}

function addCash(cash: Map<string, number>, currency: string, delta: number): void {
  cash.set(currency, (cash.get(currency) ?? 0) + delta);
}

function applyTransaction(
  norm: Normalized,
  positions: Map<string, Accumulator>,
  cash: Map<string, number>,
  portfolioNames: Map<string, string>,
): void {
  const tx = norm.tx;
  const currency = tx.currency.toUpperCase();
  const fee = norm.fee;
  const gross = norm.gross;

  switch (norm.type) {
    case "deposit":
      addCash(cash, currency, norm.cashDelta ?? gross);
      return;
    case "withdrawal":
      addCash(cash, currency, norm.cashDelta ?? -gross);
      return;
    case "transfer": {
      const delta = norm.cashDelta ?? 0;
      const pname = tx.portfolioId ? portfolioNames.get(tx.portfolioId) : null;
      if (shouldApplyTransfer(tx.notes, delta, pname)) addCash(cash, currency, delta);
      return;
    }
    default:
      break;
  }

  const symbol = (tx.symbol ?? tx.name ?? "").trim().toUpperCase();
  if (symbol === "") {
    if (norm.type === "dividend" || norm.type === "interest") addCash(cash, currency, norm.cashDelta ?? gross - fee);
    else if (norm.type === "fee" || norm.type === "tax") addCash(cash, currency, norm.cashDelta ?? -(fee > 0 ? fee : gross));
    return;
  }

  const key = `${symbol}|${currency}|${tx.portfolioId ?? "-"}`;
  let acc = positions.get(key);
  if (!acc) {
    acc = {
      symbol,
      name: tx.name ?? symbol,
      currency,
      assetType: assetTypeOrDetect(tx.assetType, tx.symbol, tx.name),
      quantity: 0, invested: 0, realized: 0, income: 0,
      lastPrice: null, anchorPrice: null, lastTradeDate: null, bondLots: [],
    };
    positions.set(key, acc);
  }
  if (tx.name) acc.name = tx.name;

  switch (norm.type) {
    case "buy": {
      const qty = norm.quantity;
      const value = gross > 0 ? gross : qty * norm.price;
      if (!(qty > 0 || value > 0)) return;
      const oldQty = acc.quantity;
      acc.quantity += qty;
      acc.invested += value + fee;
      if (acc.quantity > 0) {
        const priorCost = oldQty > 0 ? (acc.lastPrice ?? 0) * oldQty : 0;
        acc.lastPrice = (priorCost + value) / acc.quantity;
      } else if (norm.price > 0) {
        acc.lastPrice = norm.price;
      }
      if (qty > 0 && value > 0) acc.anchorPrice = value / qty;
      acc.lastTradeDate = startOfDay(tx.date);
      const terms = resolveBondTerms({ symbol: tx.symbol, name: tx.name, notes: tx.notes, assetType: tx.assetType ?? acc.assetType });
      if (terms && qty > 0) {
        acc.assetType = "bond";
        acc.bondLots.push({ quantity: qty, purchaseDate: tx.date, terms });
      }
      addCash(cash, currency, norm.cashDelta ?? -(value + fee));
      break;
    }
    case "sell": {
      const qty = norm.quantity;
      const value = gross > 0 ? gross : qty * Math.abs(norm.price > 0 ? norm.price : (acc.lastPrice ?? 0));
      const avgCost = acc.quantity > 0 ? acc.invested / acc.quantity : 0;
      const costSold = avgCost * qty;
      if (acc.quantity > 0) {
        acc.quantity -= qty;
        acc.invested = Math.max(0, acc.invested - costSold);
      } else {
        acc.quantity -= qty;
      }
      if (Math.abs(acc.quantity) < EPS) {
        acc.quantity = 0;
        acc.invested = 0;
        acc.lastPrice = null;
        acc.bondLots = [];
      } else {
        acc.lastPrice = acc.invested / acc.quantity;
        if (acc.bondLots.length > 0) acc.bondLots = reduceBondLots(acc.bondLots, qty);
      }
      acc.realized += value - fee - costSold;
      if (qty > 0 && value > 0) acc.anchorPrice = value / qty;
      acc.lastTradeDate = startOfDay(tx.date);
      addCash(cash, currency, norm.cashDelta ?? value - fee);
      break;
    }
    case "dividend":
    case "interest":
      acc.income += gross - fee;
      addCash(cash, currency, norm.cashDelta ?? gross - fee);
      break;
    case "fee":
    case "tax":
      acc.realized -= fee > 0 ? fee : gross;
      addCash(cash, currency, norm.cashDelta ?? -(fee > 0 ? fee : gross));
      break;
    default:
      break;
  }
}

function bondMarkValue(acc: Accumulator, asOf: Date): number | null {
  if (acc.bondLots.length === 0) return null;
  return acc.bondLots.reduce((sum, lot) => (lot.quantity > 0 ? sum + lot.quantity * bondCurrentPrice(lot.terms, lot.purchaseDate, asOf) : sum), 0);
}

function markPrice(acc: Accumulator, quote: Quote | undefined, rates: RatesToPLN): number {
  const fallback = acc.lastPrice ?? 0;
  if (!quote || !(quote.price > 0)) return fallback;
  const qc = quote.currency.toUpperCase();
  const pc = acc.currency.toUpperCase();
  if (qc === "" || qc === "N/A" || qc === pc) return quote.price;
  return convertPrice(quote.price, qc, pc, rates) ?? fallback;
}

function quoteLookup(quotes: Quote[]) {
  const bySymbol = new Map<string, Quote>();
  const byKey = new Map<string, Quote>();
  for (const q of quotes) {
    bySymbol.set(q.symbol.toUpperCase(), q);
    byKey.set(`${q.symbol.toUpperCase()}|${q.currency.toUpperCase()}`, q);
  }
  return (symbol: string, currency: string) => byKey.get(`${symbol}|${currency}`) ?? bySymbol.get(symbol.toUpperCase());
}

class Flows {
  netInvested = 0;
  explicitCashFlow = 0;
  readonly hasCashOperations: boolean;
  constructor(hasCashOperations: boolean) {
    this.hasCashOperations = hasCashOperations;
  }
  apply(n: Normalized): void {
    if (this.hasCashOperations) {
      if (n.type === "deposit") this.explicitCashFlow += n.cashDelta ?? n.gross;
      else if (n.type === "withdrawal") this.explicitCashFlow += n.cashDelta ?? -n.gross;
      else if (n.type === "transfer") this.explicitCashFlow += n.cashDelta ?? 0;
    } else {
      if (n.type === "buy") this.netInvested += n.gross + n.fee;
      if (n.type === "sell") this.netInvested -= Math.max(0, n.gross - n.fee);
      if (n.type === "dividend" || n.type === "interest") this.netInvested -= Math.max(0, n.gross - n.fee);
    }
  }
  get invested(): number {
    return this.hasCashOperations ? this.explicitCashFlow : Math.max(0, this.netInvested);
  }
}

function scopedTransactions(portfolio: Portfolio | null, all: Transaction[]): Transaction[] {
  return all.filter((t) => !portfolio || t.portfolioId === portfolio.id).sort(sortByDate);
}

function emptyScope(): ScopeResult {
  return {
    baseCurrency: "PLN", transactions: [], hasCashOperations: false, positions: [], cashRows: [],
    totalValueBase: 0, positionValueBase: 0, cashValueBase: 0, totalProfitBase: 0, netInvestedBase: 0,
    returnPct: 0, allocationByType: {}, allocationByCurrency: {},
  };
}

export function calculate(
  portfolio: Portfolio | null,
  allTransactions: Transaction[],
  quotes: Quote[],
  opts: { includeCashInAllocation?: boolean; ratesToPLN?: RatesToPLN; ctx?: CalcContext; asOf?: Date } = {},
): ScopeResult {
  const includeCashInAllocation = opts.includeCashInAllocation ?? true;
  const rates = opts.ratesToPLN ?? { PLN: 1 };
  const asOf = opts.asOf ?? new Date();
  const portfolioNames = new Map((opts.ctx?.portfolios ?? (portfolio ? [portfolio] : [])).map((p) => [p.id, p.name]));
  const groupName = new Map((opts.ctx?.groups ?? []).map((g) => [g.id, g.name]));

  const baseCurrency = normalizeCurrency(portfolio?.baseCurrency);
  const scoped = scopedTransactions(portfolio, allTransactions);
  const hasCashOperations = scoped.some((t) => CASH_OP_TYPES.has(t.typeRaw));
  const positions = new Map<string, Accumulator>();
  const cash = new Map<string, number>();
  const flows = new Flows(hasCashOperations);
  const findQuote = quoteLookup(quotes);

  for (const tx of scoped) {
    const norm = normalizeTransaction(tx);
    applyTransaction(norm, positions, cash, portfolioNames);
    flows.apply(norm);
  }

  const positionRows: PositionRow[] = [];
  for (const acc of positions.values()) {
    if (isIgnoredSymbol(acc.symbol)) continue;
    const bondValue = bondMarkValue(acc, asOf);
    let price: number;
    let currentValue: number;
    if (bondValue !== null) {
      currentValue = bondValue;
      price = Math.abs(acc.quantity) > EPS ? bondValue / acc.quantity : 0;
    } else {
      price = markPrice(acc, findQuote(acc.symbol, acc.currency), rates);
      currentValue = acc.quantity * price;
    }
    const profit = currentValue - acc.invested;
    positionRows.push({
      id: `${portfolio?.id ?? "all"}|${acc.symbol}|${acc.currency}`,
      symbol: acc.symbol,
      name: acc.name,
      currency: acc.currency,
      assetType: acc.assetType,
      portfolioId: portfolio?.id ?? null,
      portfolioName: portfolio?.name ?? "",
      groupId: portfolio?.groupId ?? null,
      groupName: portfolio?.groupId ? (groupName.get(portfolio.groupId) ?? "") : "",
      quantity: acc.quantity,
      avgCost: acc.quantity !== 0 ? acc.invested / acc.quantity : 0,
      invested: acc.invested,
      currentPrice: price,
      currentValue,
      profit,
      realized: acc.realized,
      income: acc.income,
      totalProfit: profit + acc.realized + acc.income,
    });
  }
  const visible = positionRows
    .filter((p) => Math.abs(p.quantity) > EPS || Math.abs(p.totalProfit) > 0.0001)
    .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));

  // Cash is exposed only with explicit cash operations; manual bond portfolios (buys without deposits)
  // must not emit a large negative cash row.
  const cashRows: CashRow[] = hasCashOperations
    ? [...cash.entries()].map(([currency, value]) => ({ id: currency, currency, value })).sort((a, b) => (a.currency < b.currency ? -1 : 1))
    : [];

  const positionValueBase = visible.reduce((s, p) => s + Math.max(0, p.currentValue), 0);
  const cashValueBase = cashRows.reduce((s, c) => s + c.value, 0);
  const totalProfitBase = visible.reduce((s, p) => s + p.totalProfit, 0);
  const netInvestedBase = flows.invested;
  const returnPct = netInvestedBase > 0 ? (totalProfitBase / netInvestedBase) * 100 : 0;

  const allocationByType: Record<string, number> = {};
  const allocationByCurrency: Record<string, number> = {};
  for (const p of visible) {
    if (p.currentValue > 0) {
      allocationByType[p.assetType] = (allocationByType[p.assetType] ?? 0) + p.currentValue;
      allocationByCurrency[p.currency] = (allocationByCurrency[p.currency] ?? 0) + p.currentValue;
    }
  }
  if (includeCashInAllocation && hasCashOperations) {
    for (const c of cashRows) {
      if (c.value > 0) {
        allocationByType.cash = (allocationByType.cash ?? 0) + c.value;
        allocationByCurrency[c.currency] = (allocationByCurrency[c.currency] ?? 0) + c.value;
      }
    }
  }

  return {
    baseCurrency, transactions: scoped, hasCashOperations, positions: visible, cashRows,
    totalValueBase: positionValueBase + cashValueBase, positionValueBase, cashValueBase,
    totalProfitBase, netInvestedBase, returnPct, allocationByType, allocationByCurrency,
  };
}

/** Sums per-portfolio scopes after converting each portfolio's totals to PLN. */
export function aggregateToPLN(
  portfolios: Portfolio[],
  allTransactions: Transaction[],
  quotes: Quote[],
  ratesToPLN: RatesToPLN,
  ctx?: CalcContext,
  asOf?: Date,
): ScopeResult {
  if (portfolios.length === 0) return emptyScope();
  let totalValue = 0, totalProfit = 0, netInvested = 0, positionValue = 0, cashValue = 0;
  const allPositions: PositionRow[] = [];
  const mergedCash = new Map<string, number>();
  const allTx: Transaction[] = [];
  let hasCashOperations = false;
  const allocationByType: Record<string, number> = {};
  const allocationByCurrency: Record<string, number> = {};

  for (const p of portfolios) {
    const scope = calculate(p, allTransactions.filter((t) => t.portfolioId === p.id), quotes, { ratesToPLN, ctx, asOf });
    const base = scope.baseCurrency.toUpperCase();
    totalValue += convertToPLN(scope.totalValueBase, base, ratesToPLN);
    netInvested += convertToPLN(scope.netInvestedBase, base, ratesToPLN);
    totalProfit += convertToPLN(scope.totalProfitBase, base, ratesToPLN);
    positionValue += convertToPLN(scope.positionValueBase, base, ratesToPLN);
    allPositions.push(...scope.positions);
    if (scope.hasCashOperations) {
      cashValue += convertToPLN(scope.cashValueBase, base, ratesToPLN);
      for (const r of scope.cashRows) mergedCash.set(r.currency, (mergedCash.get(r.currency) ?? 0) + r.value);
    }
    allTx.push(...scope.transactions);
    hasCashOperations = hasCashOperations || scope.hasCashOperations;
  }

  for (const p of allPositions) {
    if (p.currentValue > 0) {
      const v = convertToPLN(p.currentValue, p.currency, ratesToPLN);
      allocationByType[p.assetType] = (allocationByType[p.assetType] ?? 0) + v;
      allocationByCurrency[p.currency] = (allocationByCurrency[p.currency] ?? 0) + v;
    }
  }
  for (const [currency, value] of mergedCash) {
    if (value > 0) {
      const v = convertToPLN(value, currency, ratesToPLN);
      allocationByType.cash = (allocationByType.cash ?? 0) + v;
      allocationByCurrency[currency] = (allocationByCurrency[currency] ?? 0) + v;
    }
  }

  return {
    baseCurrency: "PLN",
    transactions: allTx.sort(sortByDate),
    hasCashOperations,
    positions: allPositions.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)),
    cashRows: [...mergedCash.entries()].map(([currency, value]) => ({ id: currency, currency, value })).sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    totalValueBase: totalValue, positionValueBase: positionValue, cashValueBase: cashValue,
    totalProfitBase: totalProfit, netInvestedBase: netInvested,
    returnPct: netInvested > 0 ? (totalProfit / netInvested) * 100 : 0,
    allocationByType, allocationByCurrency,
  };
}

/** Most recent close on or before `date`; `state.index` is a pointer-walk cursor (series sorted ascending). */
function closeAtOrBefore(series: { date: Date; close: number }[], date: Date, state: { index: number }): number | null {
  if (series.length === 0) return null;
  const target = startOfDay(date).getTime();
  if (state.index < 0) state.index = 0;
  if (state.index >= series.length) state.index = series.length - 1;
  while (state.index + 1 < series.length && series[state.index + 1]!.date.getTime() <= target) state.index += 1;
  if (series[state.index]!.date.getTime() > target) state.index = 0;
  return series[state.index]!.close;
}

export function buildDailyTimeline(
  portfolio: Portfolio | null,
  allTransactions: Transaction[],
  quotes: Quote[],
  histories: PriceHistory = {},
  opts: { ratesToPLN?: RatesToPLN; ctx?: CalcContext; today?: Date } = {},
): HistoryRow[] {
  const scoped = scopedTransactions(portfolio, allTransactions);
  const first = scoped[0];
  if (!first) return [];
  const hasCashOperations = scoped.some((t) => CASH_OP_TYPES.has(t.typeRaw));
  const rates = opts.ratesToPLN ?? { PLN: 1 };
  const portfolioNames = new Map((opts.ctx?.portfolios ?? (portfolio ? [portfolio] : [])).map((p) => [p.id, p.name]));
  const positions = new Map<string, Accumulator>();
  const cash = new Map<string, number>();
  const flows = new Flows(hasCashOperations);
  const findQuote = quoteLookup(quotes);

  // Day-normalised, ascending price series per symbol.
  const series: Record<string, { date: Date; close: number }[]> = {};
  for (const [sym, points] of Object.entries(histories)) {
    const byDay = new Map<number, number>();
    for (const p of points) if (p.close > 0) byDay.set(startOfDay(p.date).getTime(), p.close);
    series[sym] = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, close]) => ({ date: new Date(t), close }));
  }

  const startDay = startOfDay(first.date);
  const endDay = startOfDay(opts.today ?? new Date());
  const out: HistoryRow[] = [];
  const dayIdx = new Map<string, { index: number }>();
  const anchors = new Map<string, { tradeDate: number; close: number }>();
  let idx = 0;

  for (let day = startDay; day.getTime() <= endDay.getTime(); day = addDays(day, 1)) {
    while (idx < scoped.length) {
      const tx = scoped[idx]!;
      if (startOfDay(tx.date).getTime() > day.getTime()) break;
      const norm = normalizeTransaction(tx);
      applyTransaction(norm, positions, cash, portfolioNames);
      flows.apply(norm);
      idx += 1;
    }

    // Each historical day is valued by scaling the account-currency cost anchor by the native market
    // performance since the last trade: qty * anchor * close(day) / close(lastTradeDate).
    const isLatestDay = day.getTime() === endDay.getTime();
    let positionsValue = 0;
    for (const acc of positions.values()) {
      if (!(Math.abs(acc.quantity) > EPS)) continue;
      if (isIgnoredSymbol(acc.symbol)) continue;
      const bond = bondMarkValue(acc, day);
      if (bond !== null) {
        positionsValue += Math.max(0, bond);
        continue;
      }
      const avgCost = acc.invested / acc.quantity;
      let price = avgCost > 0 ? avgCost : (acc.lastPrice ?? 0);
      const key = acc.symbol.toUpperCase();
      const s = series[key];
      if (s && acc.lastTradeDate && price > 0) {
        const tradeDay = startOfDay(acc.lastTradeDate).getTime();
        if (anchors.get(key)?.tradeDate !== tradeDay) {
          const st = { index: 0 };
          const close = closeAtOrBefore(s, new Date(tradeDay), st) ?? 0;
          anchors.set(key, { tradeDate: tradeDay, close });
          dayIdx.set(key, st);
        }
        const anchorClose = anchors.get(key)?.close ?? 0;
        // Anchor on the last real trade price, not average cost, so trades don't erase earlier unrealized gains.
        if (acc.anchorPrice && acc.anchorPrice > 0) price = acc.anchorPrice;
        // On the trade day itself keep cost-basis valuation (ratio = 1).
        if (day.getTime() !== tradeDay && anchorClose > 0) {
          const st = dayIdx.get(key) ?? { index: 0 };
          const dayClose = closeAtOrBefore(s, day, st) ?? 0;
          dayIdx.set(key, st);
          if (dayClose > 0) price = price * (dayClose / anchorClose);
        }
      } else if (isLatestDay) {
        price = markPrice(acc, findQuote(acc.symbol, acc.currency), rates);
      }
      positionsValue += Math.max(0, acc.quantity * price);
    }

    let cashValue = 0;
    if (hasCashOperations) for (const v of cash.values()) cashValue += v;
    out.push({
      date: day,
      dayKey: dayKey(day),
      value: positionsValue + cashValue,
      invested: flows.invested,
      positions: positionsValue,
      cash: cashValue,
    });
  }
  return out;
}

export function aggregateDailyTimelineToPLN(
  portfolios: Portfolio[],
  allTransactions: Transaction[],
  quotes: Quote[],
  ratesToPLN: RatesToPLN,
  histories: PriceHistory = {},
  ctx?: CalcContext,
  today?: Date,
): HistoryRow[] {
  const merged = new Map<string, HistoryRow>();
  for (const p of portfolios) {
    const rows = buildDailyTimeline(p, allTransactions, quotes, histories, { ratesToPLN, ctx, today });
    for (const r of rows) {
      const conv = (v: number) => convertToPLN(v, p.baseCurrency, ratesToPLN);
      const e = merged.get(r.dayKey);
      if (e) {
        e.value += conv(r.value);
        e.invested += conv(r.invested);
        e.positions += conv(r.positions);
        e.cash += conv(r.cash);
      } else {
        merged.set(r.dayKey, { date: r.date, dayKey: r.dayKey, value: conv(r.value), invested: conv(r.invested), positions: conv(r.positions), cash: conv(r.cash) });
      }
    }
  }
  return [...merged.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}
