function normalize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ł", "l").replaceAll("ą", "a").replaceAll("ę", "e").replaceAll("ń", "n")
    .replaceAll("ó", "o").replaceAll("ś", "s").replaceAll("ż", "z").replaceAll("ź", "z");
}

function isPolishOrGpwEtfSymbol(symbol: string): boolean {
  let base = symbol.toUpperCase();
  if (base.endsWith(".PL") || base.endsWith(".WA")) base = base.slice(0, -3);
  return base.startsWith("ETF") && base.length > 3;
}

const ETF_TICKERS =
  /\b(vwce|vuaa|vusa|cspx|iwda|eimi|sxr8|swda|vwrl|acwi|qdve|is3n|iusq|eunl|emim|lcuw|meud|spyl|sppw|pr1w|vhyl|vgeg|veur|zprv|zprx|aggu|iuit|eqac|etfbw20tr|etfbm40tr|etfspltr|etfdaxpl|etfsp500)\b/i;
const ETF_WORD = /\betf\b|\betf[a-z0-9]{2,}/i;
const ETF_ISSUERS = /\b(etf|ucits|ishares|vanguard|xtrackers|amundi|lyxor|invesco|spdr|wisdomtree|beta etf)\b/i;
const BOND_WORDS = /\b(bond|oblig|treasury|skarb|edo|coi|tos|rod|ros|ror|dor|ots|rso|catalyst)\b/i;

export function detectAssetType(symbolIn: string | null | undefined, nameIn: string | null | undefined): string {
  const symbol = (symbolIn ?? "").trim();
  const name = (nameIn ?? "").trim();
  const text = normalize(`${symbol} ${name}`);
  if (isPolishOrGpwEtfSymbol(symbol)) return "etf";
  if (ETF_TICKERS.test(text)) return "etf";
  if (ETF_WORD.test(text)) return "etf";
  if (ETF_ISSUERS.test(text)) return "etf";
  if (BOND_WORDS.test(text)) return "bond";
  if (symbol === "" && /cash|gotow/i.test(text)) return "cash";
  if (symbol !== "") return "stock";
  return "other";
}

export const SUPPORTED_ASSET_TYPES = ["etf", "stock", "bond", "cash", "other"] as const;
