import { detectAssetType } from "./assetType.ts";

/** Stored asset type wins; otherwise detect from symbol/name (Swift: `tx.assetType ?? detect`). */
export function assetTypeOrDetect(stored: string | null | undefined, symbol: string | null | undefined, name: string | null | undefined): string {
  return stored ?? detectAssetType(symbol, name);
}
