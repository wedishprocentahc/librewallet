import { SUPPORTED_ASSET_TYPES } from "../core/assetType.ts";
import { BackupError, exportBackup, importBackup } from "../core/backup.ts";
import { BOND_NOMINAL, BOND_PRESETS, bondCurrentPrice, type BondTerms, maturityDate, termsFromPreset } from "../core/bonds.ts";
import type { HistoryRow, ScopeResult } from "../core/calculator.ts";
import { convertToPLN, normalizeCurrency, type RatesToPLN } from "../core/currency.ts";
import { dayKey, startOfDay } from "../core/dates.ts";
import { commitImport } from "../core/import/commit.ts";
import { filterNewImports, type ImportedTransaction, importFile, importFingerprint } from "../core/import/importers.ts";
import { buildAgentFeed, holdingsResponse, portfolioResponse } from "../core/integration.ts";
import { fetchHistory, type FetchFn, fetchNbpHistory, fetchNbpRates, fetchQuote, mergeRates, mostCommonCurrencyBySymbol, PricingError, rateToPLNOn } from "../core/pricing.ts";
import {
  allocationDriftItems, allPeriodReturns, bondMaturityLots, bondsGroupedByYear, cashflowEvents, cashflowTotalByCurrency, evaluateAlerts,
  exportTransactionsCsv, isTaxExemptAccount, matchingAlerts, taxReport, taxReportCsv, templateCsv,
} from "../core/reports.ts";
import {
  actualPct, attachBenchmark, benchmarkOptions, benchmarkSeries, rebalanceSuggestions, scopedPortfolios, scopeHistory, scopeResult,
  type ScopeSel, setTargetPct, targetPercentages,
} from "../core/scope.ts";
import type { SymbolMapping } from "../core/symbols.ts";
import { emptyDataset, newId, type Dataset, type PriceAlert, type Transaction, TRANSACTION_TYPES } from "../core/types.ts";
import type { Store } from "./store.ts";

export interface Settings {
  language: "pl" | "en";
  autoRefreshMinutes: number;
  fxOverrides: Record<string, number>;
  allocationDriftPct: number;
  alertDriftScope: ScopeSel;
  symbolMappings: SymbolMapping[];
  selectedBenchmark: string;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "pl", autoRefreshMinutes: 30, fxOverrides: {}, allocationDriftPct: 5, alertDriftScope: { kind: "all" }, symbolMappings: [], selectedBenchmark: "",
};

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Histories = Record<string, { date: Date; close: number }[]>;
interface QuoteMeta { provider: string; providerSymbol: string; currency: string; asOf: string }
export interface AppNotification { id: string; kind: "price" | "drift"; title: string; body: string; at: string }

const USER_AGENT_FETCH: FetchFn = async (url, init) => {
  const res = await fetch(url, { headers: init?.headers, signal: AbortSignal.timeout(20_000) });
  return { ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> };
};

export function parseScope(s: string | null | undefined): ScopeSel {
  if (!s || s === "all") return { kind: "all" };
  const [kind, id] = s.split(":");
  if ((kind === "group" || kind === "portfolio") && id) return { kind, id };
  throw new HttpError(400, `Nieprawidłowy zakres: ${s}`);
}

