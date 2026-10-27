import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname } from "node:path";
import type { AssetReader } from "./assets.ts";
import { HttpError, parseScope, type Service } from "./service.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};
const MAX_BODY = 64 * 1024 * 1024;

type Json = Record<string, unknown>;
interface Ctx { url: URL; params: Record<string, string>; body: Json; raw: Buffer; headers: IncomingMessage["headers"] }
type Reply = { status?: number; json?: unknown; text?: string; type?: string; filename?: string };
type Handler = (c: Ctx) => Reply | Promise<Reply> | unknown;

interface Route { method: string; re: RegExp; keys: string[]; handler: Handler }

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:([a-zA-Z]+)/g, (_, k: string) => { keys.push(k); return "([^/]+)"; }) + "$");
  return { method, re, keys, handler };
}

const q = (c: Ctx, k: string) => c.url.searchParams.get(k);
const scopeOf = (c: Ctx) => parseScope(q(c, "scope"));
const reply = (json: unknown): Reply => ({ json });

export function buildRoutes(s: Service): Route[] {
  return [
    route("GET", "/api/health", () => reply({ ok: true, service: "librewallet", version: s.version, source: "web" })),
    route("GET", "/api/bootstrap", () => reply(s.bootstrap())),
    route("PUT", "/api/settings", (c) => reply(s.updateSettings(c.body))),
    route("GET", "/api/dashboard", async (c) => {
      const bench = q(c, "benchmark") ?? s.settings.selectedBenchmark;
      let error: string | null = null;
      if (bench && !s.isBenchmarkLoaded(bench)) {
        try { await s.ensureBenchmark(bench); } catch (e) { error = e instanceof Error ? e.message : String(e); }
      }
      return reply({ ...s.dashboard(scopeOf(c), bench), benchmarkError: error });
    }),
    route("GET", "/api/positions", (c) => reply(s.positions(scopeOf(c)))),
    route("POST", "/api/positions/delete", (c) => reply(s.deletePosition(c.body))),
    route("GET", "/api/transactions", (c) => reply(s.transactions(scopeOf(c), { search: q(c, "q") ?? undefined, type: q(c, "type") ?? undefined, limit: q(c, "limit") ? Number(q(c, "limit")) : undefined }))),
    route("POST", "/api/transactions", (c) => reply(s.addTransaction(c.body))),
    route("PUT", "/api/transactions/:id", (c) => { s.updateTransaction(c.params.id!, c.body); return reply({ ok: true }); }),
    route("POST", "/api/transactions/delete", (c) => reply(s.deleteTransactions(Array.isArray(c.body.ids) ? (c.body.ids as string[]) : []))),
    route("GET", "/api/rebalance", (c) => reply(s.rebalance(scopeOf(c)))),
    route("PUT", "/api/targets", (c) => { s.setTarget(parseScope(String(c.body.scope ?? "all")), String(c.body.assetType), Number(c.body.pct)); return reply({ ok: true }); }),
    route("GET", "/api/bonds", () => reply(s.bonds())),
    route("POST", "/api/bonds", (c) => reply(s.addBond(c.body))),
    route("POST", "/api/bonds/redeem", (c) => { s.redeemBond(c.body); return reply({ ok: true }); }),
    route("GET", "/api/cashflow", (c) => reply(s.cashflow(scopeOf(c), q(c, "year") ? Number(q(c, "year")) : null))),
    route("GET", "/api/tax", async (c) => reply(await s.tax({ year: Number(q(c, "year") ?? new Date().getFullYear()), scope: scopeOf(c), includeExempt: q(c, "includeExempt") === "1" }))),
    route("GET", "/api/tax.csv", async (c) => {
      const t = await s.tax({ year: Number(q(c, "year") ?? new Date().getFullYear()), scope: scopeOf(c), includeExempt: q(c, "includeExempt") === "1" });
      return { text: t.csv, type: "text/csv", filename: `librewallet-tax-${t.summary.year}.csv` };
    }),
    route("GET", "/api/alerts", () => reply(s.alerts())),
    route("POST", "/api/alerts", (c) => reply(s.addAlert(c.body))),
    route("PUT", "/api/alerts/:id", (c) => { s.setAlertEnabled(c.params.id!, c.body.enabled !== false); return reply({ ok: true }); }),
    route("DELETE", "/api/alerts/:id", (c) => { s.deleteAlert(c.params.id!); return reply({ ok: true }); }),
    route("POST", "/api/alerts/check", (c) => reply({ fired: s.checkAlerts(c.body.force === true) })),
    route("POST", "/api/notifications/test", () => reply({ sent: s.sendTestNotification() })),
    route("GET", "/api/notifications", () => reply({ notifications: s.drainNotifications() })),
    route("POST", "/api/portfolios", (c) => reply(s.createPortfolio(c.body))),
    route("PUT", "/api/portfolios/:id", (c) => reply(s.updatePortfolio(c.params.id!, c.body))),
    route("DELETE", "/api/portfolios/:id", (c) => { s.deletePortfolio(c.params.id!); return reply({ ok: true }); }),
    route("POST", "/api/groups", (c) => reply(s.createGroup(c.body))),
    route("PUT", "/api/groups/:id", (c) => reply(s.updateGroup(c.params.id!, c.body))),
    route("DELETE", "/api/groups/:id", (c) => { s.deleteGroup(c.params.id!); return reply({ ok: true }); }),
    route("POST", "/api/import/preview", (c) => {
      const name = decodeURIComponent(String(c.headers["x-filename"] ?? "import.csv"));
      const kind = c.headers["x-import-kind"];
      return reply(s.importPreview({ name, data: new Uint8Array(c.raw) }, kind === "xtb" || kind === "universal" || kind === "ibkr" ? kind : undefined));
    }),
    route("POST", "/api/import/commit", (c) => reply(s.importCommit(c.body))),
    route("GET", "/api/backup", () => ({ text: s.backupJson(), type: "application/json", filename: `librewallet-backup-${new Date().toISOString().slice(0, 10)}.json` })),
    route("POST", "/api/backup/restore", (c) => reply(s.restoreBackup(c.raw.toString("utf8")))),
    route("POST", "/api/clear", () => { s.clearData(); return reply({ ok: true }); }),
    route("GET", "/api/export/transactions.csv", () => ({ text: s.transactionsCsv(), type: "text/csv", filename: "librewallet-transactions.csv" })),
    route("GET", "/api/export/template.csv", () => ({ text: s.templateCsv(), type: "text/csv", filename: "librewallet-template.csv" })),
    route("POST", "/api/refresh", async () => reply(await s.refreshAll())),
    route("POST", "/api/refresh/quotes", async () => reply(await s.refreshQuotes())),
    route("POST", "/api/refresh/histories", async () => reply(await s.refreshHistories())),
    route("POST", "/api/refresh/rates", async () => reply({ rates: await s.refreshRates() })),
    // Local integration API (compatible with the native app)
    route("GET", "/api/holdings", () => reply(s.holdings())),
    route("GET", "/api/portfolio", () => reply(s.portfolioApi())),
    route("GET", "/api/agent-feed", () => reply(s.agentFeed())),
    route("POST", "/api/quotes/test", async (c) => reply(await s.testQuote(String(c.body.symbol ?? ""), String(c.body.providerSymbol ?? ""), typeof c.body.currency === "string" ? c.body.currency : null))),
    route("POST", "/api/quotes", async () => reply(await s.refreshQuotes())),
    route("GET", "/api/updates/check", async () => reply(await s.checkUpdates())),
  ];
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, "Plik jest za duży.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string>): void {
  res.writeHead(status, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers });
  res.end(body);
}

