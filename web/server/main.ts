import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./http.ts";
import { defaultDataDir } from "./paths.ts";
import { Service } from "./service.ts";
import { Store } from "./store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const version = (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string }).version;
const port = Number(process.env.PORT ?? 8788);
// Loopback only: the app serves private financial data and must never listen on the network.
const host = "127.0.0.1";

const store = new Store(process.env.LIBREWALLET_DATA_DIR ?? defaultDataDir());
const service = new Service(store, { version });
const backup = service.ensureDailyBackup();
const server = createApp(service, { uiDir: join(here, "..", "ui") });

server.listen(port, host, () => {
  console.log(`LibreWallet ${version} → http://${host}:${port}`);
  console.log(`Data: ${store.dir}${backup ? ` (backup: ${backup})` : ""}`);
});

let timer: NodeJS.Timeout | undefined;
function schedule(): void {
  clearTimeout(timer);
  const minutes = service.settings.autoRefreshMinutes;
  timer = setTimeout(async () => {
    try { await service.refreshAll(); } catch (e) { console.error("auto refresh failed:", e instanceof Error ? e.message : e); }
    schedule();
  }, Math.max(1, minutes > 0 ? minutes : 5) * 60_000);
  timer.unref();
}
// Alerts are checked on the same cadence even when auto refresh is off (no network then — only local evaluation).
setInterval(() => { if (service.settings.autoRefreshMinutes === 0) service.checkAlerts(); }, 45_000).unref();
schedule();

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { server.close(); store.close(); process.exit(0); });
