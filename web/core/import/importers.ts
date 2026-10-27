import { detectAssetType } from "../assetType.ts";
import { normalizeCurrency } from "../currency.ts";
import type { TransactionType } from "../types.ts";
import { detectOperationType, grossMagnitude, mapOperationType, parseDealComment } from "../xtbParsing.ts";
import { normalizeHeader, parseCsv } from "./csv.ts";
import { nilIfEmpty, parseDateIbkr, parseDateLoose, parseDateStrict, parseExcelOrDate, parseNumber, parseNumberIbkr } from "./parse.ts";
import { readXlsx, type Sheet } from "./xlsx.ts";
import { readZip } from "./zip.ts";

export interface ImportedTransaction {
  date: Date;
  type: TransactionType;
  symbol: string | null;
  name: string | null;
  quantity: number | null;
  price: number | null;
  gross: number;
  fee: number;
  currency: string;
  cashDelta: number | null;
  externalId: string | null;
  notes: string | null;
  source: string | null;
  assetType: string | null;
  account: string | null;
}

type Row = Record<string, string>;
const trimmed = (v: string | undefined) => (v ?? "").trim();
const upperOrNull = (v: string | undefined) => nilIfEmpty(v)?.toUpperCase() ?? null;

// ------------------------------------------------------------------ universal template

export const UNIVERSAL_HEADERS = ["date", "type", "symbol", "name", "quantity", "price", "gross", "fee", "currency", "cash_delta", "external_id", "notes"];

const UNIVERSAL_TYPES: Record<string, TransactionType> = {
  buy: "buy", kupno: "buy", zakup: "buy",
  sell: "sell", sprzedaz: "sell", sprzedaż: "sell",
  deposit: "deposit", wplata: "deposit", wpłata: "deposit",
  withdrawal: "withdrawal", wyplata: "withdrawal", wypłata: "withdrawal",
  transfer: "transfer", przelew: "transfer",
  fee: "fee", prowizja: "fee",
  tax: "tax", podatek: "tax",
  interest: "interest", odsetki: "interest",
  dividend: "dividend", dywidenda: "dividend",
  other: "other", inne: "other",
};

export function mapUniversalRow(row: Row): ImportedTransaction | null {
  const date = parseDateStrict(row.date);
  const type = UNIVERSAL_TYPES[trimmed(row.type).toLowerCase()];
  if (!date || !type) return null;
  return {
    date, type,
    symbol: upperOrNull(row.symbol), name: nilIfEmpty(row.name),
    quantity: parseNumber(row.quantity), price: parseNumber(row.price),
    gross: parseNumber(row.gross) ?? 0, fee: parseNumber(row.fee) ?? 0,
    currency: (nilIfEmpty(row.currency) ?? "PLN").toUpperCase(),
    cashDelta: parseNumber(row.cash_delta), externalId: nilIfEmpty(row.external_id), notes: nilIfEmpty(row.notes),
    source: "Universal import", assetType: null, account: null,
  };
}

function sheetToRows(sheet: Sheet): Row[] {
  const [head, ...rest] = sheet.rows;
  if (!head) return [];
  const headers = Object.fromEntries(Object.entries(head).map(([col, v]) => [col, normalizeHeader(v)]));
  return rest.map((r) => {
    const row: Row = {};
    for (const [col, v] of Object.entries(r)) if (headers[col]) row[headers[col]!] = v;
    return row;
  });
}

export function importUniversal(file: { name: string; data: Uint8Array }): ImportedTransaction[] {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") {
    const sheet = readXlsx(file.data)[0];
    return sheet ? sheetToRows(sheet).map(mapUniversalRow).filter((x): x is ImportedTransaction => x !== null) : [];
  }
  return parseCsv(file.data).map(mapUniversalRow).filter((x): x is ImportedTransaction => x !== null);
}

// ------------------------------------------------------------------ IBKR

const IBKR_TYPES: Record<string, TransactionType> = {
  buy: "buy", b: "buy", sell: "sell", s: "sell", dividend: "dividend", div: "dividend", interest: "interest",
  fee: "fee", commission: "fee", tax: "tax", "withholding tax": "tax", deposit: "deposit", withdrawal: "withdrawal", transfer: "transfer",
};

