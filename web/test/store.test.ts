import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { importBackup } from "../core/backup.ts";
import { defaultDataDir } from "../server/paths.ts";
import { Store } from "../server/store.ts";
import { emptyDataset } from "../core/types.ts";
import { portfolio, tx } from "./helpers.ts";

test("dataset survives a restart and saves only what changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "lw-"));
  try {
    const s1 = new Store(dir);
    const data = s1.loadDataset();
    const p = portfolio({ name: "XTB" });
    data.portfolios.push(p);
    data.transactions.push(tx({ typeRaw: "deposit", portfolioId: p.id, gross: 100, cashDelta: 100, date: new Date("2024-01-02T10:00:00Z") }));
    assert.deepEqual(s1.saveDataset(data), { upserted: 2, deleted: 0 });
    assert.deepEqual(s1.saveDataset(data), { upserted: 0, deleted: 0 });
    data.transactions[0]!.gross = 150;
    assert.deepEqual(s1.saveDataset(data), { upserted: 1, deleted: 0 });
    s1.close();

    const s2 = new Store(dir);
    const again = s2.loadDataset();
    assert.equal(again.portfolios[0]!.name, "XTB");
    assert.equal(again.transactions[0]!.gross, 150);
    assert.equal(again.transactions[0]!.date.toISOString(), "2024-01-02T10:00:00.000Z");
    again.transactions.length = 0;
    assert.deepEqual(s2.saveDataset(again), { upserted: 0, deleted: 1 });
    s2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("settings and cache round-trip", () => {
  const s = new Store(":memory:", ":memory:");
  assert.equal(s.getSetting("language", "pl"), "pl");
  s.setSetting("language", "en");
  assert.equal(s.getSetting("language", "pl"), "en");
  s.setCache("histories", { A: [1, 2] });
  assert.deepEqual(s.getCache("histories")?.value, { A: [1, 2] });
  assert.equal(s.getCache("missing"), null);
  s.close();
});

test("backups are valid shared-format files and rotate", () => {
  const dir = mkdtempSync(join(tmpdir(), "lw-"));
  try {
    const s = new Store(dir);
    const data = emptyDataset();
    data.portfolios.push(portfolio());
    for (let i = 0; i < 4; i++) s.writeBackup(data, "auto", 3, new Date(Date.UTC(2024, 0, 1 + i)));
    const files = readdirSync(join(dir, "Backups"));
    assert.equal(files.length, 3);
    assert.ok(!files.some((f) => f.includes("2024-01-01")));
    const latest = s.latestBackup();
    assert.equal(latest?.at.toISOString(), "2024-01-04T00:00:00.000Z");
    const text = readFileSync(join(dir, "Backups", latest!.name), "utf8");
    assert.equal(importBackup(text).data.portfolios.length, 1);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default data directory is per-user and overridable", () => {
  assert.equal(defaultDataDir({ LIBREWALLET_DATA_DIR: "/x" } as NodeJS.ProcessEnv, "linux"), "/x");
  assert.equal(defaultDataDir({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" } as NodeJS.ProcessEnv, "win32").endsWith("LibreWallet"), true);
  assert.ok(defaultDataDir({ XDG_DATA_HOME: "/data" } as NodeJS.ProcessEnv, "linux").startsWith("/data"));
});
