import { normalizeCurrency } from "./currency.ts";
import { type Dataset, emptyDataset, TRANSACTION_TYPES } from "./types.ts";

export const BACKUP_FORMAT = "librewallet-backup";
export const BACKUP_VERSION = 2;

export class BackupError extends Error {}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const date = (v: unknown, what: string): Date => {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new BackupError(`Invalid date in ${what}: ${String(v)}`);
  return d;
};
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new BackupError(`Missing ${what}`);
  return v;
};
const num = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new BackupError(`Missing number ${what}`);
  return v;
};
const optStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const optNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/** Serialize to the shared backup format (sorted keys, nulls omitted). */
export function exportBackup(data: Dataset, exportedAt: Date = new Date()): string {
  const obj = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: iso(exportedAt),
    groups: data.groups.map((g) => ({ colorHex: g.colorHex, createdAt: iso(g.createdAt), id: g.id, name: g.name })),
    portfolios: data.portfolios.map((p) => ({
      baseCurrency: p.baseCurrency, colorHex: p.colorHex, createdAt: iso(p.createdAt), groupId: p.groupId,
      id: p.id, kindRaw: p.kindRaw, name: p.name,
    })),
    transactions: data.transactions.map((t) => ({
      assetType: t.assetType, cashDelta: t.cashDelta, currency: t.currency, date: iso(t.date), externalId: t.externalId,
      fee: t.fee, gross: t.gross, id: t.id, name: t.name, notes: t.notes, portfolioId: t.portfolioId, price: t.price,
      quantity: t.quantity, source: t.source, symbol: t.symbol, typeRaw: t.typeRaw,
    })),
    targets: data.targets.map((t) => ({
      assetType: t.assetType, createdAt: iso(t.createdAt), id: t.id, portfolioId: t.portfolioId, targetPct: t.targetPct,
    })),
    quotes: data.quotes.map((q) => ({ asOf: iso(q.asOf), currency: q.currency, id: q.id, price: q.price, symbol: q.symbol })),
    bonds: data.bonds.map((b) => ({
      capitalization: b.capitalization, currency: b.currency, earlyRedemptionFee: b.earlyRedemptionFee,
      firstYearRate: b.firstYearRate, id: b.id, indexation: b.indexation, margin: b.margin, portfolioId: b.portfolioId,
      symbol: b.symbol, termMonths: b.termMonths,
    })),
    alerts: data.alerts.map((a) => ({
      above: a.above, currency: a.currency, enabled: a.enabled, id: a.id,
      lastTriggeredAt: a.lastTriggeredAt ? iso(a.lastTriggeredAt) : null, symbol: a.symbol, targetPrice: a.targetPrice,
    })),
  };
  return JSON.stringify(sortKeys(obj), null, 2) + "\n";
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    // Like Swift's Codable, omit empty optionals instead of writing null.
    return Object.fromEntries(Object.entries(v as object).filter(([, x]) => x !== null).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sortKeys(x)]));
  }
  return v;
}

/** Parse a v1 or v2 backup. Missing `bonds`/`alerts` (v1) mean "nothing to restore". */
export function importBackup(text: string): { data: Dataset; hasAlerts: boolean; exportedAt: Date | null } {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BackupError("To nie jest poprawny plik JSON.");
  }
  if (raw.format !== BACKUP_FORMAT) throw new BackupError("To nie jest backup LibreWallet.");
  const version = num(raw.version, "version");
  if (version > BACKUP_VERSION) throw new BackupError(`Backup w nowszej wersji formatu (${version}) — zaktualizuj LibreWallet.`);

  const out = emptyDataset();
  for (const g of arr(raw.groups)) {
    out.groups.push({ id: str(g.id, "group.id"), name: str(g.name, "group.name"), colorHex: optStr(g.colorHex) ?? "#176b4d", createdAt: date(g.createdAt, "group") });
  }
  for (const p of arr(raw.portfolios)) {
    out.portfolios.push({
      id: str(p.id, "portfolio.id"), groupId: optStr(p.groupId), name: str(p.name, "portfolio.name"),
      baseCurrency: normalizeCurrency(optStr(p.baseCurrency)), colorHex: optStr(p.colorHex) ?? "#176b4d",
      kindRaw: optStr(p.kindRaw) ?? "manual", createdAt: date(p.createdAt, "portfolio"),
    });
  }
  for (const t of arr(raw.transactions)) {
    const typeRaw = optStr(t.typeRaw) ?? "other";
    out.transactions.push({
      id: str(t.id, "transaction.id"), portfolioId: optStr(t.portfolioId), date: date(t.date, "transaction"),
      typeRaw: (TRANSACTION_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : "other",
      symbol: optStr(t.symbol), name: optStr(t.name), quantity: optNum(t.quantity), price: optNum(t.price),
      gross: num(t.gross, "transaction.gross"), fee: num(t.fee, "transaction.fee"), currency: normalizeCurrency(optStr(t.currency)),
      cashDelta: optNum(t.cashDelta), externalId: optStr(t.externalId), notes: optStr(t.notes), source: optStr(t.source), assetType: optStr(t.assetType),
    });
  }
  for (const t of arr(raw.targets)) {
    out.targets.push({ id: str(t.id, "target.id"), portfolioId: optStr(t.portfolioId), assetType: str(t.assetType, "target.assetType"), targetPct: num(t.targetPct, "target.targetPct"), createdAt: date(t.createdAt, "target") });
  }
  for (const q of arr(raw.quotes)) {
    out.quotes.push({ id: str(q.id, "quote.id"), symbol: str(q.symbol, "quote.symbol"), currency: str(q.currency, "quote.currency"), price: num(q.price, "quote.price"), asOf: date(q.asOf, "quote") });
  }
  for (const b of arr(raw.bonds)) {
    out.bonds.push({
      id: str(b.id, "bond.id"), portfolioId: optStr(b.portfolioId), symbol: str(b.symbol, "bond.symbol"), currency: normalizeCurrency(optStr(b.currency)),
      termMonths: num(b.termMonths, "bond.termMonths"), firstYearRate: num(b.firstYearRate, "bond.firstYearRate"), margin: num(b.margin, "bond.margin"),
      indexation: str(b.indexation, "bond.indexation"), capitalization: b.capitalization === true, earlyRedemptionFee: num(b.earlyRedemptionFee, "bond.fee"),
    });
  }
  for (const a of arr(raw.alerts)) {
    out.alerts.push({
      id: str(a.id, "alert.id"), symbol: str(a.symbol, "alert.symbol"), currency: optStr(a.currency) ?? "PLN", targetPrice: num(a.targetPrice, "alert.targetPrice"),
      above: a.above !== false, enabled: a.enabled !== false, lastTriggeredAt: a.lastTriggeredAt ? date(a.lastTriggeredAt, "alert") : null,
    });
  }
  return { data: out, hasAlerts: Array.isArray(raw.alerts), exportedAt: raw.exportedAt ? date(raw.exportedAt, "exportedAt") : null };
}