export function mapIbkrRow(rawRow: Row): ImportedTransaction | null {
  const n: Row = Object.fromEntries(Object.entries(rawRow).map(([k, v]) => [normalizeHeader(k), v]));
  const section = n.section;
  if (section) {
    const s = section.toLowerCase();
    if (!(s.includes("trade") || s.includes("dividend") || s.includes("interest") || s.includes("cash"))) return null;
  }
  const date = parseDateIbkr(n.datetime ?? n.date ?? n.trade_date ?? n.tradedate ?? n.settle_date);
  if (!date) return null;

  const symbol = trimmed(n.symbol ?? n.underlying_symbol).toUpperCase();
  const currency = trimmed(n.currency ?? n.currency_primary ?? n.currencyprimary ?? "USD").toUpperCase();
  const qty = parseNumberIbkr(n.quantity ?? n.qty);
  const price = parseNumberIbkr(n.trade_price ?? n.tradeprice ?? n["t._price"] ?? n.price);
  const proceeds = parseNumberIbkr(n.proceeds ?? n.amount ?? n.net_cash ?? n.netcash);
  const fee = Math.abs(parseNumberIbkr(n.ibcommission ?? n["comm/fee"] ?? n.commission ?? n.comm_fee) ?? 0);
  const assetCategory = (n.asset_category ?? n.assetcategory ?? "").toLowerCase();

  let type: TransactionType;
  const side = n["buy/sell"] ?? n.side;
  if (side) {
    const s = side.toLowerCase();
    type = s.startsWith("b") ? "buy" : s.startsWith("s") ? "sell" : "other";
    if (type === "other") type = ibkrFallbackType(n, assetCategory, qty);
  } else {
    type = ibkrFallbackType(n, assetCategory, qty);
  }

  const absQty = qty === null ? null : Math.abs(qty);
  const gross = proceeds !== null ? Math.abs(proceeds) : absQty !== null && price !== null ? absQty * price : 0;
  if (!(type !== "other" || gross !== 0 || absQty !== null)) return null;

  let assetType: string;
  if (assetCategory.includes("stock") || assetCategory.includes("equity")) assetType = "stock";
  else if (assetCategory.includes("etf")) assetType = "etf";
  else if (assetCategory.includes("bond")) assetType = "bond";
  else assetType = detectAssetType(symbol === "" ? null : symbol, n.description);

  return {
    date, type, symbol: symbol === "" ? null : symbol, name: n.description ?? n.name ?? null,
    quantity: absQty, price: price === null ? null : Math.abs(price), gross, fee,
    currency: currency === "" ? "USD" : currency,
    cashDelta: type === "dividend" || type === "interest" ? gross : null,
    externalId: n.tradeid ?? n.trade_id ?? n.transactionid ?? n.orderid ?? null,
    notes: n.notes ?? null, source: "IBKR CSV", assetType,
    account: n.account ?? n.clientaccountid ?? n.client_account_id ?? null,
  };
}

function ibkrFallbackType(n: Row, assetCategory: string, qty: number | null): TransactionType {
  if (n.type !== undefined) return IBKR_TYPES[n.type.trim().toLowerCase()] ?? "other";
  if (assetCategory.includes("dividend")) return "dividend";
  if (assetCategory.includes("interest")) return "interest";
  if (qty !== null) return qty >= 0 ? "buy" : "sell";
  return "other";
}

export function importIbkr(data: Uint8Array): ImportedTransaction[] {
  return parseCsv(data).map(mapIbkrRow).filter((x): x is ImportedTransaction => x !== null);
}

// ------------------------------------------------------------------ XTB

function pick(row: Row, keys: string[]): string | null {
  for (const k of keys) if (row[k] !== undefined && row[k]!.trim() !== "") return row[k]!;
  for (const k of keys) for (const [rk, rv] of Object.entries(row)) if (rk.includes(k) && rv.trim() !== "") return rv;
  return null;
}

function parseGenericType(value: string | null): TransactionType | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw.includes("buy") || raw.includes("kup")) return "buy";
  if (raw.includes("sell") || raw.includes("sprzed")) return "sell";
  if (raw.includes("deposit") || raw.includes("wpłat") || raw.includes("wplat")) return "deposit";
  if (raw.includes("withdraw") || raw.includes("wypłat") || raw.includes("wyplat")) return "withdrawal";
  if (raw.includes("transfer") || raw.includes("przelew")) return "transfer";
  if (raw.includes("dividend") || raw.includes("dywid")) return "dividend";
  if (raw.includes("interest") || raw.includes("odset")) return "interest";
  if (raw.includes("fee") || raw.includes("prowiz")) return "fee";
  if (raw.includes("tax") || raw.includes("podatek")) return "tax";
  return null;
}

