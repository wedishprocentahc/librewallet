export type TransactionType =
  | "buy"
  | "sell"
  | "deposit"
  | "withdrawal"
  | "transfer"
  | "fee"
  | "tax"
  | "dividend"
  | "interest"
  | "other";

export const TRANSACTION_TYPES: readonly TransactionType[] = [
  "buy", "sell", "deposit", "withdrawal", "transfer", "fee", "tax", "dividend", "interest", "other",
];

export type PortfolioKind = "account" | "manual";

export interface PortfolioGroup {
  id: string;
  name: string;
  colorHex: string;
  createdAt: Date;
}

export interface Portfolio {
  id: string;
  groupId: string | null;
  name: string;
  baseCurrency: string;
  colorHex: string;
  kindRaw: string;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  portfolioId: string | null;
  date: Date;
  typeRaw: string;
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
}

export interface AllocationTarget {
  id: string;
  portfolioId: string | null;
  assetType: string;
  targetPct: number;
  createdAt: Date;
}

export interface Quote {
  id: string;
  symbol: string;
  currency: string;
  price: number;
  asOf: Date;
}

export interface BondHolding {
  id: string;
  portfolioId: string | null;
  symbol: string;
  currency: string;
  termMonths: number;
  firstYearRate: number;
  margin: number;
  indexation: string;
  capitalization: boolean;
  earlyRedemptionFee: number;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  currency: string;
  targetPrice: number;
  above: boolean;
  enabled: boolean;
  lastTriggeredAt: Date | null;
}

export interface Dataset {
  groups: PortfolioGroup[];
  portfolios: Portfolio[];
  transactions: Transaction[];
  targets: AllocationTarget[];
  quotes: Quote[];
  bonds: BondHolding[];
  alerts: PriceAlert[];
}

export function emptyDataset(): Dataset {
  return { groups: [], portfolios: [], transactions: [], targets: [], quotes: [], bonds: [], alerts: [] };
}

export function txType(tx: Pick<Transaction, "typeRaw">): TransactionType {
  return (TRANSACTION_TYPES as readonly string[]).includes(tx.typeRaw) ? (tx.typeRaw as TransactionType) : "other";
}

export function newId(): string {
  return crypto.randomUUID();
}