export function createApp(service: Service, opts: { assets: AssetReader }): Server {
  const routes = buildRoutes(service);
  return createServer(async (req, res) => {
    try {
      // DNS-rebinding guard: only answer requests addressed to the loopback host.
      if (!LOCAL_HOST.test(String(req.headers.host ?? ""))) throw new HttpError(403, "Forbidden host");
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";

      if (url.pathname.startsWith("/api/")) {
        // CSRF guard: writes need a custom header, which cross-origin pages cannot send without a CORS preflight (never granted).
        if (method !== "GET" && method !== "HEAD" && req.headers["x-librewallet"] !== "1") throw new HttpError(403, "Missing X-LibreWallet header");
        const found = routes.map((r) => ({ r, m: r.re.exec(url.pathname) })).find((x) => x.m && x.r.method === method);
        if (!found?.m) throw new HttpError(404, "Not found");
        const params = Object.fromEntries(found.r.keys.map((k, i) => [k, decodeURIComponent(found.m![i + 1]!)]));
        const raw = method === "GET" || method === "DELETE" ? Buffer.alloc(0) : await readBody(req);
        let body: Json = {};
        if (raw.length > 0 && String(req.headers["content-type"] ?? "").includes("application/json")) {
          try { body = JSON.parse(raw.toString("utf8")) as Json; } catch { throw new HttpError(400, "Nieprawidłowy JSON."); }
        }
        const out = (await found.r.handler({ url, params, body, raw, headers: req.headers })) as Reply;
        if (out.text !== undefined) {
          send(res, out.status ?? 200, out.text, { "Content-Type": `${out.type ?? "text/plain"}; charset=utf-8`, ...(out.filename ? { "Content-Disposition": `attachment; filename="${out.filename}"` } : {}) });
        } else {
          send(res, out.status ?? 200, JSON.stringify(out.json ?? {}), { "Content-Type": "application/json; charset=utf-8" });
        }
        return;
      }

      if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "Method not allowed");
      const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      if (rel.split(/[\\/]/).includes("..")) throw new HttpError(403, "Forbidden");
      const body = await opts.assets(rel);
      if (!body) throw new HttpError(404, "Not found");
      send(res, 200, body, { "Content-Type": MIME[extname(rel)] ?? "application/octet-stream" });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : "Server error";
      send(res, status, JSON.stringify({ error: message }), { "Content-Type": "application/json; charset=utf-8" });
    }
  });
}