const num = (v: unknown, what: string): number => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new HttpError(400, `Nieprawidłowa liczba: ${what}`);
  return n;
};
const optNum = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : num(v, "value"));
const optStr = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export class Service {
  readonly store: Store;
  readonly version: string;
  data: Dataset;
  settings: Settings;
  nbpRates: RatesToPLN = { PLN: 1 };
  histories: Histories = {};
  quoteMeta: Record<string, QuoteMeta> = {};
  benchmarkHistories: Record<string, { date: Date; close: number }[]> = {};
  fxHistory: Record<string, Record<string, number>> = {};
  notifications: AppNotification[] = [];
  private previews = new Map<string, { items: ImportedTransaction[]; source: string | null; createdAt: number }>();
  private fetchFn: FetchFn;
  private lastRefresh: Date | null = null;

  constructor(store: Store, opts: { version?: string; fetchFn?: FetchFn } = {}) {
    this.store = store;
    this.version = opts.version ?? "0.0.0";
    this.fetchFn = opts.fetchFn ?? USER_AGENT_FETCH;
    this.data = store.loadDataset();
    this.settings = { ...DEFAULT_SETTINGS, ...store.getSetting<Partial<Settings>>("app", {}) };
    this.quoteMeta = store.getSetting("quoteMeta", {});
    this.nbpRates = store.getCache<RatesToPLN>("nbpRates")?.value ?? { PLN: 1 };
    this.histories = reviveHistories(store.getCache<Record<string, [number, number][]>>("histories")?.value ?? {});
    this.benchmarkHistories = reviveHistories(store.getCache<Record<string, [number, number][]>>("benchmarkHistories")?.value ?? {});
    this.fxHistory = store.getCache<Record<string, Record<string, number>>>("fxHistory")?.value ?? {};
  }

  // ---------------------------------------------------------------- plumbing
  get rates(): RatesToPLN {
    return mergeRates(this.nbpRates, this.settings.fxOverrides);
  }
  private ctx() {
    return { data: this.data, rates: this.rates, histories: this.histories };
  }
  persist(): void {
    this.store.saveDataset(this.data);
  }
  private saveSettings(): void {
    this.store.setSetting("app", this.settings);
  }
  private portfolioById(id: string | null | undefined) {
    return this.data.portfolios.find((p) => p.id === id);
  }
  private requirePortfolio(id: unknown) {
    const p = typeof id === "string" ? this.portfolioById(id) : undefined;
    if (!p) throw new HttpError(400, "Wybierz portfel.");
    return p;
  }
  /** Daily safety backup of the whole dataset (rotating, next to the database). */
  ensureDailyBackup(now: Date = new Date()): string | null {
    const last = this.store.latestBackup("auto");
    if (last && dayKey(last.at) === dayKey(now)) return null;
    if (this.data.portfolios.length === 0 && this.data.transactions.length === 0) return null;
    return this.store.writeBackup(this.data, "auto", 14, now);
  }

  // ---------------------------------------------------------------- bootstrap / settings
  bootstrap() {
    const d = this.data;
    return {
      version: this.version,
      dataDir: this.store.dir,
      settings: this.settings,
      groups: d.groups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
      portfolios: d.portfolios.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      counts: { transactions: d.transactions.length, alerts: d.alerts.length },
      assetTypes: SUPPORTED_ASSET_TYPES,
      transactionTypes: TRANSACTION_TYPES,
      bondPresets: BOND_PRESETS,
      benchmarks: benchmarkOptions().map(({ id, label }) => ({ id, label })),
      fxRates: this.rates,
      lastRefresh: this.lastRefresh?.toISOString() ?? null,
    };
  }

  updateSettings(patch: Record<string, unknown>) {
    const s = this.settings;
    if (patch.language === "pl" || patch.language === "en") s.language = patch.language;
    if (patch.autoRefreshMinutes !== undefined) s.autoRefreshMinutes = Math.max(0, Math.trunc(num(patch.autoRefreshMinutes, "autoRefreshMinutes")));
    if (patch.allocationDriftPct !== undefined) s.allocationDriftPct = Math.max(0, num(patch.allocationDriftPct, "allocationDriftPct"));
    if (patch.selectedBenchmark !== undefined) s.selectedBenchmark = String(patch.selectedBenchmark);
    if (patch.alertDriftScope !== undefined) s.alertDriftScope = parseScope(typeof patch.alertDriftScope === "string" ? patch.alertDriftScope : scopeToString(patch.alertDriftScope as ScopeSel));
    if (patch.fxOverrides && typeof patch.fxOverrides === "object") {
      s.fxOverrides = Object.fromEntries(Object.entries(patch.fxOverrides as Record<string, unknown>).map(([k, v]) => [k.toUpperCase(), num(v, k)]).filter(([, v]) => (v as number) > 0));
    }
    if (Array.isArray(patch.symbolMappings)) {
      s.symbolMappings = (patch.symbolMappings as SymbolMapping[]).map((m) => ({ id: m.id.trim().toUpperCase(), provider: m.provider === "stooq" ? "stooq" : "yahoo", providerSymbol: m.providerSymbol.trim() })).filter((m) => m.id && m.providerSymbol);
    }
    this.saveSettings();
    return this.settings;
  }

  // ---------------------------------------------------------------- views
  dashboard(scope: ScopeSel, benchmarkId: string) {
    const ctx = this.ctx();
    const result = scopeResult(ctx, scope);
    const rows: HistoryRow[] = scopeHistory(ctx, scope);
    const cfg = benchmarkOptions(result.baseCurrency).find((o) => o.id === benchmarkId && o.id !== "");
    const bench = cfg ? attachBenchmark(rows, benchmarkSeries(cfg, this.benchmarkHistories, result.baseCurrency, this.rates)) : rows.map(() => null);
    const portfolios = scopedPortfolios(this.data, scope);
    const comparison = portfolios.map((p) => {
      const r = scopeResult(ctx, { kind: "portfolio", id: p.id });
      return { id: p.id, name: p.name, colorHex: p.colorHex, value: r.totalValueBase, returnPct: r.returnPct, currency: r.baseCurrency };
    });
    const scoped = new Set(portfolios.map((p) => p.id));
    const markers = this.data.transactions
      .filter((t) => t.portfolioId && scoped.has(t.portfolioId) && ["buy", "sell", "deposit", "withdrawal", "dividend"].includes(t.typeRaw))
      .map((t) => ({ dayKey: dayKey(t.date), type: t.typeRaw, symbol: t.symbol, amount: t.cashDelta ?? t.gross, currency: t.currency }));
    return {
      scope: this.scopeSummary(result, scope),
      history: rows.map((r, i) => ({ dayKey: r.dayKey, value: r.value, invested: r.invested, positions: r.positions, cash: r.cash, benchmark: bench[i] })),
      profitBars: result.positions.filter((p) => Math.abs(p.totalProfit) > 0.0001).map((p) => ({ symbol: p.symbol, profit: p.totalProfit })).sort((a, b) => b.profit - a.profit),
      comparison,
      markers,
      hasBenchmark: bench.some((b) => b !== null),
      benchmarkLoaded: cfg ? this.isBenchmarkLoaded(cfg.id) : true,
      quoteStatus: this.quoteStatus(),
    };
  }

  private scopeSummary(r: ScopeResult, scope: ScopeSel) {
    return {
      scope: scopeToString(scope),
      baseCurrency: r.baseCurrency, hasCashOperations: r.hasCashOperations,
      totalValue: r.totalValueBase, positionValue: r.positionValueBase, cashValue: r.cashValueBase,
      totalProfit: r.totalProfitBase, netInvested: r.netInvestedBase, returnPct: r.returnPct,
      allocationByType: r.allocationByType, allocationByCurrency: r.allocationByCurrency, cashRows: r.cashRows,
    };
  }

  private quoteStatus() {
    const quotes = this.data.quotes;
    const newest = quotes.reduce<Date | null>((m, q) => (!m || q.asOf > m ? q.asOf : m), null);
    return { count: quotes.length, newest: newest?.toISOString() ?? null, lastRefresh: this.lastRefresh?.toISOString() ?? null };
  }

  positions(scope: ScopeSel) {
    const ctx = this.ctx();
    const result = scopeResult(ctx, scope);
    const quoteBySymbol = new Map(this.data.quotes.map((q) => [q.symbol.toUpperCase(), q]));
    const portfolios = scopedPortfolios(this.data, scope);
    const perPortfolio = portfolios.length === 1 ? [result] : portfolios.map((p) => scopeResult(ctx, { kind: "portfolio", id: p.id }));
    const rows = perPortfolio.flatMap((r) => r.positions).map((p) => {
      const q = quoteBySymbol.get(p.symbol);
      return {
        ...p,
        profitPct: p.invested > 0.0001 ? (p.profit / p.invested) * 100 : 0,
        returns: allPeriodReturns(p.symbol, p.currentPrice, this.histories),
        quoteAsOf: q?.asOf.toISOString() ?? null,
        priceSource: p.assetType === "bond" && !q ? "bond" : q ? "quote" : "cost",
        meta: this.quoteMeta[p.symbol] ?? null,
      };
    });
    return { scope: this.scopeSummary(result, scope), positions: rows.sort((a, b) => b.currentValue - a.currentValue) };
  }

  transactions(scope: ScopeSel, q: { search?: string; type?: string; limit?: number }) {
    const ids = new Set(scopedPortfolios(this.data, scope).map((p) => p.id));
    const names = new Map(this.data.portfolios.map((p) => [p.id, p.name]));
    const needle = (q.search ?? "").trim().toLowerCase();
    const rows = this.data.transactions
      .filter((t) => (scope.kind === "all" ? true : t.portfolioId !== null && ids.has(t.portfolioId)))
      .filter((t) => !q.type || t.typeRaw === q.type)
      .filter((t) => !needle || [t.symbol, t.name, t.notes, t.externalId, t.typeRaw].some((x) => (x ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    const limited = q.limit ? rows.slice(0, q.limit) : rows;
    return { total: rows.length, rows: limited.map((t) => ({ ...t, date: t.date.toISOString(), portfolioName: (t.portfolioId && names.get(t.portfolioId)) || "" })) };
  }

  rebalance(scope: ScopeSel) {
    const result = scopeResult(this.ctx(), scope);
    const targets = targetPercentages(this.data, scope);
    return {
      scope: this.scopeSummary(result, scope),
      targets,
      rows: SUPPORTED_ASSET_TYPES.map((k) => ({ assetType: k, targetPct: targets[k] ?? 0, actualPct: actualPct(k, result) })),
      suggestions: rebalanceSuggestions(result, targets),
    };
  }

  setTarget(scope: ScopeSel, assetType: string, pct: number) {
    if (!(SUPPORTED_ASSET_TYPES as readonly string[]).includes(assetType)) throw new HttpError(400, "Nieznany typ aktywa.");
    setTargetPct(this.data, scope, assetType, Math.min(100, Math.max(0, pct)));
    this.persist();
  }

  bonds() {
    const lots = bondMaturityLots(this.data.transactions, this.data.portfolios);
    return {
      presets: BOND_PRESETS,
      nominal: BOND_NOMINAL,
      held: lots.map((l) => ({ ...l, key: `${l.portfolioId}|${l.symbol}|${dayKey(l.purchaseDate)}`, purchaseDate: l.purchaseDate.toISOString(), maturityDate: l.maturityDate.toISOString() })),
      byYear: bondsGroupedByYear(lots).map((g) => ({ year: g.year, items: g.items.map((l) => ({ ...l, key: `${l.portfolioId}|${l.symbol}|${dayKey(l.purchaseDate)}`, purchaseDate: l.purchaseDate.toISOString(), maturityDate: l.maturityDate.toISOString() })) })),
    };
  }

  /** Same notes format as the native bonds screen, so BondPricing resolves terms identically. */
  addBond(body: Record<string, unknown>) {
    const portfolio = this.requirePortfolio(body.portfolioId);
    const preset = BOND_PRESETS.find((p) => p.code === body.preset);
    if (!preset) throw new HttpError(400, "Wybierz preset obligacji.");
    const count = Math.trunc(num(body.count, "count"));
    if (!(count > 0)) throw new HttpError(400, "Podaj poprawną liczbę nominałów.");
    const base = termsFromPreset(preset);
    const code = optStr(body.symbol)?.toUpperCase() ?? base.code;
    const terms: BondTerms = {
      ...base, code,
      termMonths: body.termMonths === undefined || body.termMonths === "" ? base.termMonths : Math.trunc(num(body.termMonths, "termMonths")),
      firstYearRate: body.rate === undefined || body.rate === "" ? base.firstYearRate : num(body.rate, "rate"),
      margin: body.margin === undefined || body.margin === "" ? base.margin : num(body.margin, "margin"),
    };
    const date = body.date ? new Date(String(body.date)) : new Date();
    if (Number.isNaN(date.getTime())) throw new HttpError(400, "Nieprawidłowa data.");
    let notes = `Bond ${terms.code} term=${terms.termMonths}m rate=${terms.firstYearRate}% margin=${terms.margin} index=${terms.indexation} cap=${terms.capitalization} fee=${terms.earlyRedemptionFee}`;
    if (body.maturity) notes += ` maturity=${String(body.maturity).slice(0, 10)}`;
    const tx = this.newTx({
      portfolioId: portfolio.id, date, typeRaw: "buy", symbol: terms.code, name: preset.name, quantity: count, price: BOND_NOMINAL, gross: count * BOND_NOMINAL,
      currency: portfolio.baseCurrency, notes, source: "Bond preset", assetType: "bond",
    });
    this.data.transactions.push(tx);
    this.persist();
    return { id: tx.id, estimatedValue: count * bondCurrentPrice(terms, date), maturity: maturityDate(terms, date).toISOString() };
  }

  redeemBond(body: Record<string, unknown>) {
    const lots = bondMaturityLots(this.data.transactions, this.data.portfolios);
    const entry = lots.find((l) => `${l.portfolioId}|${l.symbol}|${dayKey(l.purchaseDate)}` === body.key);
    if (!entry) throw new HttpError(400, "Wybierz serię do wykupu.");
    const qty = num(body.quantity, "quantity");
    if (!(qty > 0)) throw new HttpError(400, "Podaj ilość.");
    if (qty > entry.quantity + 0.0000001) throw new HttpError(400, `Niewystarczająca ilość (max ${entry.quantity}).`);
    const date = body.date ? new Date(String(body.date)) : new Date();
    const price = body.price === undefined || body.price === "" ? bondCurrentPrice(entry.terms, entry.purchaseDate, date) : num(body.price, "price");
    const fee = Math.abs(body.fee === undefined || body.fee === "" ? 0 : num(body.fee, "fee"));
    this.data.transactions.push(this.newTx({
      portfolioId: entry.portfolioId, date, typeRaw: "sell", symbol: entry.symbol, name: entry.name, quantity: qty, price, gross: qty * price, fee,
      currency: entry.currency, notes: "Przedterminowy wykup", source: "bond-redemption", assetType: "bond",
    }));
    this.persist();
  }

  cashflow(scope: ScopeSel, year: number | null) {
    const ids = scope.kind === "all" ? null : new Set(scopedPortfolios(this.data, scope).map((p) => p.id));
    const txs = ids ? this.data.transactions.filter((t) => t.portfolioId && ids.has(t.portfolioId)) : this.data.transactions;
    const events = cashflowEvents(txs, this.data.portfolios, { year });
    const years = [...new Set(txs.map((t) => t.date.getFullYear()))].sort((a, b) => b - a);
    return { years, events: events.map((e) => ({ ...e, date: e.date.toISOString() })), totals: cashflowTotalByCurrency(events) };
  }

  async tax(opts: { year: number; scope: ScopeSel; includeExempt: boolean }) {
    const portfolios = scopedPortfolios(this.data, opts.scope);
    const ids = new Set(portfolios.map((p) => p.id));
    const txs = this.data.transactions.filter((t) => t.portfolioId && ids.has(t.portfolioId));
    await this.ensureFxHistory(txs);
    const report = taxReport({
      year: opts.year, transactions: this.data.transactions, portfolios: this.data.portfolios, includeTaxExemptAccounts: opts.includeExempt,
      portfolioIds: opts.scope.kind === "all" ? null : ids,
      rateOnDate: (ccy, date) => rateToPLNOn(ccy, date, this.fxHistory, this.rates, this.settings.fxOverrides),
    });
    const years = [...new Set(this.data.transactions.map((t) => t.date.getFullYear()))].sort((a, b) => b - a);
    return {
      years, summary: report.summary,
      sells: report.sells.map((s) => ({ ...s, date: s.date.toISOString() })),
      incomeLines: report.incomeLines.map((s) => ({ ...s, date: s.date.toISOString() })),
      exemptPortfolios: this.data.portfolios.filter(isTaxExemptAccount).map((p) => p.name),
      csv: taxReportCsv(report),
    };
  }

  private async ensureFxHistory(txs: Transaction[]) {
    const byCcy = new Map<string, Date>();
    for (const t of txs) {
      const c = normalizeCurrency(t.currency);
      if (c === "PLN") continue;
      const cur = byCcy.get(c);
      if (!cur || t.date < cur) byCcy.set(c, t.date);
    }
    const today = new Date();
    let changed = false;
    for (const [c, from] of byCcy) {
      const have = this.fxHistory[c];
      const keys = have ? Object.keys(have).sort() : [];
      const covered = keys.length > 0 && keys[0]! <= dayKey(new Date(from.getTime() + 10 * 86400_000)) && keys[keys.length - 1]! >= dayKey(new Date(today.getTime() - 10 * 86400_000));
      if (covered) continue;
      const fetched = await fetchNbpHistory(this.fetchFn, c, new Date(from.getTime() - 10 * 86400_000), today);
      if (Object.keys(fetched).length > 0) { this.fxHistory[c] = { ...have, ...fetched }; changed = true; }
    }
    if (changed) this.store.setCache("fxHistory", this.fxHistory);
  }

  // ---------------------------------------------------------------- alerts
  alerts() {
    const result = scopeResult(this.ctx(), this.settings.alertDriftScope);
    const targets = targetPercentages(this.data, this.settings.alertDriftScope);
    const drift = allocationDriftItems(result, targets, this.settings.allocationDriftPct);
    const matching = new Set(matchingAlerts(this.data.quotes, this.data.alerts).map((a) => a.id));
    const quotes = new Map(this.data.quotes.map((q) => [q.symbol.toUpperCase(), q]));
    const symbols = [...new Set(this.data.transactions.map((t) => t.symbol?.toUpperCase()).filter((s): s is string => !!s))].sort();
    return {
      alerts: this.data.alerts.map((a) => ({ ...a, lastTriggeredAt: a.lastTriggeredAt?.toISOString() ?? null, breached: matching.has(a.id), lastPrice: quotes.get(a.symbol.toUpperCase())?.price ?? null })),
      drift, driftThreshold: this.settings.allocationDriftPct, driftScope: scopeToString(this.settings.alertDriftScope), symbols,
    };
  }

  addAlert(body: Record<string, unknown>) {
    const symbol = optStr(body.symbol)?.toUpperCase();
    if (!symbol) throw new HttpError(400, "Podaj symbol.");
    const alert: PriceAlert = { id: newId(), symbol, currency: (optStr(body.currency) ?? "PLN").toUpperCase(), targetPrice: num(body.targetPrice, "targetPrice"), above: body.above !== false, enabled: true, lastTriggeredAt: null };
    this.data.alerts.push(alert);
    this.persist();
    return alert;
  }

  setAlertEnabled(id: string, enabled: boolean) {
    const a = this.data.alerts.find((x) => x.id === id);
    if (!a) throw new HttpError(404, "Nie ma takiego alertu.");
    a.enabled = enabled;
    this.persist();
  }

  deleteAlert(id: string) {
    this.data.alerts = this.data.alerts.filter((a) => a.id !== id);
    this.persist();
  }

  /** Evaluate price alerts + allocation drift and queue notifications for the UI (price alerts fire at most once a day). */
  checkAlerts(force = false): AppNotification[] {
    const fired: AppNotification[] = [];
    const now = new Date();
    for (const a of evaluateAlerts(this.data.quotes, this.data.alerts, force, now)) {
      a.lastTriggeredAt = now;
      fired.push({ id: newId(), kind: "price", title: "price", body: `${a.symbol} ${a.above ? "≥" : "≤"} ${a.targetPrice} ${a.currency}`, at: now.toISOString() });
    }
    const result = scopeResult(this.ctx(), this.settings.alertDriftScope);
    const today = dayKey(now);
    const seen = this.store.getSetting<{ day: string; assets: string[] }>("driftNotified", { day: "", assets: [] });
    const done = new Set(seen.day === today ? seen.assets : []);
    for (const item of allocationDriftItems(result, targetPercentages(this.data, this.settings.alertDriftScope), this.settings.allocationDriftPct)) {
      if (!force && done.has(item.assetType)) continue;
      done.add(item.assetType);
      fired.push({ id: newId(), kind: "drift", title: "drift", body: `${item.assetType}: ${item.actualPct.toFixed(1)}% vs ${item.targetPct.toFixed(0)}% (Δ${item.driftPct.toFixed(1)}%)`, at: now.toISOString() });
    }
    this.store.setSetting("driftNotified", { day: today, assets: [...done] });
    if (fired.some((n) => n.kind === "price")) this.persist();
    this.notifications.push(...fired);
    return fired;
  }

  drainNotifications(): AppNotification[] {
    const out = this.notifications;
    this.notifications = [];
    return out;
  }

  // ---------------------------------------------------------------- transactions CRUD
  private newTx(over: Partial<Transaction> & Pick<Transaction, "portfolioId" | "date" | "typeRaw" | "gross" | "currency">): Transaction {
    return { id: newId(), symbol: null, name: null, quantity: null, price: null, fee: 0, cashDelta: null, externalId: null, notes: null, source: null, assetType: null, ...over };
  }

  private txFromBody(body: Record<string, unknown>, base?: Transaction): Transaction {
    const portfolio = this.requirePortfolio(body.portfolioId ?? base?.portfolioId);
    const type = String(body.type ?? body.typeRaw ?? base?.typeRaw ?? "");
    if (!(TRANSACTION_TYPES as readonly string[]).includes(type)) throw new HttpError(400, "Nieznany typ operacji.");
    const date = new Date(String(body.date ?? base?.date?.toISOString() ?? ""));
    if (Number.isNaN(date.getTime())) throw new HttpError(400, "Nieprawidłowa data.");
    return this.newTx({
      id: base?.id ?? newId(), portfolioId: portfolio.id, date, typeRaw: type,
      symbol: optStr(body.symbol)?.toUpperCase() ?? null, name: optStr(body.name), quantity: optNum(body.quantity), price: optNum(body.price),
      gross: body.gross === undefined || body.gross === "" ? 0 : num(body.gross, "gross"), fee: body.fee === undefined || body.fee === "" ? 0 : num(body.fee, "fee"),
      currency: normalizeCurrency(optStr(body.currency) ?? portfolio.baseCurrency), cashDelta: optNum(body.cashDelta),
      externalId: base?.externalId ?? null, notes: optStr(body.notes), source: base?.source ?? null, assetType: optStr(body.assetType) ?? base?.assetType ?? null,
    });
  }

  addTransaction(body: Record<string, unknown>) {
    const tx = this.txFromBody(body);
    this.data.transactions.push(tx);
    this.persist();
    return { id: tx.id };
  }

  updateTransaction(id: string, body: Record<string, unknown>) {
    const i = this.data.transactions.findIndex((t) => t.id === id);
    if (i < 0) throw new HttpError(404, "Nie ma takiej operacji.");
    this.data.transactions[i] = this.txFromBody(body, this.data.transactions[i]);
    this.persist();
  }

  deleteTransactions(ids: string[]) {
    const set = new Set(ids);
    const before = this.data.transactions.length;
    this.data.transactions = this.data.transactions.filter((t) => !set.has(t.id));
    this.persist();
    return { deleted: before - this.data.transactions.length };
  }

  deletePosition(body: Record<string, unknown>) {
    const symbol = String(body.symbol ?? "").toUpperCase();
    const currency = String(body.currency ?? "").toUpperCase();
    const scope = parseScope(typeof body.scope === "string" ? body.scope : "all");
    const ids = new Set(scopedPortfolios(this.data, scope).map((p) => p.id));
    const only = typeof body.portfolioId === "string" ? body.portfolioId : null;
    const before = this.data.transactions.length;
    this.data.transactions = this.data.transactions.filter((t) => !(t.portfolioId && ids.has(t.portfolioId) && (!only || t.portfolioId === only) && (t.symbol ?? "").toUpperCase() === symbol && t.currency.toUpperCase() === currency));
    this.persist();
    return { deleted: before - this.data.transactions.length };
  }

  // ---------------------------------------------------------------- portfolios / groups
  createPortfolio(body: Record<string, unknown>) {
    const name = optStr(body.name);
    if (!name) throw new HttpError(400, "Podaj nazwę portfela.");
    const groupId = optStr(body.groupId);
    if (groupId && !this.data.groups.some((g) => g.id === groupId)) throw new HttpError(400, "Nie ma takiej grupy.");
    const p = { id: newId(), groupId, name, baseCurrency: normalizeCurrency(optStr(body.baseCurrency)), colorHex: optStr(body.colorHex) ?? "#176b4d", kindRaw: body.kind === "account" ? "account" : "manual", createdAt: new Date() };
    this.data.portfolios.push(p);
    this.persist();
    return p;
  }

  updatePortfolio(id: string, body: Record<string, unknown>) {
    const p = this.requirePortfolio(id);
    if (body.name !== undefined) p.name = optStr(body.name) ?? p.name;
    if (body.groupId !== undefined) p.groupId = optStr(body.groupId);
    if (body.colorHex !== undefined) p.colorHex = optStr(body.colorHex) ?? p.colorHex;
    if (body.baseCurrency !== undefined) p.baseCurrency = normalizeCurrency(optStr(body.baseCurrency));
    this.persist();
    return p;
  }

  deletePortfolio(id: string) {
    this.data.portfolios = this.data.portfolios.filter((p) => p.id !== id);
    this.data.transactions = this.data.transactions.filter((t) => t.portfolioId !== id);
    this.data.targets = this.data.targets.filter((t) => t.portfolioId !== id);
    this.data.bonds = this.data.bonds.filter((b) => b.portfolioId !== id);
    this.persist();
  }

  createGroup(body: Record<string, unknown>) {
    const name = optStr(body.name);
    if (!name) throw new HttpError(400, "Podaj nazwę grupy.");
    const g = { id: newId(), name, colorHex: optStr(body.colorHex) ?? "#176b4d", createdAt: new Date() };
    this.data.groups.push(g);
    this.persist();
    return g;
  }

  updateGroup(id: string, body: Record<string, unknown>) {
    const g = this.data.groups.find((x) => x.id === id);
    if (!g) throw new HttpError(404, "Nie ma takiej grupy.");
    if (body.name !== undefined) g.name = optStr(body.name) ?? g.name;
    if (body.colorHex !== undefined) g.colorHex = optStr(body.colorHex) ?? g.colorHex;
    this.persist();
    return g;
  }

  /** Deleting a group removes its portfolios (cascade), like the native app. */
  deleteGroup(id: string) {
    const members = this.data.portfolios.filter((p) => p.groupId === id).map((p) => p.id);
    for (const pid of members) this.deletePortfolio(pid);
    this.data.groups = this.data.groups.filter((g) => g.id !== id);
    this.persist();
  }

  // ---------------------------------------------------------------- import
  importPreview(file: { name: string; data: Uint8Array }, kind?: "xtb" | "universal" | "ibkr") {
    const items = importFile(file, kind);
    if (items.length === 0) throw new HttpError(422, "Nie znaleziono żadnych operacji w pliku.");
    const token = newId();
    const source = items.some((i) => /xtb/i.test(i.source ?? "")) ? "XTB" : (items[0]?.source ?? null);
    this.previews.set(token, { items, source, createdAt: Date.now() });
    for (const [k, v] of this.previews) if (Date.now() - v.createdAt > 3600_000) this.previews.delete(k);
    const plan = filterNewImports(
      items,
      this.data.transactions.map((t) => t.externalId ?? ""),
      this.data.transactions.map((t) => importFingerprint(t.typeRaw, t.symbol, t.date, t.quantity, t.cashDelta, t.currency)),
    );
    const accounts = [...new Set(items.map((i) => i.account).filter((a): a is string => !!a))].sort();
    return {
      token, source, total: items.length, newCount: plan.toInsert.length, duplicates: plan.skippedDuplicates, accounts,
      autoPortfolios: items.some((i) => /xtb/i.test(i.source ?? "") || i.account),
      items: items.slice(0, 500).map((i) => ({ ...i, date: i.date.toISOString() })),
    };
  }

  importCommit(body: Record<string, unknown>) {
    const preview = this.previews.get(String(body.token ?? ""));
    if (!preview) throw new HttpError(404, "Podgląd importu wygasł — wczytaj plik ponownie.");
    try {
      const result = commitImport(this.data, preview.items, { targetPortfolioId: optStr(body.portfolioId), previewSource: preview.source });
      this.previews.delete(String(body.token));
      this.persist();
      return result;
    } catch (e) {
      if (e instanceof Error && !(e instanceof HttpError)) throw new HttpError(400, e.message);
      throw e;
    }
  }

  // ---------------------------------------------------------------- backup / export
  backupJson(): string {
    return exportBackup(this.data);
  }

  restoreBackup(text: string): { portfolios: number; transactions: number } {
    let parsed;
    try {
      parsed = importBackup(text);
    } catch (e) {
      throw new HttpError(400, e instanceof BackupError ? e.message : "Nie udało się wczytać backupu.");
    }
    this.store.writeBackup(this.data, "before-restore", 10);
    const keepAlerts = this.data.alerts;
    this.data = parsed.data;
    if (!parsed.hasAlerts) this.data.alerts = keepAlerts; // a v1 file has no alerts: keep the current ones
    this.persist();
    return { portfolios: this.data.portfolios.length, transactions: this.data.transactions.length };
  }

  clearData() {
    this.store.writeBackup(this.data, "before-clear", 10);
    this.data = emptyDataset();
    this.persist();
  }

  transactionsCsv(): string {
    return exportTransactionsCsv(this.data.transactions, this.data.portfolios);
  }
  templateCsv(): string {
    return templateCsv();
  }

  // ---------------------------------------------------------------- refresh
  async refreshQuotes(): Promise<{ updated: number; failed: { symbol: string; error: string }[] }> {
    const txs = this.data.transactions;
    const symbols = [...new Set(txs.map((t) => t.symbol?.toUpperCase()).filter((s): s is string => !!s))];
    const ccy = mostCommonCurrencyBySymbol(txs);
    const failed: { symbol: string; error: string }[] = [];
    let updated = 0;
    const queue = [...symbols];
    const worker = async () => {
      for (let s = queue.shift(); s !== undefined; s = queue.shift()) {
        try {
          const q = await fetchQuote(this.fetchFn, s, ccy[s], this.settings.symbolMappings);
          const existing = this.data.quotes.find((x) => x.symbol.toUpperCase() === s);
          if (existing) Object.assign(existing, { price: q.price, currency: q.currency, asOf: q.asOf });
          else this.data.quotes.push({ id: newId(), symbol: s, currency: q.currency, price: q.price, asOf: q.asOf });
          this.quoteMeta[s] = { provider: q.resolved.provider, providerSymbol: q.resolved.providerSymbol, currency: q.currency, asOf: q.asOf.toISOString() };
          updated++;
        } catch (e) {
          if (e instanceof PricingError && e.kind === "ignored") continue;
          failed.push({ symbol: s, error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    this.store.setSetting("quoteMeta", this.quoteMeta);
    this.persist();
    this.lastRefresh = new Date();
    return { updated, failed };
  }

  async refreshRates(): Promise<RatesToPLN> {
    this.nbpRates = await fetchNbpRates(this.fetchFn);
    this.store.setCache("nbpRates", this.nbpRates);
    return this.rates;
  }

  async refreshHistories(): Promise<{ symbols: number }> {
    const txs = this.data.transactions;
    const symbols = [...new Set(txs.map((t) => t.symbol?.toUpperCase()).filter((s): s is string => !!s))];
    const ccy = mostCommonCurrencyBySymbol(txs);
    const queue = [...symbols];
    const worker = async () => {
      for (let s = queue.shift(); s !== undefined; s = queue.shift()) {
        try {
          const h = await fetchHistory(this.fetchFn, s, ccy[s], this.settings.symbolMappings);
          if (h.length > 0) this.histories[s] = h;
        } catch { /* one bad ticker must not abort the batch */ }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    this.store.setCache("histories", serializeHistories(this.histories));
    return { symbols: symbols.length };
  }

  isBenchmarkLoaded(id: string): boolean {
    const cfg = benchmarkOptions().find((o) => o.id === id);
    if (!cfg || id === "") return true;
    return cfg.isComposite ? cfg.symbols.every((s) => this.benchmarkHistories[`${id}:${s}`]) : !!this.benchmarkHistories[id];
  }

  async ensureBenchmark(id: string): Promise<void> {
    const cfg = benchmarkOptions().find((o) => o.id === id);
    if (!cfg || id === "" || this.isBenchmarkLoaded(id)) return;
    for (const sym of cfg.symbols) {
      const h = await fetchHistory(this.fetchFn, sym, cfg.currency, this.settings.symbolMappings);
      this.benchmarkHistories[cfg.isComposite ? `${id}:${sym}` : id] = h;
    }
    this.store.setCache("benchmarkHistories", serializeHistories(this.benchmarkHistories));
  }

  /** Refresh everything the dashboard needs, then evaluate alerts. */
  async refreshAll() {
    const rates = await this.refreshRates().then(() => null, (e: unknown) => (e instanceof Error ? e.message : String(e)));
    const quotes = await this.refreshQuotes();
    this.checkAlerts();
    return { quotes, ratesError: rates };
  }

  // ---------------------------------------------------------------- integration API
  holdings() {
    return holdingsResponse(this.data.portfolios, this.data.transactions);
  }
  portfolioApi() {
    return portfolioResponse(this.data.portfolios, this.data.transactions, this.data.quotes, this.rates);
  }
  agentFeed() {
    return buildAgentFeed({ portfolios: this.data.portfolios, transactions: this.data.transactions, quotes: this.data.quotes, rates: this.rates, appVersion: this.version });
  }

  /** Test helper / API: convert an amount to PLN with current rates. */
  toPLN(amount: number, currency: string): number {
    return convertToPLN(amount, currency, this.rates);
  }
  today(): Date {
    return startOfDay(new Date());
  }
}

export function scopeToString(s: ScopeSel): string {
  return s.kind === "all" ? "all" : `${s.kind}:${s.id}`;
}

function serializeHistories(h: Histories): Record<string, [number, number][]> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.map((p): [number, number] => [p.date.getTime(), p.close])]));
}

function reviveHistories(raw: Record<string, [number, number][]>): Histories {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.map(([t, close]) => ({ date: new Date(t), close }))]));
}
