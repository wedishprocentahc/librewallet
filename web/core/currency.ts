const PLN_ACCOUNT_PRODUCTS = new Set(["IKE", "IKZE"]);

/** Normalize a currency / account-label string to an ISO code. IKE/IKZE and empty → PLN. */
export function normalizeCurrency(raw: string | null | undefined): string {
  const code = (raw ?? "").trim().toUpperCase();
  if (code === "" || PLN_ACCOUNT_PRODUCTS.has(code)) return "PLN";
  return code;
}

export function isAccountProductLabel(raw: string | null | undefined): boolean {
  return PLN_ACCOUNT_PRODUCTS.has((raw ?? "").trim().toUpperCase());
}

export type RatesToPLN = Record<string, number>;

export function convertToPLN(amount: number, currency: string, rates: RatesToPLN): number {
  const code = normalizeCurrency(currency);
  if (code === "PLN") return amount;
  const rate = rates[code];
  return rate === undefined ? amount : amount * rate;
}

/** Convert a price between currencies using PLN as the bridge (NBP table A). */
export function convertPrice(price: number, from: string, to: string, rates: RatesToPLN): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return price;
  const fromRate = f === "PLN" ? 1 : rates[f];
  const toRate = t === "PLN" ? 1 : rates[t];
  if (!(fromRate > 0) || !(toRate > 0)) return null;
  return (price * fromRate) / toRate;
}
