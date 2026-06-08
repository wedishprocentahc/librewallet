"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/quotes") {
      await handleQuotes(request, response);
      return;
    }
    if (url.pathname === "/api/history") {
      await handleHistory(request, response);
      return;
    }
    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, service: "torba", version: process.env.TORBA_VERSION || "1.0.0" });
      return;
    }
    serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Server error" });
  }
});

function startTorba(options = {}) {
  const port = Number(options.port || process.env.TORBA_PORT || process.env.PORT || PORT);
  const host = options.host || process.env.TORBA_HOST || process.env.HOST || HOST;
  const openHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const url = `http://${openHost}:${port}/`;
      console.log(`Torba działa na ${url}`);
      console.log("Zamknij to okno, żeby zatrzymać aplikację.");
      resolve({ port, host, url });
    });
  });
}

module.exports = { startTorba };

if (require.main === module) {
  startTorba().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

async function handleQuotes(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST" });
    return;
  }
  const body = await readBody(request);
  const payload = JSON.parse(body || "{}");
  const instruments = normalizeInstruments(payload.instruments || []);
  if (!instruments.length) {
    sendJson(response, 400, { error: "Brak instrumentów do wyceny." });
    return;
  }

  const yahooQuotes = await fetchYahooQuotes(instruments).catch((error) => ({
    quotes: [],
    warning: error.message,
  }));
  const fx = await fetchYahooFx(["USD", "EUR", "GBP", "CHF"]).catch(() => ({}));

  sendJson(response, 200, {
    fetchedAt: new Date().toISOString(),
    quotes: yahooQuotes.quotes,
    fx,
    warnings: yahooQuotes.warning ? [yahooQuotes.warning] : [],
  });
}

async function handleHistory(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST" });
    return;
  }
  const body = await readBody(request);
  const payload = JSON.parse(body || "{}");
  const instruments = normalizeInstruments(payload.instruments || []);
  if (!instruments.length) {
    sendJson(response, 400, { error: "Brak instrumentów do pobrania historii." });
    return;
  }

  const { from, to } = normalizeHistoryRange(payload.from, payload.to);
  const { histories, warnings } = await fetchYahooHistories(instruments, from, to);
  const fxHistory = await fetchYahooFxHistory(["USD", "EUR", "GBP", "CHF"], from, to).catch((error) => {
    warnings.push(error.message);
    return { PLN: [{ date: from, close: 1 }] };
  });

  sendJson(response, 200, {
    fetchedAt: new Date().toISOString(),
    from,
    to,
    histories,
    fxHistory,
    warnings,
  });
}

