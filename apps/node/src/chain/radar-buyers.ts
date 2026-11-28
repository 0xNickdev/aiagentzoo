import type { DatabaseSync } from "node:sqlite";

/**
 * The slim buyer record of radar candidates, kept 14 days in history.db for regrading: the first 100 buyers of each
 * minute-5 candidate as they stood at minute twenty. Written by the background worker, one short transaction per coin.
 * About 60 candidates a day x 100 rows x ~110 bytes with the index: ~0.7 MB a day, ~10 MB at the 14-day cap.
 */

export const BUYERS_KEEP_MS = 14 * 24 * 3_600_000;

export interface BuyerRow {
  wallet: string;
  /** First buy, ms after launch. */
  afterMs: number;
  sol: number;
  tok: number;
  /** Still holding at minute twenty. */
  holding: boolean;
}

export function ensureBuyers(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS radar_buyers (
      mint TEXT NOT NULL,
      wallet TEXT NOT NULL,
      after_ms INTEGER NOT NULL,
      sol REAL NOT NULL,
      tok REAL NOT NULL,
      holding INTEGER NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (mint, wallet)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS radar_buyers_at ON radar_buyers(at);
  `);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** One coin's buyers in one short transaction; a coin written twice keeps the later reading. */
export function writeBuyers(db: DatabaseSync, mint: string, at: number, rows: BuyerRow[]): number {
  const st = db.prepare("INSERT OR REPLACE INTO radar_buyers (mint,wallet,after_ms,sol,tok,holding,at) VALUES (?,?,?,?,?,?,?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const b of rows.slice(0, 100)) st.run(mint, b.wallet, Math.round(b.afterMs), r3(b.sol), Math.round(b.tok), b.holding ? 1 : 0, at);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return Math.min(rows.length, 100);
}

/** Drops rows older than the keep, a chunk per transaction; returns how many went. */
export function pruneBuyers(db: DatabaseSync, now = Date.now(), chunk = 5_000): number {
  const pick = db.prepare("SELECT mint, wallet FROM radar_buyers WHERE at < ? LIMIT ?");
  const del = db.prepare("DELETE FROM radar_buyers WHERE mint=? AND wallet=?");
  let n = 0;
  for (;;) {
    const rows = pick.all(now - BUYERS_KEEP_MS, chunk) as Array<{ mint: string; wallet: string }>;
    if (!rows.length) return n;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows) del.run(r.mint, r.wallet);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    n += rows.length;
    if (rows.length < chunk) return n;
  }
}
