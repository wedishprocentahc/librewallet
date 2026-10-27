import { normalizeCurrency, type RatesToPLN } from "./currency.ts";
import { addDays, dayKey, startOfDay } from "./dates.ts";
import { resolvedAccepts, resolveSymbol, type ResolvedSymbol, type SymbolMapping } from "./symbols.ts";

export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class PricingError extends Error {
  readonly kind: "unresolved" | "ignored" | "currencyMismatch" | "noData" | "http";
  constructor(kind: PricingError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface FetchedQuote {
  price: number;
  currency: string;
  asOf: Date;
  resolved: ResolvedSymbol;
}

export interface PricePoint {
  date: Date;
  close: number;
}

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = { "User-Agent": "Mozilla/5.0" };

function resolveOrThrow(xtbSymbol: string, positionCurrency: string | null | undefined, mappings: SymbolMapping[]): ResolvedSymbol {
  const r = resolveSymbol(xtbSymbol, positionCurrency, mappings);
  if (r.ok) return r.value;
  if (r.error === "ignored") throw new PricingError("ignored", `Symbol ${xtbSymbol.toUpperCase()} jest ignorowany (zła wycena Yahoo vs XTB).`);
  throw new PricingError("unresolved", `Brak mapowania tickera dla ${r.symbol ?? xtbSymbol}. Ustaw symbol Yahoo w Ustawieniach.`);
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === "object" ? (v as Json) : undefined);
const firstResult = (payload: unknown): Json | undefined => {
  const results = obj(obj(payload)?.chart)?.result;
  return Array.isArray(results) ? obj(results[0]) : undefined;
};

export async function fetchQuote(fetchFn: FetchFn, xtbSymbol: string, positionCurrency: string | null | undefined, mappings: SymbolMapping[] = []): Promise<FetchedQuote> {
  const resolved = resolveOrThrow(xtbSymbol, positionCurrency, mappings);
  const res = await fetchFn(`${YAHOO}/${encodeURIComponent(resolved.providerSymbol)}?interval=1d&range=5d`, { headers: UA });
  if (!res.ok) throw new PricingError("http", `Yahoo HTTP ${res.status}.`);
  const meta = obj(firstResult(await res.json())?.meta);
  if (!meta) throw new PricingError("noData", `Brak danych Yahoo dla ${resolved.providerSymbol}.`);
  const price = (typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : undefined) ?? (typeof meta.previousClose === "number" ? meta.previousClose : 0);
  if (!(price > 0)) throw new PricingError("noData", `Brak danych Yahoo dla ${resolved.providerSymbol}.`);
  const currency = (typeof meta.currency === "string" ? meta.currency : resolved.expectedCurrency).toUpperCase();
  if (!resolvedAccepts(resolved, currency)) {
    throw new PricingError("currencyMismatch", `Yahoo ${resolved.providerSymbol} ma walutę ${currency}, oczekiwano ${resolved.expectedCurrency}.`);
  }
  const t = typeof meta.regularMarketTime === "number" ? meta.regularMarketTime : Date.now() / 1000;
  return { price, currency, asOf: new Date(t * 1000), resolved };
}

export async function fetchHistory(fetchFn: FetchFn, xtbSymbol: string, positionCurrency: string | null | undefined, mappings: SymbolMapping[] = [], now: Date = new Date()): Promise<PricePoint[]> {
  const resolved = resolveOrThrow(xtbSymbol, positionCurrency, mappings);
  const url = `${YAHOO}/${encodeURIComponent(resolved.providerSymbol)}?period1=0&period2=${Math.floor(now.getTime() / 1000)}&interval=1d&events=history`;
  const res = await fetchFn(url, { headers: UA });
  if (!res.ok) throw new PricingError("http", `Yahoo HTTP ${res.status}.`);
  const result = firstResult(await res.json());
  const timestamps = result?.timestamp;
  const quoteSeries = obj(result?.indicators)?.quote;
  const closes = Array.isArray(quoteSeries) ? obj(quoteSeries[0])?.close : undefined;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];
  const ccy = obj(result?.meta)?.currency;
  if (typeof ccy === "string" && !resolvedAccepts(resolved, ccy.toUpperCase())) {
    throw new PricingError("currencyMismatch", `Yahoo ${resolved.providerSymbol} ma walutę ${ccy.toUpperCase()}, oczekiwano ${resolved.expectedCurrency}.`);
  }
  const out: PricePoint[] = [];
  timestamps.forEach((ts, i) => {
    const close = closes[i];
    if (typeof ts === "number" && typeof close === "number") out.push({ date: new Date(ts * 1000), close });
  });
  return out;
}

// ------------------------------------------------------------------ NBP (table A)

/** Latest mid rates: PLN per 1 unit of foreign currency. */
export async function fetchNbpRates(fetchFn: FetchFn): Promise<RatesToPLN> {
  const res = await fetchFn("https://api.nbp.pl/api/exchangerates/tables/A/?format=json", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`API NBP zwróciło błąd HTTP ${res.status}.`);
  const tables = (await res.json()) as { rates: { code: string; mid: number }[] }[];
  const table = tables[0];
  if (!table) throw new Error("API NBP zwróciło pustą odpowiedź.");
  const rates: RatesToPLN = { PLN: 1 };
  for (const r of table.rates) rates[r.code.toUpperCase()] = r.mid;
  return rates;
}

/** Historical mid rates per day (NBP allows ~367 days per request, so the range is windowed). */
export async function fetchNbpHistory(fetchFn: FetchFn, currency: string, from: Date, to: Date): Promise<Record<string, number>> {
  const code = normalizeCurrency(currency);
  const out: Record<string, number> = {};
  if (code === "PLN") return out;
  const end = startOfDay(to);
  for (let start = startOfDay(from); start.getTime() <= end.getTime(); ) {
    const windowEnd = new Date(Math.min(end.getTime(), addDays(start, 365).getTime()));
    const url = `https://api.nbp.pl/api/exchangerates/rates/A/${code}/${dayKey(start)}/${dayKey(windowEnd)}/?format=json`;
    try {
      const res = await fetchFn(url, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const series = (await res.json()) as { rates: { effectiveDate: string; mid: number }[] };
        for (const r of series.rates) out[r.effectiveDate] = r.mid;
      }
    } catch {
      /* partial history is fine: lookups fall back to nearby days or the latest table */
    }
    start = addDays(windowEnd, 1);
  }
  return out;
}

/** PLN mid rate on `date` (walks back up to 10 days for weekends/holidays, then to the latest known rate). */
export function rateToPLNOn(currency: string, date: Date, history: Record<string, Record<string, number>>, latest: RatesToPLN, overrides: Record<string, number> = {}): number {
  const code = normalizeCurrency(currency);
  if (code === "PLN") return 1;
  const ov = overrides[code];
  if (ov !== undefined && ov > 0) return ov;
  const map = history[code] ?? {};
  const day = startOfDay(date);
  const exact = map[dayKey(day)];
  if (exact !== undefined) return exact;
  for (let i = 1; i <= 10; i++) {
    const v = map[dayKey(addDays(day, -i))];
    if (v !== undefined) return v;
  }
  const key = dayKey(day);
  const prior = Object.keys(map).sort().filter((k) => k <= key).pop();
  if (prior) return map[prior]!;
  return latest[code] ?? 0;
}

/** Merge NBP rates with user overrides (overrides win). */
export function mergeRates(nbp: RatesToPLN, overrides: Record<string, number>): RatesToPLN {
  const rates: RatesToPLN = { ...nbp, PLN: 1 };
  for (const [code, rate] of Object.entries(overrides)) if (rate > 0) rates[code.toUpperCase()] = rate;
  return rates;
}

export function mostCommonCurrencyBySymbol(transactions: { symbol: string | null; currency: string }[]): Record<string, string> {
  const counts: Record<string, Record<string, number>> = {};
  for (const tx of transactions) {
    const symbol = tx.symbol?.toUpperCase();
    if (!symbol) continue;
    const c = normalizeCurrency(tx.currency);
    counts[symbol] ??= {};
    counts[symbol][c] = (counts[symbol][c] ?? 0) + 1;
  }
  const out: Record<string, string> = {};
  for (const [s, m] of Object.entries(counts)) out[s] = Object.entries(m).sort((a, b) => b[1] - a[1])[0]![0];
  return out;
}

