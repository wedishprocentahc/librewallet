import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BackupError, exportBackup, importBackup } from "../core/backup.ts";

const sample = (n: string) => readFileSync(new URL(`../../docs/backup-samples/${n}`, import.meta.url), "utf8");

test("imports the v1 sample written by the native app", () => {
  const { data, hasAlerts } = importBackup(sample("v1-swift.json"));
  assert.equal(data.portfolios.length, 1);
  assert.equal(data.transactions.length, 1);
  assert.equal(data.bonds.length, 0);
  assert.equal(hasAlerts, false);
});

test("v2 sample round-trips", () => {
  const text = sample("v2-full.json");
  const { data, exportedAt } = importBackup(text);
  assert.equal(data.bonds[0]?.termMonths, 120);
  assert.equal(data.alerts[0]?.symbol, "AAPL.US");
  assert.deepEqual(JSON.parse(exportBackup(data, exportedAt!)), JSON.parse(text));
});

test("rejects newer versions and foreign files", () => {
  const newer = JSON.stringify({ ...JSON.parse(sample("v2-full.json")), version: 3 });
  assert.throws(() => importBackup(newer), BackupError);
  assert.throws(() => importBackup('{"format":"other"}'), BackupError);
  assert.throws(() => importBackup("nope"), BackupError);
});
