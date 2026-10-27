import { addMonths, startOfDay } from "./dates.ts";

export interface BondPreset {
  code: string;
  name: string;
  termMonths: number;
  firstYearRate: number;
  margin: number;
  indexation: string;
  capitalization: boolean;
  earlyRedemptionFee: number;
}

export const BOND_PRESETS: readonly BondPreset[] = [
  { code: "OTS", name: "OTS – 3-miesięczne stałoprocentowe", termMonths: 3, firstYearRate: 3.0, margin: 0, indexation: "fixed", capitalization: true, earlyRedemptionFee: 0 },
  { code: "ROR", name: "ROR – roczne zmienne (stopa ref. NBP)", termMonths: 12, firstYearRate: 5.75, margin: 0, indexation: "nbp", capitalization: false, earlyRedemptionFee: 0.5 },
  { code: "DOR", name: "DOR – 2-letnie zmienne (ref. NBP + marża)", termMonths: 24, firstYearRate: 5.9, margin: 0.5, indexation: "nbp", capitalization: false, earlyRedemptionFee: 0.7 },
  { code: "TOS", name: "TOS – 3-letnie stałoprocentowe", termMonths: 36, firstYearRate: 5.95, margin: 0, indexation: "fixed", capitalization: true, earlyRedemptionFee: 1.0 },
  { code: "COI", name: "COI – 4-letnie indeksowane inflacją", termMonths: 48, firstYearRate: 6.05, margin: 1.5, indexation: "cpi", capitalization: false, earlyRedemptionFee: 0.7 },
  { code: "EDO", name: "EDO – 10-letnie indeksowane inflacją", termMonths: 120, firstYearRate: 6.3, margin: 2.0, indexation: "cpi", capitalization: true, earlyRedemptionFee: 2.0 },
  { code: "ROS", name: "ROS – 6-letnie rodzinne (inflacja)", termMonths: 72, firstYearRate: 6.2, margin: 2.0, indexation: "cpi", capitalization: true, earlyRedemptionFee: 0.7 },
  { code: "ROD", name: "ROD – 12-letnie rodzinne (inflacja)", termMonths: 144, firstYearRate: 6.5, margin: 2.5, indexation: "cpi", capitalization: true, earlyRedemptionFee: 2.0 },
];

export const BOND_NOMINAL = 100;

export interface BondTerms {
  code: string;
  termMonths: number;
  firstYearRate: number;
  margin: number;
  indexation: string;
  capitalization: boolean;
  earlyRedemptionFee: number;
  nominal: number;
}

export interface BondLot {
  quantity: number;
  purchaseDate: Date;
  terms: BondTerms;
}

export function termsFromPreset(p: BondPreset): BondTerms {
  return {
    code: p.code.toUpperCase(),
    termMonths: p.termMonths,
    firstYearRate: p.firstYearRate,
    margin: p.margin,
    indexation: p.indexation,
    capitalization: p.capitalization,
    earlyRedemptionFee: p.earlyRedemptionFee,
    nominal: BOND_NOMINAL,
  };
}

export function maturityDate(terms: BondTerms, purchase: Date): Date {
  return addMonths(purchase, terms.termMonths);
}

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** Estimated value of one bond: nominal plus accrued interest (CPI bonds approximated with the first-year rate). */
export function bondCurrentPrice(terms: BondTerms, purchaseDate: Date, asOf: Date = new Date()): number {
  const start = startOfDay(purchaseDate);
  const maturity = maturityDate(terms, start);
  const day = startOfDay(asOf);
  const reference = day > maturity ? maturity : day;
  const years = Math.max(0, (reference.getTime() - start.getTime()) / YEAR_MS);
  const rate = terms.firstYearRate / 100;
  if (!(rate > 0) || !(years > 0)) return terms.nominal;
  if (terms.capitalization) return terms.nominal * Math.pow(1 + rate, years);
  return terms.nominal * (1 + rate * (years - Math.floor(years)));
}

export function termsFromSymbol(symbol: string | null | undefined): BondTerms | null {
  const raw = (symbol ?? "").trim();
  if (raw === "") return null;
  const upper = raw.toUpperCase();
  const preset = BOND_PRESETS.find((p) => p.code === upper) ?? BOND_PRESETS.find((p) => upper.startsWith(p.code));
  return preset ? termsFromPreset(preset) : null;
}

function matchNumber(text: string, key: string): number | null {
  const m = new RegExp(`${key}\\s*=\\s*(-?\\d+(?:[.,]\\d+)?)`, "i").exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function matchToken(text: string, key: string): string | null {
  const m = new RegExp(`${key}\\s*=\\s*([A-Za-z0-9._+-]+)`, "i").exec(text);
  return m ? m[1]! : null;
}

/** Notes format written by the bonds screen: `Bond OTS term=3m rate=3.0% margin=0.0 index=fixed cap=true fee=0.0`. */
export function parseBondNotes(notes: string | null | undefined): BondTerms | null {
  if (!notes || !/bond/i.test(notes)) return null;
  const tokens = notes.split(/\s+/).filter(Boolean);
  let code: string;
  if (tokens.length >= 2 && tokens[0]!.toLowerCase() === "bond") {
    code = tokens[1]!.toUpperCase();
  } else {
    const up = notes.toUpperCase();
    code = BOND_PRESETS.find((p) => up.includes(p.code))?.code ?? "";
  }
  const preset = BOND_PRESETS.find((p) => p.code === code);
  const term = matchNumber(notes, "term");
  const termMonths = term !== null ? Math.trunc(term) : (preset?.termMonths ?? 12);
  const rate = matchNumber(notes, "rate") ?? preset?.firstYearRate ?? 0;
  const margin = matchNumber(notes, "margin") ?? 0;
  const indexation = matchToken(notes, "index") ?? "fixed";
  const cap = matchToken(notes, "cap")?.toLowerCase();
  const capitalization = cap === "true" || cap === "1" || cap === "yes";
  const fee = matchNumber(notes, "fee") ?? 0;
  if (code === "" && !(rate > 0)) return null;
  return {
    code: code === "" ? "BOND" : code,
    termMonths,
    firstYearRate: rate,
    margin,
    indexation,
    capitalization,
    earlyRedemptionFee: fee,
    nominal: BOND_NOMINAL,
  };
}

export function resolveBondTerms(args: {
  symbol: string | null | undefined;
  name: string | null | undefined;
  notes: string | null | undefined;
  assetType: string | null | undefined;
}): BondTerms | null {
  const parsed = parseBondNotes(args.notes);
  if (parsed) return parsed;
  const fromPreset = termsFromSymbol(args.symbol);
  if (fromPreset) return fromPreset;
  const looksLikeBond =
    (args.assetType ?? "").toLowerCase() === "bond" ||
    /bond/i.test(args.notes ?? "") ||
    /oblig/i.test(args.name ?? "");
  return looksLikeBond ? termsFromSymbol(args.symbol) : null;
}
