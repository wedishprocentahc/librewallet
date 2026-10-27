import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { backupObject, datasetFromObject, exportBackup } from "../core/backup.ts";
import { type Dataset, emptyDataset } from "../core/types.ts";

type Row = Record<string, unknown>;
const KINDS = ["groups", "portfolios", "transactions", "targets", "quotes", "bonds", "alerts"] as const;
type Kind = (typeof KINDS)[number];

/**
 * Local SQLite store. Entities are stored as JSON rows in the shared backup (v2) shape, so the database,
 * backups and the native app all speak the same format. Writes are diffed and run in one transaction.
 */
export class Store {
  readonly dir: string;
  private readonly db: DatabaseSync;
  private saved = new Map<string, string>();

  constructor(dir: string, file = "librewallet.db") {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(file === ":memory:" ? file : join(dir, file));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (kind, id));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
  }

  close(): void {
    this.db.close();
  }

  loadDataset(): Dataset {
    const raw: Record<string, unknown> = { format: "librewallet-backup", version: 2 };
    for (const k of KINDS) raw[k] = [];
    this.saved = new Map();
    for (const r of this.db.prepare("SELECT kind, id, json FROM entities").all() as { kind: Kind; id: string; json: string }[]) {
      (raw[r.kind] as unknown[]).push(JSON.parse(r.json));
      this.saved.set(`${r.kind}/${r.id}`, r.json);
    }
    return datasetFromObject(raw).data;
  }

  /** Persist only what changed since the last load/save. */
  saveDataset(data: Dataset): { upserted: number; deleted: number } {
    const obj = backupObject(data) as unknown as Record<Kind, Row[]>;
    const next = new Map<string, { kind: Kind; id: string; json: string }>();
    for (const kind of KINDS) {
      for (const row of obj[kind]) {
        const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null));
        next.set(`${kind}/${String(row.id)}`, { kind, id: String(row.id), json: JSON.stringify(clean) });
      }
    }
    const upsert = this.db.prepare("INSERT INTO entities (kind, id, json) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET json = excluded.json");
    const del = this.db.prepare("DELETE FROM entities WHERE kind = ? AND id = ?");
    let upserted = 0, deleted = 0;
    this.db.exec("BEGIN");
    try {
      for (const [key, e] of next) {
        if (this.saved.get(key) !== e.json) { upsert.run(e.kind, e.id, e.json); upserted++; }
      }
      for (const key of this.saved.keys()) {
        if (!next.has(key)) { const [kind, id] = key.split("/") as [Kind, string]; del.run(kind, id); deleted++; }
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.saved = new Map([...next].map(([k, v]) => [k, v.json]));
    return { upserted, deleted };
  }

  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare("SELECT json FROM settings WHERE key = ?").get(key) as { json: string } | undefined;
    return r ? (JSON.parse(r.json) as T) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO settings (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(key, JSON.stringify(value));
  }

  getCache<T>(key: string): { value: T; updatedAt: Date } | null {
    const r = this.db.prepare("SELECT json, updated_at FROM cache WHERE key = ?").get(key) as { json: string; updated_at: string } | undefined;
    return r ? { value: JSON.parse(r.json) as T, updatedAt: new Date(r.updated_at) } : null;
  }

  setCache(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO cache (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at").run(key, JSON.stringify(value), new Date().toISOString());
  }

  /** Write a full JSON backup next to the database; keeps the `keep` most recent of that prefix. */
  writeBackup(data: Dataset, prefix = "auto", keep = 10, now: Date = new Date()): string {
    const dir = join(this.dir, "Backups");
    mkdirSync(dir, { recursive: true });
    const stamp = now.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const file = join(dir, `${prefix}-${stamp}.json`);
    writeFileSync(file, exportBackup(data, now));
    const old = readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".json")).sort().reverse().slice(keep);
    for (const f of old) rmSync(join(dir, f), { force: true });
    return file;
  }

  /** Latest backup file name with this prefix, if any (used to decide whether a daily backup is due). */
  latestBackup(prefix = "auto"): { name: string; at: Date } | null {
    try {
      const f = readdirSync(join(this.dir, "Backups")).filter((n) => n.startsWith(`${prefix}-`) && n.endsWith(".json")).sort().pop();
      if (!f) return null;
      const iso = f.slice(prefix.length + 1, -5).replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, "T$1:$2:$3Z");
      return { name: f, at: new Date(iso) };
    } catch {
      return null;
    }
  }
}

export { emptyDataset };