function mapXtbGenericRow(row: Row, account: string | null): ImportedTransaction | null {
  const date = parseDateLoose(pick(row, ["date", "time", "transaction_time", "trade_time", "data", "data_transakcji", "czas", "czas_transakcji", "trade_date"]));
  if (!date) return null;
  const type = parseGenericType(pick(row, ["type", "operation", "side", "typ", "rodzaj", "typ_operacji", "operation_type", "action"]));
  if (!type) return null;
  return {
    date, type,
    symbol: upperOrNull(pick(row, ["symbol", "instrument", "ticker", "walor", "instrument_symbol"]) ?? undefined),
    name: nilIfEmpty(pick(row, ["name", "instrument_name", "nazwa", "instrument_nazwa"])),
    quantity: parseNumber(pick(row, ["quantity", "qty", "ilosc", "ilość", "wolumen"])),
    price: parseNumber(pick(row, ["price", "rate", "cena", "kurs"])),
    gross: parseNumber(pick(row, ["gross", "value", "amount", "wartosc", "wartość", "kwota", "amount_pln", "net_amount", "total"])) ?? 0,
    fee: parseNumber(pick(row, ["fee", "commission", "provision", "prowizja", "oplaty", "opłaty"])) ?? 0,
    currency: normalizeCurrency(pick(row, ["currency", "ccy", "waluta", "currency_code"]) ?? "PLN"),
    cashDelta: null, externalId: nilIfEmpty(pick(row, ["external_id", "id", "transaction_id", "order_id"])), notes: null,
    source: "XTB import", assetType: null, account,
  };
}

function currencyHintFromFileName(name: string): string | null {
  const base = name.split("_")[0]?.trim().toUpperCase();
  return base ? base : null;
}

function cashOperationsScore(name: string): number {
  const label = name.trim().toLowerCase();
  if (label === "cash operations") return 100;
  if (label.includes("cash operation")) return 90;
  if (label.includes("operacje gotowk") || label.includes("operacje pieniez") || label.includes("operacje pienięż")) return 90;
  return 0;
}

function mapCashOpsRow(row: Row, currencyHint: string | null): ImportedTransaction | null {
  const rawType = trimmed(row.type);
  if (rawType === "") return null;
  const date = parseExcelOrDate(row.time);
  if (!date) return null;
  const amount = parseNumber(row.amount) ?? 0;
  const symbol = upperOrNull(row.ticker);
  const notes = nilIfEmpty(row.comment);
  const deal = parseDealComment(notes);
  const type = mapOperationType(rawType) ?? detectOperationType([notes, rawType].filter(Boolean).join(" "), amount, symbol, deal.quantity, deal.price);
  return {
    date, type, symbol, name: nilIfEmpty(row.instrument),
    quantity: deal.quantity > 0 ? deal.quantity : null, price: deal.price > 0 ? deal.price : null,
    gross: grossMagnitude(amount, deal.quantity, deal.price), fee: 0,
    currency: (currencyHint ?? "PLN").trim().toUpperCase(), cashDelta: amount,
    externalId: nilIfEmpty(row.id), notes, source: "XTB import", assetType: null, account: null,
  };
}

