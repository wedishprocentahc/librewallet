import type { TransactionType } from "./types.ts";

export interface DealDetails {
  quantity: number;
  price: number;
}

const DEAL_RE =
  /\b(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+(?:\S*[A-Za-z]\S*\s+)?([0-9]+(?:[.,][0-9]+)?)(?:\s*\/\s*[0-9]+(?:[.,][0-9]+)?)?\s*@\s*([0-9]+(?:[.,][0-9]+)?)/i;

export function parseLooseNumber(value: string): number | null {
  const s = value.trim().replaceAll(" ", "").replaceAll(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDealComment(comment: string | null | undefined): DealDetails {
  const m = DEAL_RE.exec(comment ?? "");
  if (!m) return { quantity: 0, price: 0 };
  return {
    quantity: Math.abs(parseLooseNumber(m[1]!) ?? 0),
    price: Math.abs(parseLooseNumber(m[2]!) ?? 0),
  };
}

const norm = (v: string) => v.trim().toLowerCase();
const re = (pattern: string) => new RegExp(pattern, "i");
const TOTALS = re("^(total|profit/loss|profit loss|saldo|suma)$");

export function mapOperationType(rowType: string): TransactionType | null {
  const v = norm(rowType);
  if (v === "" || TOTALS.test(v)) return null;
  const is = (p: string) => re(p).test(v);
  if (is("^stock purchase") || is("^zakup")) return "buy";
  if (is("^stock sell") || is("^sprzed")) return "sell";
  if (is("^ike deposit") || is("^ikze deposit")) return "transfer";
  if (is("^deposit") || is("^wplata")) return "deposit";
  if (is("^withdrawal") || is("^wyplata")) return "withdrawal";
  if (is("^subaccount transfer") || is("^transfer") || is("^przelew") || is("^konwersja")) return "transfer";
  if (is("^dividend") || is("^divident") || is("^dywidenda")) return "dividend";
  if (is("withholding tax") || is("free.funds interest tax") || is("^podatek")) return "tax";
  if (is("free.funds interest") || is("^odset") || is("^interest")) return "interest";
  return null;
}

export function detectOperationType(
  text: string,
  amount: number,
  symbol: string | null | undefined,
  quantity: number,
  price: number,
): TransactionType {
  const v = norm(text);
  const is = (p: string) => re(p).test(v);
  const noSymbol = !symbol;
  if (TOTALS.test(v)) return "other";
  if (is("(tax|podatek)")) return "tax";
  if (is("ike deposit|ikze deposit")) return "transfer";
  if (is("(dywid|dividend)")) return "dividend";
  if (is("(odset|interest|coupon)")) return "interest";
  if (is("(wplat|deposit|cash in|zasil)")) return "deposit";
  if (is("(wyplat|withdraw|cash out)")) return "withdrawal";
  if (is("(transfer|currency conversion|conversion|subaccount transfer|konwersja|przelew miedzy|przelew)") && noSymbol) {
    return "transfer";
  }
  if (is("(stock sell|sprzed|sell|market sell|close buy|close sell)")) return "sell";
  if (is("(stock purchase|purchase|kup|buy|market buy|open buy)")) return "buy";
  if (symbol && quantity > 0 && price > 0) return amount > 0 ? "sell" : "buy";
  if (noSymbol && amount < 0) return "withdrawal";
  if (noSymbol && amount > 0) return "deposit";
  return "other";
}

export function resolveType(args: {
  rowType: string;
  sideText: string;
  amount: number;
  symbol: string | null | undefined;
  quantity: number | null | undefined;
  price: number | null | undefined;
  existingType: TransactionType;
}): TransactionType {
  if (args.existingType !== "other") return args.existingType;
  const deal = parseDealComment(args.sideText);
  const qty = Math.abs(args.quantity ?? 0) > 0 ? Math.abs(args.quantity ?? 0) : deal.quantity;
  const px = Math.abs(args.price ?? 0) > 0 ? Math.abs(args.price ?? 0) : deal.price;
  return mapOperationType(args.rowType) ?? detectOperationType(args.sideText, args.amount, args.symbol, qty, px);
}

export function grossMagnitude(amount: number, quantity: number, price: number): number {
  const a = Math.abs(amount);
  return a > 0 ? a : quantity * price;
}
