import { isAccountProductLabel, normalizeCurrency } from "../currency.ts";
import { type Dataset, newId, type Portfolio, type PortfolioGroup, type Transaction } from "../types.ts";
import { filterNewImports, type ImportedTransaction, importFingerprint } from "./importers.ts";

export interface CommitResult {
  saved: number;
  skipped: number;
  /** Portfolio that should be selected afterwards (last touched account portfolio, or the chosen target). */
  portfolioId: string | null;
}

/** Whether the import should create/find per-account XTB portfolios instead of using a chosen target. */
export function autoCreatesPortfolios(items: ImportedTransaction[], previewSource?: string | null): boolean {
  if (previewSource && /xtb/i.test(previewSource)) return true;
  if (items.some((i) => /xtb/i.test(i.source ?? ""))) return true;
  return items.some((i) => (i.account ?? "") !== "");
}

function ensureXtbGroup(data: Dataset): PortfolioGroup {
  const existing = data.groups.find((g) => g.name.toLowerCase() === "xtb");
  if (existing) return existing;
  const g: PortfolioGroup = { id: newId(), name: "XTB", colorHex: "#176b4d", createdAt: new Date() };
  data.groups.push(g);
  return g;
}

function ensureXtbPortfolio(data: Dataset, group: PortfolioGroup, account: string, currency: string): Portfolio {
  const label = currency.trim().toUpperCase();
  const baseCurrency = normalizeCurrency(label);
  // Keep IKE/IKZE in the display name; the settle currency is always PLN.
  const token = isAccountProductLabel(label) ? label : baseCurrency;
  const name = `XTB ${token} (${account})`;
  const existing = data.portfolios.find((p) => p.groupId === group.id && p.name === name);
  if (existing) {
    if (existing.baseCurrency !== baseCurrency) existing.baseCurrency = baseCurrency;
    return existing;
  }
  const p: Portfolio = { id: newId(), groupId: group.id, name, baseCurrency, colorHex: "#176b4d", kindRaw: "account", createdAt: new Date() };
  data.portfolios.push(p);
  return p;
}

function toTransaction(item: ImportedTransaction, portfolioId: string, externalId: string | null): Transaction {
  return {
    id: newId(), portfolioId, date: item.date, typeRaw: item.type, symbol: item.symbol, name: item.name,
    quantity: item.quantity, price: item.price, gross: item.gross, fee: item.fee, currency: normalizeCurrency(item.currency),
    cashDelta: item.cashDelta, externalId, notes: item.notes, source: item.source, assetType: item.assetType,
  };
}

/** Dedupe against stored data and insert (mutates `data`). Mirrors the native import screen. */
export function commitImport(data: Dataset, items: ImportedTransaction[], opts: { targetPortfolioId?: string | null; previewSource?: string | null } = {}): CommitResult {
  const knownIds = new Set(data.transactions.map((t) => (t.externalId ?? "").trim()).filter((s) => s !== ""));
  const fingerprints = new Set(data.transactions.map((t) => importFingerprint(t.typeRaw, t.symbol, t.date, t.quantity, t.cashDelta, t.currency)));
  const filtered = filterNewImports(items, knownIds, fingerprints);
  let saved = 0;

  const insert = (item: ImportedTransaction, portfolioId: string): boolean => {
    const ext = (item.externalId ?? "").trim();
    if (ext !== "") {
      if (knownIds.has(ext)) return false;
      knownIds.add(ext);
    }
    data.transactions.push(toTransaction(item, portfolioId, ext === "" ? null : ext));
    saved++;
    return true;
  };

  let portfolioId: string | null = opts.targetPortfolioId ?? null;
  if (autoCreatesPortfolios(items, opts.previewSource)) {
    const group = ensureXtbGroup(data);
    const byAccount = new Map<string, ImportedTransaction[]>();
    for (const item of filtered.toInsert) {
      const key = `${item.account ?? "XTB"}\u0000${item.currency}`;
      byAccount.set(key, [...(byAccount.get(key) ?? []), item]);
    }
    for (const [key, group_items] of byAccount) {
      const [account, currency] = key.split("\u0000") as [string, string];
      const portfolio = ensureXtbPortfolio(data, group, account, currency);
      portfolioId = portfolio.id;
      for (const item of group_items) insert(item, portfolio.id);
    }
  } else {
    if (!portfolioId || !data.portfolios.some((p) => p.id === portfolioId)) throw new Error("Wybierz portfel docelowy.");
    for (const item of filtered.toInsert) insert(item, portfolioId);
  }
  return { saved, skipped: filtered.skippedDuplicates + (filtered.toInsert.length - saved), portfolioId };
}