function importCashOperationsSheet(sheet: Sheet, currencyHint: string | null): ImportedTransaction[] {
  let headerByCol: Record<string, string> | null = null;
  let headerIdx = -1;
  for (let i = 0; i < sheet.rows.length; i++) {
    const tmp: Record<string, string> = {};
    for (const [col, v] of Object.entries(sheet.rows[i]!)) if (v.trim() !== "") tmp[col] = v.trim();
    const set = new Set(Object.values(tmp).map((v) => v.toLowerCase()));
    const hasType = set.has("type") || set.has("typ") || set.has("operacja");
    const hasAmount = set.has("amount") || set.has("kwota") || set.has("wartość") || set.has("wartosc");
    const hasTime = set.has("time") || set.has("czas") || set.has("date") || set.has("data");
    // Closed Positions has Type/Ticker/Volume but no Amount — require the cash-ops shape.
    if (hasType && hasAmount && hasTime) { headerByCol = tmp; headerIdx = i; break; }
  }
  if (!headerByCol) return [];
  const out: ImportedTransaction[] = [];
  for (const r of sheet.rows.slice(headerIdx + 1)) {
    const dict: Row = {};
    for (const [col, v] of Object.entries(r)) {
      const header = headerByCol[col];
      if (header) dict[header.trim().toLowerCase()] = v;
    }
    const first = Object.values(dict).find((v) => v.trim() !== "");
    if (first && ["total", "profit/loss"].includes(first.trim().toLowerCase())) break;
    if (Object.keys(dict).length === 0) continue;
    const tx = mapCashOpsRow(dict, currencyHint);
    if (tx) out.push(tx);
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function importXtbXlsx(data: Uint8Array, fileName: string): ImportedTransaction[] {
  const hint = currencyHintFromFileName(fileName.split("/").pop() ?? fileName);
  const sheets = readXlsx(data).sort((a, b) => cashOperationsScore(b.name) - cashOperationsScore(a.name));
  for (const sheet of sheets) {
    const imported = importCashOperationsSheet(sheet, hint);
    if (imported.length > 0) return imported;
  }
  return [];
}

/** XTB ZIP often uses "<account>/<currency>_….xlsx"; the folder name is the account number. */
function accountHint(path: string): string | null {
  const first = path.split("/")[0]?.trim();
  return first && /^\d+$/.test(first) ? first : null;
}

const withSource = (items: ImportedTransaction[], account: string | null): ImportedTransaction[] =>
  items.map((t) => ({ ...t, source: "XTB import", account: account ?? t.account }));

export class ImportError extends Error {}

export function importXtbZip(data: Uint8Array): ImportedTransaction[] {
  const all: ImportedTransaction[] = [];
  const csvFiles: string[] = [];
  const xlsxFiles: string[] = [];
  for (const entry of readZip(data)) {
    if (entry.isDirectory) continue;
    const name = entry.path.toLowerCase();
    const account = accountHint(entry.path);
    if (name.endsWith(".csv")) {
      csvFiles.push(entry.path);
      const rows = parseCsv(entry.data());
      const universal = rows.filter((r) => "type" in r && "date" in r && "gross" in r).map(mapUniversalRow).filter((x): x is ImportedTransaction => x !== null);
      if (universal.length > 0) all.push(...withSource(universal, account));
      else all.push(...rows.map((r) => mapXtbGenericRow(r, account)).filter((x): x is ImportedTransaction => x !== null));
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      xlsxFiles.push(entry.path);
      let imported: ImportedTransaction[] = [];
      try { imported = importXtbXlsx(entry.data(), entry.path); } catch { imported = []; }
      if (imported.length === 0) {
        try { all.push(...withSource(importUniversal({ name: entry.path, data: entry.data() }), account)); } catch { /* not a universal sheet either */ }
      } else {
        all.push(...withSource(imported, account));
      }
    }
  }
  all.sort((a, b) => a.date.getTime() - b.date.getTime());
  if (all.length === 0) {
    if (csvFiles.length === 0 && xlsxFiles.length === 0) throw new ImportError("ZIP nie zawiera plików CSV/XLSX z operacjami.");
    const parts = [csvFiles.length ? `CSV: ${csvFiles.join(", ")}` : null, xlsxFiles.length ? `XLSX: ${xlsxFiles.join(", ")}` : null].filter(Boolean).join(" | ");
    throw new ImportError(`Nie udało się zmapować żadnej transakcji z plików w ZIP. (${parts})`);
  }
  return all;
}

/** Pick the right importer from the file name/contents. `kind` overrides auto-detection. */
export function importFile(file: { name: string; data: Uint8Array }, kind?: "xtb" | "universal" | "ibkr"): ImportedTransaction[] {
  const ext = file.name.toLowerCase().split(".").pop();
  if (kind === "ibkr") return importIbkr(file.data);
  if (kind === "universal") return importUniversal(file);
  if (ext === "zip" || kind === "xtb") return importXtbZip(file.data);
  if (ext === "xlsx" || ext === "xls") {
    const xtb = importXtbXlsx(file.data, file.name);
    return xtb.length > 0 ? xtb : importUniversal(file);
  }
  return importUniversal(file);
}

// ------------------------------------------------------------------ dedupe

/** Content key that survives re-exports where the broker assigns different IDs / sub-second timestamps. */
export function importFingerprint(type: string, symbol: string | null | undefined, date: Date, quantity: number | null | undefined, cashDelta: number | null | undefined, currency: string): string {
  const seconds = Math.floor(date.getTime() / 1000);
  return [type, (symbol ?? "").toUpperCase(), String(seconds), (quantity ?? 0).toFixed(4), (cashDelta ?? 0).toFixed(2), currency.toUpperCase()].join("|");
}

export function filterNewImports(
  items: ImportedTransaction[],
  existingExternalIds: Iterable<string>,
  existingFingerprints: Iterable<string> = [],
): { toInsert: ImportedTransaction[]; skippedDuplicates: number } {
  const seen = new Set([...existingExternalIds].map((s) => s.trim()).filter((s) => s !== ""));
  const fps = new Set(existingFingerprints);
  const toInsert: ImportedTransaction[] = [];
  let skipped = 0;
  for (const item of items) {
    if (fps.has(importFingerprint(item.type, item.symbol, item.date, item.quantity, item.cashDelta, item.currency))) { skipped++; continue; }
    const raw = (item.externalId ?? "").trim();
    if (raw === "") { toInsert.push(item); continue; }
    if (seen.has(raw)) { skipped++; continue; }
    seen.add(raw);
    toInsert.push(item);
  }
  return { toInsert, skippedDuplicates: skipped };
}
