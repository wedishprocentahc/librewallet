import { bondCurrentPrice, maturityDate, resolveBondTerms, type BondTerms } from "./bonds.ts";
import type { ScopeResult } from "./calculator.ts";
import { normalizeCurrency } from "./currency.ts";
import { addMonths, dayKey, startOfDay } from "./dates.ts";
import type { Portfolio, PriceAlert, Quote, Transaction } from "./types.ts";
import { txType } from "./types.ts";

// ---------------------------------------------------------------- period returns

export const RETURN_PERIODS = ["1M", "3M", "6M", "1Y", "YTD"] as const;
export type ReturnPeriod = (typeof RETURN_PERIODS)[number];

export function periodStartDate(period: ReturnPeriod, asOf: Date = new Date()): Date {
  const day = startOfDay(asOf);
  switch (period) {
    case "1M": return addMonths(day, -1);
    case "3M": return addMonths(day, -3);
    case "6M": return addMonths(day, -6);
    case "1Y": return addMonths(day, -12);
    case "YTD": return new Date(day.getFullYear(), 0, 1);
  }
}

export function periodReturnPct(
  symbol: string,
  currentPrice: number,
  histories: Record<string, { date: Date; close: number }[]>,
  period: ReturnPeriod,
  asOf: Date = new Date(),
): number | null {
  if (!(currentPrice > 0)) return null;
  const series = histories[symbol.toUpperCase()];
  if (!series || series.length === 0) return null;
  const start = periodStartDate(period, asOf).getTime();
  let past = series[0]!;
  for (const p of series) if (p.date.getTime() <= start) past = p;
  if (!(past.close > 0)) return null;
  return ((currentPrice - past.close) / past.close) * 100;
}

export function allPeriodReturns(
  symbol: string,
  currentPrice: number,
  histories: Record<string, { date: Date; close: number }[]>,
  asOf: Date = new Date(),
): Partial<Record<ReturnPeriod, number>> {
  const out: Partial<Record<ReturnPeriod, number>> = {};
  for (const p of RETURN_PERIODS) {
    const v = periodReturnPct(symbol, currentPrice, histories, p, asOf);
    if (v !== null) out[p] = v;
  }
  return out;
}

// ---------------------------------------------------------------- cashflow

export interface CashflowEvent {
  id: string;
  date: Date;
  type: string;
  symbol: string | null;
  name: string | null;
  amount: number; // +inflow / −outflow
  currency: string;
  portfolioName: string;
}

function signedCashAmount(tx: Transaction): number | null {
  const raw = Math.abs(tx.cashDelta ?? tx.gross);
  switch (txType(tx)) {
    case "dividend": case "interest": case "deposit": return raw;
    case "tax": case "fee": case "withdrawal": return -raw;
    case "sell":
      if ((tx.assetType ?? "").toLowerCase() === "bond" || /redeem/i.test(tx.source ?? "")) return Math.abs(tx.gross - tx.fee);
      return null;
    default: return null;
  }
}

