import { homedir } from "node:os";
import { join } from "node:path";

/** Per-user data directory. Everything the app stores lives here, on the user's own device. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.LIBREWALLET_DATA_DIR) return env.LIBREWALLET_DATA_DIR;
  const home = homedir();
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "LibreWallet");
  if (platform === "darwin") return join(home, "Library", "Application Support", "LibreWallet Web");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "librewallet");
}
