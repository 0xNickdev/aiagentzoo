import { DatabaseSync } from "node:sqlite";
import type { LogEntry, LogStore, StateStore } from "@aiagentzoo/sdk";

/** One SQLite file per node: the hash-chained log and the enclosure state. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS log (
      seq INTEGER PRIMARY KEY,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      event TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export class SqliteLogStore implements LogStore {
  private readonly insert;
  private readonly lastStmt;
  private readonly sinceStmt;

  constructor(db: DatabaseSync) {
    this.insert = db.prepare("INSERT INTO log (seq, prev_hash, hash, event) VALUES (?, ?, ?, ?)");
    this.lastStmt = db.prepare("SELECT * FROM log ORDER BY seq DESC LIMIT 1");
    this.sinceStmt = db.prepare("SELECT * FROM log WHERE seq > ? ORDER BY seq ASC LIMIT ?");
  }

  append(entry: LogEntry): void {
    this.insert.run(entry.seq, entry.prevHash, entry.hash, JSON.stringify(entry.event));
  }

  last(): LogEntry | undefined {
    const row = this.lastStmt.get() as Row | undefined;
    return row ? toEntry(row) : undefined;
  }

  since(after: number, limit = 500): LogEntry[] {
    return (this.sinceStmt.all(after, limit) as unknown as Row[]).map(toEntry);
  }
}

export class SqliteStateStore implements StateStore {
  private readonly getStmt;
  private readonly setStmt;
  private readonly delStmt;
  private readonly keysStmt;

  constructor(db: DatabaseSync) {
    this.getStmt = db.prepare("SELECT value FROM state WHERE key = ?");
    this.setStmt = db.prepare("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    this.delStmt = db.prepare("DELETE FROM state WHERE key = ?");
    this.keysStmt = db.prepare("SELECT key FROM state WHERE key LIKE ? ESCAPE '\\' ORDER BY key");
  }

  get<T>(key: string): T | undefined {
    const row = this.getStmt.get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  set(key: string, value: unknown): void {
    this.setStmt.run(key, JSON.stringify(value));
  }

  delete(key: string): void {
    this.delStmt.run(key);
  }

  keys(prefix = ""): string[] {
    const pattern = `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return (this.keysStmt.all(pattern) as Array<{ key: string }>).map((r) => r.key);
  }
}

interface Row {
  seq: number;
  prev_hash: string;
  hash: string;
  event: string;
}

function toEntry(row: Row): LogEntry {
  return { seq: row.seq, prevHash: row.prev_hash, hash: row.hash, event: JSON.parse(row.event) };
}