export function cashflowEvents(
  transactions: Transaction[],
  portfolios: Portfolio[],
  opts: { portfolioId?: string | null; year?: number | null } = {},
): CashflowEvent[] {
  const names = new Map(portfolios.map((p) => [p.id, p.name]));
  const out: CashflowEvent[] = [];
  for (const tx of transactions) {
    if (opts.portfolioId && tx.portfolioId !== opts.portfolioId) continue;
    if (opts.year && tx.date.getFullYear() !== opts.year) continue;
    const amount = signedCashAmount(tx);
    if (amount === null || !(Math.abs(amount) > 0.0000001)) continue;
    out.push({ id: tx.id, date: tx.date, type: tx.typeRaw, symbol: tx.symbol, name: tx.name, amount, currency: tx.currency, portfolioName: (tx.portfolioId && names.get(tx.portfolioId)) || "—" });
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function cashflowTotalByCurrency(events: CashflowEvent[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const e of events) m[e.currency] = (m[e.currency] ?? 0) + e.amount;
  return m;
}

// ---------------------------------------------------------------- tax report

export interface TaxYearSummary {
  year: number;
  realizedGains: number;
  realizedLosses: number;
  capitalProceeds: number;
  capitalCosts: number;
  dividends: number;
  interest: number;
  fees: number;
  currency: string;
  includedPortfolioCount: number;
  excludedTaxExemptCount: number;
  netCapital: number;
  estimatedBelkaTax: number;
}

export interface TaxSellLine { id: string; date: Date; symbol: string; name: string; portfolioName: string; quantity: number; proceeds: number; cost: number; pnl: number; currency: string }
export interface TaxIncomeLine { id: string; date: Date; kind: string; symbol: string; portfolioName: string; amount: number; currency: string }
export interface TaxYearReport { summary: TaxYearSummary; sells: TaxSellLine[]; incomeLines: TaxIncomeLine[] }

export type RateOnDate = (currency: string, date: Date) => number;

export function isTaxExemptAccount(p: Portfolio | null | undefined): boolean {
  const name = p?.name.toUpperCase();
  if (!name) return false;
  return name.includes("IKZE") || name.includes("XTB IKE") || name.startsWith("IKE ") || name.startsWith("IKE(") || /\bIKE\b/.test(name);
}

interface TaxLot { quantity: number; cost: number; buyDate: Date }

function consumeFifo(lots: TaxLot[], quantity: number): { cost: number; remaining: TaxLot[] } {
  let remainingQty = quantity;
  let cost = 0;
  const next: TaxLot[] = [];
  for (const lot of lots) {
    if (!(remainingQty > 1e-12)) { next.push(lot); continue; }
    if (lot.quantity <= remainingQty + 1e-12) {
      cost += lot.cost;
      remainingQty -= lot.quantity;
    } else {
      const share = remainingQty / lot.quantity;
      cost += lot.cost * share;
      next.push({ quantity: lot.quantity - remainingQty, cost: lot.cost * (1 - share), buyDate: lot.buyDate });
      remainingQty = 0;
    }
  }
  return { cost, remaining: next };
}

/** Converts to PLN-equivalent; like the native app, a non-PLN report currency is not cross-converted. */
function convertAmount(amount: number, from: string, to: string, rateFromToPLN: number): number {
  const f = normalizeCurrency(from);
  if (f === normalizeCurrency(to) || f === "PLN") return amount;
  return rateFromToPLN > 0 ? amount * rateFromToPLN : amount;
}

/** FIFO tax report using the full history for cost basis; only events within `year` are reported. */
export function taxReport(args: {
  year: number;
  transactions: Transaction[];
  portfolios?: Portfolio[];
  reportCurrency?: string;
  includeTaxExemptAccounts?: boolean;
  portfolioIds?: Set<string> | null;
  rateOnDate: RateOnDate;
}): TaxYearReport {
  const { year, transactions, rateOnDate } = args;
  const portfolios = args.portfolios ?? [];
  const reportCcy = (args.reportCurrency ?? "PLN").toUpperCase();
  const includeExempt = args.includeTaxExemptAccounts ?? false;
  const byId = new Map(portfolios.map((p) => [p.id, p]));
  const exemptIds = new Set(portfolios.filter(isTaxExemptAccount).map((p) => p.id));
  for (const tx of transactions) if (tx.portfolioId && isTaxExemptAccount(byId.get(tx.portfolioId))) exemptIds.add(tx.portfolioId);

  const filtered = transactions.filter((tx) => {
    if (args.portfolioIds && !(tx.portfolioId && args.portfolioIds.has(tx.portfolioId))) return false;
    if (!includeExempt && tx.portfolioId && exemptIds.has(tx.portfolioId)) return false;
    return true;
  });
  const includedIds = new Set(filtered.map((t) => t.portfolioId).filter(Boolean));
  const ordered = [...filtered].sort((a, b) => a.date.getTime() - b.date.getTime());
  const lots = new Map<string, TaxLot[]>();
  const sells: TaxSellLine[] = [];
  const incomeLines: TaxIncomeLine[] = [];
  let yearFees = 0, yearDiv = 0, yearInt = 0;

  for (const tx of ordered) {
    const ccy = normalizeCurrency(tx.currency);
    const rate = rateOnDate(ccy, tx.date);
    const toReport = (v: number) => convertAmount(v, ccy, reportCcy, rate);
    const inYear = tx.date.getFullYear() === year;
    if (inYear) yearFees += toReport(tx.fee);
    const portfolioName = (tx.portfolioId && byId.get(tx.portfolioId)?.name) || "—";
    const symbol = (tx.symbol ?? "").toUpperCase();
    const name = tx.name ?? symbol;
    const key = `${tx.portfolioId ?? ""}|${symbol}|${ccy}`;

    switch (txType(tx)) {
      case "buy": {
        const qty = Math.abs(tx.quantity ?? 0);
        if (!(qty > 0)) break;
        lots.set(key, [...(lots.get(key) ?? []), { quantity: qty, cost: toReport(tx.gross + tx.fee), buyDate: tx.date }]);
        break;
      }
      case "sell": {
        const qty = Math.abs(tx.quantity ?? 0);
        if (!(qty > 0)) break;
        const proceeds = toReport(Math.max(0, tx.gross - tx.fee));
        const { cost, remaining } = consumeFifo(lots.get(key) ?? [], qty);
        lots.set(key, remaining);
        if (inYear) sells.push({ id: tx.id, date: tx.date, symbol: symbol || "—", name, portfolioName, quantity: qty, proceeds, cost, pnl: proceeds - cost, currency: reportCcy });
        break;
      }
      case "dividend":
      case "interest": {
        const amount = toReport(Math.abs(tx.cashDelta ?? tx.gross));
        if (!inYear) break;
        const kind = txType(tx);
        if (kind === "dividend") yearDiv += amount; else yearInt += amount;
        incomeLines.push({ id: tx.id, date: tx.date, kind, symbol: symbol || "—", portfolioName, amount, currency: reportCcy });
        break;
      }
      default:
        break;
    }
  }

  const gains = sells.reduce((s, x) => s + Math.max(0, x.pnl), 0);
  const losses = sells.reduce((s, x) => s + Math.min(0, x.pnl), 0);
  const net = gains + losses;
  return {
    summary: {
      year, realizedGains: gains, realizedLosses: losses,
      capitalProceeds: sells.reduce((s, x) => s + x.proceeds, 0), capitalCosts: sells.reduce((s, x) => s + x.cost, 0),
      dividends: yearDiv, interest: yearInt, fees: yearFees, currency: reportCcy,
      includedPortfolioCount: includedIds.size, excludedTaxExemptCount: includeExempt ? 0 : exemptIds.size,
      netCapital: net, estimatedBelkaTax: Math.max(0, net) * 0.19,
    },
    sells: sells.sort((a, b) => b.date.getTime() - a.date.getTime()),
    incomeLines: incomeLines.sort((a, b) => b.date.getTime() - a.date.getTime()),
  };
}

/** Flat FX snapshot for every date (back-compat helper used by tests and the UI before history is loaded). */
export function flatRateProvider(ratesToPLN: Record<string, number>): RateOnDate {
  return (ccy) => {
    const code = normalizeCurrency(ccy);
    return code === "PLN" ? 1 : (ratesToPLN[code] ?? 0);
  };
}

export function taxReportCsv(report: TaxYearReport): string {
  const s = report.summary;
  const clean = (v: string) => v.replaceAll(",", " ");
  const lines = [
    "# summary",
    "year,currency,proceeds,costs,net_capital,gains,losses,dividends,interest,fees,est_belka_19pct,included_portfolios,excluded_ike_ikze",
    [s.year, s.currency, s.capitalProceeds, s.capitalCosts, s.netCapital, s.realizedGains, s.realizedLosses, s.dividends, s.interest, s.fees, s.estimatedBelkaTax, s.includedPortfolioCount, s.excludedTaxExemptCount].join(","),
    "",
    "# sells",
    "date,symbol,name,portfolio,quantity,proceeds,cost,pnl,currency",
    ...report.sells.map((r) => [dayKey(r.date), r.symbol, clean(r.name), clean(r.portfolioName), r.quantity, r.proceeds, r.cost, r.pnl, r.currency].join(",")),
    "",
    "# income",
    "date,kind,symbol,portfolio,amount,currency",
    ...report.incomeLines.map((r) => [dayKey(r.date), r.kind, r.symbol, clean(r.portfolioName), r.amount, r.currency].join(",")),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------- bond maturity calendar

export interface BondMaturityEntry {
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  name: string;
  currency: string;
  quantity: number;
  purchaseDate: Date;
  maturityDate: Date;
  unitValue: number;
  totalValue: number;
  terms: BondTerms;
  isPast: boolean;
  year: number;
}

export function bondMaturityLots(transactions: Transaction[], portfolios: Portfolio[], asOf: Date = new Date()): BondMaturityEntry[] {
  const names = new Map(portfolios.map((p) => [p.id, p.name]));
  interface Lot { qty: number; purchaseDate: Date; terms: BondTerms; name: string; currency: string; portfolioId: string }
  const lots: Lot[] = [];
  const bondTx = transactions
    .filter((tx) => resolveBondTerms({ symbol: tx.symbol, name: tx.name, notes: tx.notes, assetType: tx.assetType }) !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const tx of bondTx) {
    const terms = resolveBondTerms({ symbol: tx.symbol, name: tx.name, notes: tx.notes, assetType: tx.assetType });
    const symbol = tx.symbol?.toUpperCase();
    if (!tx.portfolioId || !symbol || !terms) continue;
    const qty = Math.abs(tx.quantity ?? 0);
    if (!(qty > 0)) continue;
    if (txType(tx) === "buy") {
      lots.push({ qty, purchaseDate: tx.date, terms, name: tx.name ?? terms.code, currency: tx.currency, portfolioId: tx.portfolioId });
    } else if (txType(tx) === "sell") {
      let remaining = qty;
      for (let i = 0; remaining > 0.0000001 && i < lots.length; ) {
        const lot = lots[i]!;
        if (lot.portfolioId === tx.portfolioId && (lot.terms.code === terms.code || lot.name === (tx.name ?? ""))) {
          const take = Math.min(lot.qty, remaining);
          lot.qty -= take;
          remaining -= take;
          if (lot.qty <= 0.0000001) { lots.splice(i, 1); continue; }
        }
        i += 1;
      }
    }
  }
  const today = startOfDay(new Date());
  return lots
    .filter((l) => l.qty > 0.0000001)
    .map((l) => {
      const maturity = maturityDate(l.terms, l.purchaseDate);
      const unit = bondCurrentPrice(l.terms, l.purchaseDate, asOf);
      return {
        portfolioId: l.portfolioId, portfolioName: names.get(l.portfolioId) ?? "—", symbol: l.terms.code, name: l.name, currency: l.currency,
        quantity: l.qty, purchaseDate: l.purchaseDate, maturityDate: maturity, unitValue: unit, totalValue: unit * l.qty, terms: l.terms,
        isPast: maturity.getTime() < today.getTime(), year: maturity.getFullYear(),
      };
    })
    .sort((a, b) => a.maturityDate.getTime() - b.maturityDate.getTime());
}

export function bondsGroupedByYear(entries: BondMaturityEntry[]): { year: number; items: BondMaturityEntry[] }[] {
  const upcoming = entries.filter((e) => !e.isPast);
  const years = [...new Set(upcoming.map((e) => e.year))].sort((a, b) => a - b);
  return years.map((year) => ({ year, items: upcoming.filter((e) => e.year === year).sort((a, b) => a.maturityDate.getTime() - b.maturityDate.getTime()) }));
}

// ---------------------------------------------------------------- price alerts + allocation drift

export function matchingAlerts(quotes: Quote[], alerts: PriceAlert[]): PriceAlert[] {
  const bySymbol = new Map<string, Quote[]>();
  for (const q of quotes) bySymbol.set(q.symbol.toUpperCase(), [...(bySymbol.get(q.symbol.toUpperCase()) ?? []), q]);
  const matched: PriceAlert[] = [];
  for (const alert of alerts) {
    if (!alert.enabled) continue;
    const list = bySymbol.get(alert.symbol.toUpperCase());
    const quote = list?.find((q) => q.currency.toUpperCase() === alert.currency) ?? list?.[0];
    if (!quote) continue;
    if (alert.above ? quote.price >= alert.targetPrice : quote.price <= alert.targetPrice) matched.push(alert);
  }
  return matched;
}

/** Alerts that should notify: at most once per day unless `force`. Does not mutate cooldown. */
export function evaluateAlerts(quotes: Quote[], alerts: PriceAlert[], force = false, now: Date = new Date()): PriceAlert[] {
  return matchingAlerts(quotes, alerts).filter((a) => force || !(a.lastTriggeredAt && dayKey(a.lastTriggeredAt) === dayKey(now)));
}

export interface DriftAlertItem { assetType: string; actualPct: number; targetPct: number; driftPct: number }

export function allocationDriftItems(scope: Pick<ScopeResult, "totalValueBase" | "allocationByType">, targets: Record<string, number>, thresholdPct: number): DriftAlertItem[] {
  if (!(thresholdPct > 0) || !(scope.totalValueBase > 0)) return [];
  const items: DriftAlertItem[] = [];
  for (const [assetType, targetPct] of Object.entries(targets)) {
    if (!(targetPct > 0)) continue;
    const actualPct = ((scope.allocationByType[assetType] ?? 0) / scope.totalValueBase) * 100;
    const driftPct = Math.abs(actualPct - targetPct);
    if (driftPct >= thresholdPct) items.push({ assetType, actualPct, targetPct, driftPct });
  }
  return items.sort((a, b) => (a.assetType < b.assetType ? -1 : 1));
}

// ---------------------------------------------------------------- transactions CSV

export const TRANSACTION_CSV_HEADERS = [
  "date", "timestamp", "portfolio", "account", "externalId", "type", "symbol", "name",
  "assetType", "quantity", "price", "gross", "fee", "cashDelta", "currency", "source", "notes",
];

const csvEscape = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const csvNum = (v: number | null) => (v === null ? "" : Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(8))));

export function exportTransactionsCsv(transactions: Transaction[], portfolios: Portfolio[]): string {
  const names = new Map(portfolios.map((p) => [p.id, p.name]));
  const lines = [TRANSACTION_CSV_HEADERS.join(",")];
  for (const tx of [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const iso = tx.date.toISOString().replace(/\.\d{3}Z$/, "Z");
    const row = [
      iso.slice(0, 10), iso, (tx.portfolioId && names.get(tx.portfolioId)) || "", "", tx.externalId ?? "", tx.typeRaw,
      tx.symbol ?? "", tx.name ?? "", tx.assetType ?? "", csvNum(tx.quantity), csvNum(tx.price), csvNum(tx.gross), csvNum(tx.fee),
      csvNum(tx.cashDelta), tx.currency, tx.source ?? "", tx.notes ?? "",
    ];
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

export const TEMPLATE_CSV_HEADERS = ["date", "type", "symbol", "name", "quantity", "price", "gross", "fee", "currency", "cash_delta", "external_id", "notes"];

export function templateCsv(): string {
  return [TEMPLATE_CSV_HEADERS.join(","), ["2024-01-15", "buy", "AAPL.US", "Apple", "10", "180.5", "1805", "0", "USD", "", "", "example"].map(csvEscape).join(",")].join("\n");
}
