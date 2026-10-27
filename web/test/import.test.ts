import assert from "node:assert/strict";
import { test } from "node:test";
import { calculate } from "../core/calculator.ts";
import { commitImport } from "../core/import/commit.ts";
import { filterNewImports, importFile, importIbkr, importUniversal, importXtbZip, ImportError } from "../core/import/importers.ts";
import { emptyDataset } from "../core/types.ts";
import { makeXlsx, makeZip } from "./zipwriter.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const enc = (s: string) => new TextEncoder().encode(s);

const CASH_HEADER = ["Type", "Instrument", "Ticker", "Category", "Time", "Amount", "ID", "Comment", "Product"];
function xtbZip(): Uint8Array {
  const cash = makeXlsx("Cash Operations", [
    CASH_HEADER,
    ["Deposit", "", "", "", 45000.5, 2000, "1", "Transfer", ""],
    ["Stock purchase", "Apple Inc.", "AAPL.US", "", 45001.5, -950, "2", "OPEN BUY 5 @ 190.00", ""],
    ["Total", "", "", "", "", 1050, "", "", ""],
  ]);
  const closed = makeXlsx("Closed Positions", [["Type", "Ticker", "Volume"], ["Buy", "AAPL.US", 5]]);
  return makeZip({ "53254345/PLN_53254345_2024.xlsx": cash, "53254345/closed.txt": "ignored", "53254346/IKE_53254346_2024.xlsx": closed });
}

test("XTB zip: reads cash operations sheet, account from folder, currency from file name", () => {
  const items = importXtbZip(xtbZip());
  assert.equal(items.length, 2);
  const [dep, buy] = items;
  assert.equal(dep!.type, "deposit");
  near(dep!.cashDelta!, 2000);
  assert.equal(buy!.type, "buy");
  assert.equal(buy!.symbol, "AAPL.US");
  near(buy!.quantity!, 5);
  near(buy!.price!, 190);
  near(buy!.cashDelta!, -950);
  assert.equal(buy!.currency, "PLN");
  assert.equal(buy!.account, "53254345");
  assert.equal(buy!.source, "XTB import");
  assert.equal(buy!.externalId, "2");
});

test("XTB zip without usable files reports a clear error", () => {
  assert.throws(() => importXtbZip(makeZip({ "readme.txt": "x" })), ImportError);
});

test("universal CSV with Polish dates, decimal commas and type aliases", () => {
  const csv = "date;type;symbol;name;quantity;price;gross;fee;currency;cash_delta;external_id;notes\n15.01.2024;kupno;aapl.us;Apple;10;180,5;1805;0;usd;;e1;x\nbad;buy;;;;;;;;;;\n";
  const items = importUniversal({ name: "t.csv", data: enc(csv) });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.type, "buy");
  assert.equal(items[0]!.symbol, "AAPL.US");
  near(items[0]!.price!, 180.5);
  assert.equal(items[0]!.currency, "USD");
  assert.equal(items[0]!.date.getFullYear(), 2024);
});

test("universal XLSX reads first sheet", () => {
  const xlsx = makeXlsx("Sheet1", [["date", "type", "symbol", "gross", "currency"], ["2024-02-01", "deposit", "", 500, "PLN"]]);
  const items = importFile({ name: "t.xlsx", data: xlsx });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.type, "deposit");
  near(items[0]!.gross, 500);
});

test("IBKR CSV: buy/sell sides, thousands separators, asset category", () => {
  const csv = "Symbol,DateTime,Quantity,T. Price,Proceeds,Comm/Fee,Currency,Buy/Sell,Asset Category,TradeID\nAAPL,2024-03-01,\"1,000\",150.5,\"-150,500\",-1.2,USD,BUY,Stocks,t1\nVWCE,2024-03-02,-2,100,200,0,EUR,SELL,ETFs,t2\n";
  const items = importIbkr(enc(csv));
  assert.equal(items.length, 2);
  assert.equal(items[0]!.type, "buy");
  near(items[0]!.quantity!, 1000);
  near(items[0]!.gross, 150500);
  near(items[0]!.fee, 1.2);
  assert.equal(items[0]!.assetType, "stock");
  assert.equal(items[1]!.type, "sell");
  assert.equal(items[1]!.assetType, "etf");
  assert.equal(items[1]!.externalId, "t2");
});

test("dedupe: by external id, by fingerprint, within the batch", () => {
  const items = importXtbZip(xtbZip());
  const first = filterNewImports(items, ["2"], []);
  assert.equal(first.toInsert.length, 1);
  assert.equal(first.skippedDuplicates, 1);
  const twice = filterNewImports([...items, ...items], [], []);
  assert.equal(twice.toInsert.length, 2);
  assert.equal(twice.skippedDuplicates, 2);
});

test("commit: creates XTB group + per-account portfolios and is idempotent", () => {
  const data = emptyDataset();
  const items = importXtbZip(xtbZip());
  const r1 = commitImport(data, items);
  assert.equal(r1.saved, 2);
  assert.equal(data.groups.map((g) => g.name).join(), "XTB");
  assert.equal(data.portfolios[0]!.name, "XTB PLN (53254345)");
  assert.equal(data.portfolios[0]!.kindRaw, "account");
  // re-import with different IDs and sub-second jitter must not duplicate
  const jittered = items.map((i) => ({ ...i, externalId: `x${i.externalId}`, date: new Date(i.date.getTime() + 500) }));
  const r2 = commitImport(data, jittered);
  assert.equal(r2.saved, 0);
  assert.equal(r2.skipped, 2);
  assert.equal(data.transactions.length, 2);
  const scope = calculate(data.portfolios[0]!, data.transactions, [], { ctx: { portfolios: data.portfolios, groups: data.groups } });
  assert.equal(scope.positions[0]!.symbol, "AAPL.US");
  near(scope.cashValueBase, 1050);
});

test("commit to a chosen portfolio requires a target for non-XTB imports", () => {
  const data = emptyDataset();
  const items = importUniversal({ name: "t.csv", data: enc("date,type,gross\n2024-01-01,deposit,100\n") });
  assert.throws(() => commitImport(data, items));
});
