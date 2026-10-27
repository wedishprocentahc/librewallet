import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diskAssets, seaAssets } from "./assets.ts";
import { createApp } from "./http.ts";
import { osNotifier } from "./notify.ts";
import { defaultDataDir } from "./paths.ts";
import { Service } from "./service.ts";
import { Store } from "./store.ts";

declare const __LW_VERSION__: string | undefined;

async function main(): Promise<void> {
  const sea = await seaAssets();
  const here = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const version = typeof __LW_VERSION__ === "string" ? __LW_VERSION__ : (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string }).version;
  const assets = sea ?? diskAssets(join(here, "..", "ui"));
  const basePort = Number(process.env.PORT ?? 8788);
  // Loopback only: the app serves private financial data and must never listen on the network.
  const host = "127.0.0.1";
  const noOpen = process.argv.includes("--no-open") || process.env.LIBREWALLET_NO_OPEN === "1";

  function openBrowser(url: string): void {
    if (noOpen) return;
    const [cmd, args]: [string, string[]] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    try {
      spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    } catch { /* no browser available: the URL is printed below */ }
  }

  /** If LibreWallet already answers on this port, reuse it instead of starting a second instance on the same data. */
  async function alreadyRunning(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(800) });
      return res.ok && ((await res.json()) as { service?: string }).service === "librewallet";
    } catch {
      return false;
    }
  }

  if (await alreadyRunning(basePort)) {
    console.log(`LibreWallet is already running → http://${host}:${basePort}`);
    openBrowser(`http://${host}:${basePort}`);
    process.exit(0);
  }

  const store = new Store(process.env.LIBREWALLET_DATA_DIR ?? defaultDataDir());
  const service = new Service(store, { version, notifier: osNotifier });
  const backup = service.ensureDailyBackup();
  const server = createApp(service, { assets });

  let port = basePort;
  await new Promise<void>((resolve, reject) => {
    const attempt = () => {
      server.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE" && port < basePort + 20) { port++; attempt(); } else reject(e);
      });
      server.listen(port, host, resolve);
    };
    attempt();
  });
  const url = `http://${host}:${port}`;
  console.log(`LibreWallet ${version} → ${url}`);
  console.log(`Data: ${store.dir}${backup ? ` (backup: ${backup})` : ""}`);
  openBrowser(url);

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
  // With auto refresh off, alerts are still evaluated locally (no network) on the same cadence as the native app.
  setInterval(() => { if (service.settings.autoRefreshMinutes === 0) service.checkAlerts(); }, 45_000).unref();
  schedule();

  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { server.close(); store.close(); process.exit(0); });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