function serveStatic(urlPath, response) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const relativePath = safePath === "/" || safePath === path.sep ? "index.html" : safePath.replace(/^[/\\]+/, "");
  const filePath = path.join(ROOT, relativePath);
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    const headers = { "Content-Type": contentType };
    if (path.extname(filePath) === ".js") {
      headers["Cache-Control"] = "no-store";
    }
    response.writeHead(200, headers);
    response.end(data);
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeInstruments(instruments) {
  const seen = new Set();
  return instruments
    .map((instrument) => ({
      symbol: String(instrument.symbol || "").trim().toUpperCase(),
      name: String(instrument.name || "").trim(),
      positionCurrency: String(instrument.positionCurrency || "PLN").trim().toUpperCase(),
    }))
    .filter((instrument) => instrument.symbol)
    .filter((instrument) => {
      const key = instrumentKey(instrument.symbol, instrument.positionCurrency);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function fetchYahooQuotes(instruments) {
  const candidateFns = [yahooCandidates, stooqCandidates];
  const symbolsToFetch = unique(
    instruments.flatMap((instrument) => candidateFns.flatMap((candidateFn) => candidateFn(instrument.symbol))),
  );
  if (!symbolsToFetch.length) return { quotes: [] };

  const chartResults = await Promise.all(
    symbolsToFetch.map(async (symbol) => {
      const chart = await fetchYahooChartQuote(symbol).catch(() => null);
      return [symbol.toUpperCase(), chart];
    }),
  );
  const chartBySymbol = new Map(chartResults.filter(([, chart]) => chart).map(([symbol, chart]) => [symbol, chart]));
  const quotes = [];
  const quotedKeys = new Set();

  instruments.forEach((instrument) => {
    const key = instrumentKey(instrument.symbol, instrument.positionCurrency);
    if (quotedKeys.has(key)) return;
    const candidates = unique(candidateFns.flatMap((candidateFn) => candidateFn(instrument.symbol)));
    for (const candidate of candidates) {
      const chart = chartBySymbol.get(candidate.toUpperCase());
      if (!chart) continue;
      quotes.push({
        requestedSymbol: instrument.symbol,
        positionCurrency: instrument.positionCurrency,
        provider: "yahoo",
        symbol: chart.symbol,
        price: chart.price,
        currency: chart.currency || inferCurrencyFromSymbol(instrument.symbol),
        marketTime: chart.marketTime,
        name: chart.name || instrument.name,
      });
      quotedKeys.add(key);
      break;
    }
  });

  return { quotes };
}

async function fetchYahooChartQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 TorbaPortfolio/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Yahoo chart zwrócił HTTP ${response.status}.`);
  const data = await response.json();
  if (data.chart?.error) throw new Error(data.chart.error.description || "Yahoo chart error");
  const result = data.chart?.result?.[0];
  if (!result) throw new Error("Brak danych Yahoo chart.");
  const meta = result.meta || {};
  const price = Number(meta.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Brak ceny Yahoo chart.");
  return {
    symbol: meta.symbol || symbol,
    price,
    currency: meta.currency || inferCurrencyFromSymbol(symbol),
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : "",
    name: meta.longName || meta.shortName || "",
  };
}

async function fetchYahooHistories(instruments, from, to) {
  const histories = [];
  const warnings = [];

  for (const instrument of instruments) {
    const history = await fetchYahooHistoryForInstrument(instrument, from, to).catch((error) => {
      warnings.push(`${instrument.symbol}: ${error.message}`);
      return null;
    });
    if (history) {
      histories.push(history);
    } else {
      warnings.push(`${instrument.symbol}: brak historii dziennej`);
    }
  }

  return { histories, warnings };
}

async function fetchYahooHistoryForInstrument(instrument, from, to) {
  for (const candidate of yahooCandidates(instrument.symbol)) {
    const history = await fetchYahooChart(candidate, from, to).catch(() => null);
    if (history?.prices?.length) {
      return {
        requestedSymbol: instrument.symbol,
        positionCurrency: instrument.positionCurrency,
        provider: "yahoo",
        symbol: history.symbol,
        currency: history.currency || inferCurrencyFromSymbol(candidate),
        name: history.name || instrument.name,
        prices: history.prices,
      };
    }
  }
  return null;
}

async function fetchYahooFxHistory(currencies, from, to) {
  const fxHistory = { PLN: [{ date: from, close: 1 }] };
  for (const currency of currencies.filter((item) => item !== "PLN")) {
    const history = await fetchYahooChart(`${currency}PLN=X`, from, to).catch(() => null);
    if (history?.prices?.length) {
      fxHistory[currency] = history.prices;
    }
  }
  return fxHistory;
}

async function fetchYahooChart(symbol, from, to) {
  const period1 = unixSeconds(from);
  const period2 = unixSeconds(addDays(to, 1));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 TorbaPortfolio/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Yahoo chart zwrócił HTTP ${response.status}.`);
  const data = await response.json();
  if (data.chart?.error) throw new Error(data.chart.error.description || "Yahoo chart error");
  const result = data.chart?.result?.[0];
  if (!result) throw new Error("Brak danych Yahoo chart.");
  const closes = result.indicators?.quote?.[0]?.close || [];
  const timestamps = result.timestamp || [];
  const prices = timestamps
    .map((timestamp, index) => ({
      date: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
      close: Number(closes[index]),
    }))
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0);

  return {
    symbol: result.meta?.symbol || symbol,
    currency: result.meta?.currency || inferCurrencyFromSymbol(symbol),
    name: result.meta?.longName || result.meta?.shortName || "",
    prices,
  };
}

async function fetchYahooFx(currencies) {
  const fx = { PLN: 1 };
  await Promise.all(
    currencies
      .filter((currency) => currency !== "PLN")
      .map(async (currency) => {
        const chart = await fetchYahooChartQuote(`${currency}PLN=X`).catch(() => null);
        if (chart && Number.isFinite(chart.price) && chart.price > 0) {
          fx[currency] = chart.price;
        }
      }),
  );
  return fx;
}

function yahooCandidates(symbol) {
  const upper = String(symbol || "").toUpperCase();
  if (upper.startsWith("^")) {
    const base = upper.slice(1);
    return unique([`${base}.WA`, `${base}TR.WA`, upper, base]);
  }
  const parsed = splitSymbol(symbol);
  if (parsed.suffix === "US") return unique([parsed.base, symbol]);
  if (parsed.suffix === "PL") return unique([`${parsed.base}.WA`, parsed.base, symbol]);
  if (parsed.suffix === "WA") return unique([symbol, parsed.base]);
  if (parsed.suffix === "UK") return unique([`${parsed.base}.L`, symbol]);
  return unique([symbol]);
}

function stooqCandidates(symbol) {
  const parsed = splitSymbol(symbol);
  if (parsed.suffix === "PL") return unique([parsed.base, symbol]);
  if (parsed.suffix === "US") return unique([symbol, parsed.base]);
  return unique([symbol]);
}

function splitSymbol(symbol) {
  const [base, suffix = ""] = String(symbol || "").toUpperCase().split(".");
  return { base, suffix };
}

function normalizeHistoryRange(fromValue, toValue) {
  const today = toDateInput(new Date());
  const from = parseDateText(fromValue) || today;
  const to = parseDateText(toValue) || today;
  return from <= to ? { from, to } : { from: to, to: from };
}

function parseDateText(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[0] : "";
}

function unixSeconds(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

function addDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return toDateInput(date);
}

function toDateInput(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferCurrencyFromSymbol(symbol) {
  const suffix = splitSymbol(symbol).suffix;
  if (suffix === "PL" || suffix === "WA" || !suffix) return "PLN";
  if (suffix === "DE") return "EUR";
  if (suffix === "UK" || suffix === "L" || suffix === "US") return "USD";
  return "PLN";
}

function instrumentKey(symbol, currency) {
  return `${String(symbol || "").toUpperCase()}|${String(currency || "PLN").toUpperCase()}`;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
