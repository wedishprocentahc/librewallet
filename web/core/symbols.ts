import { normalizeCurrency } from "./currency.ts";

export type QuoteProvider = "yahoo" | "stooq";

export interface SymbolMapping {
  id: string; // XTB symbol, uppercased
  provider: QuoteProvider;
  providerSymbol: string;
  note?: string;
}

export interface ResolvedSymbol {
  xtbSymbol: string;
  provider: QuoteProvider;
  providerSymbol: string;
  expectedCurrency: string;
  fromOverride: boolean;
  /** Currency the listing is quoted in (USD/EUR only); accepted even if the account currency differs. */
  nativeCurrency: string | null;
}

export type ResolveResult =
  | { ok: true; value: ResolvedSymbol }
  | { ok: false; error: "empty" | "ignored" | "unresolved"; symbol?: string };

/** Known Yahoo ≠ broker mismatches that are never fetched. */
export const IGNORED_BASES: ReadonlySet<string> = new Set(["EEE"]);

export function normalizeXtb(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isIgnoredSymbol(xtbSymbol: string): boolean {
  const upper = normalizeXtb(xtbSymbol);
  return IGNORED_BASES.has(upper.split(".")[0]!);
}

interface MarketRule {
  providerSymbol: string;
  expectedCurrency: string;
}

function marketRule(xtb: string): MarketRule | null {
  if (xtb.startsWith("^")) return { providerSymbol: xtb, expectedCurrency: "USD" };
  const dot = xtb.indexOf(".");
  const base = dot < 0 ? xtb : xtb.slice(0, dot);
  const suffix = dot < 0 ? "" : xtb.slice(dot + 1);
  switch (suffix) {
    case "PL": return { providerSymbol: `${base}.WA`, expectedCurrency: "PLN" };
    case "WA": return { providerSymbol: xtb, expectedCurrency: "PLN" };
    case "US": return { providerSymbol: base, expectedCurrency: "USD" };
    case "UK": return { providerSymbol: `${base}.L`, expectedCurrency: "GBP" };
    case "DE":
    case "FR": return { providerSymbol: xtb, expectedCurrency: "EUR" };
    case "L": return { providerSymbol: xtb, expectedCurrency: "GBP" };
    case "": return null; // bare symbols only via override
    default: return { providerSymbol: xtb, expectedCurrency: "PLN" };
  }
}

export function expectedCurrencyFor(xtb: string, positionCurrency = "PLN"): string {
  const rule = marketRule(normalizeXtb(xtb));
  if (rule && positionCurrency !== "") return normalizeCurrency(positionCurrency);
  return normalizeCurrency(positionCurrency);
}

export function resolveSymbol(xtbSymbol: string, positionCurrency?: string | null, overrides: SymbolMapping[] = []): ResolveResult {
  const xtb = normalizeXtb(xtbSymbol);
  if (xtb === "") return { ok: false, error: "empty" };
  if (isIgnoredSymbol(xtb)) return { ok: false, error: "ignored" };
  const posCcy = positionCurrency ? normalizeCurrency(positionCurrency) : null;

  const override = overrides.find((o) => o.id === xtb);
  if (override) {
    return {
      ok: true,
      value: {
        xtbSymbol: xtb,
        provider: override.provider,
        providerSymbol: override.providerSymbol,
        expectedCurrency: expectedCurrencyFor(xtb, posCcy ?? "PLN"),
        fromOverride: true,
        nativeCurrency: null,
      },
    };
  }
  const rule = marketRule(xtb);
  if (!rule) return { ok: false, error: "unresolved", symbol: xtb };
  return {
    ok: true,
    value: {
      xtbSymbol: xtb,
      provider: "yahoo",
      providerSymbol: rule.providerSymbol,
      expectedCurrency: posCcy ?? rule.expectedCurrency,
      fromOverride: false,
      nativeCurrency: rule.expectedCurrency === "USD" || rule.expectedCurrency === "EUR" ? rule.expectedCurrency : null,
    },
  };
}

export function resolvedAccepts(r: ResolvedSymbol, currency: string): boolean {
  const c = currency.toUpperCase();
  return c === r.expectedCurrency || c === r.nativeCurrency;
}
