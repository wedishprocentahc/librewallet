import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";

/** UI files come from disk in development and from the embedded asset bundle in a single-file build. */
export type AssetReader = (relPath: string) => Promise<Buffer | null>;

export function diskAssets(uiDir: string): AssetReader {
  return async (rel) => {
    const file = normalize(join(uiDir, rel));
    if (file !== uiDir && !file.startsWith(uiDir + sep)) return null;
    try {
      return await readFile(file);
    } catch {
      return null;
    }
  };
}

export async function seaAssets(): Promise<AssetReader | null> {
  try {
    const sea = await import("node:sea");
    if (!sea.isSea()) return null;
    return async (rel) => {
      try {
        return Buffer.from(sea.getAsset(rel.replaceAll("\\", "/")));
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}
