import { newId, type Portfolio, type Quote, type Transaction } from "../core/types.ts";

export function portfolio(over: Partial<Portfolio> = {}): Portfolio {
  return { id: newId(), groupId: null, name: "P", baseCurrency: "PLN", colorHex: "#000000", kindRaw: "manual", createdAt: new Date(), ...over };
}

export function tx(over: Partial<Transaction> & Pick<Transaction, "typeRaw">): Transaction {
  return {
    id: newId(), portfolioId: null, date: new Date(0), symbol: null, name: null, quantity: null, price: null,
    gross: 0, fee: 0, currency: "PLN", cashDelta: null, externalId: null, notes: null, source: null, assetType: null,
    ...over,
  };
}

export function quote(symbol: string, currency: string, price: number): Quote {
  return { id: newId(), symbol, currency, price, asOf: new Date() };
}

export function utcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}
