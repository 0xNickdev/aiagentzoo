import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * Per-wallet SOL ledger and the smart wallets read from it.
 *
 * Every SOL-paired trade the tape applies (pump.fun curve and PumpSwap pools) adds its SOL to the trader's row for that
 * coin: SOL in on a buy, SOL out on a sell. The hot path only touches a Map; rows land in history.db in one
 * transaction every half minute, and pairs older than 90 days are dropped. Once a day the wallets are scored by
 * realized PnL (SOL out less SOL in, on the coins they sold), each coin weighted down by how long ago it was last
 * traded, and the top wallets with enough coins sold become the smart wallets list.
 *
 * Realized means "sold at least once": a coin still held counts its buys against what was sold so far, so a wallet
 * holding a winner is under-counted, never over-counted. Fees and SOL moved outside these pools are not seen.
 */

export const PNL = {
  /** Trades smaller than this are dust: bots' bumps and probes, left out. */
  minSol: 0.001,
  /** Pending pairs held in memory between flushes; past it new pairs wait for the next flush (counted as dropped). */
  maxPending: 100_000,
  flushMs: 30_000,
  keepMs: 90 * 24 * 3_600_000,
  /** Pairs with less than this much SOL through them are dropped after two days: they never decide a score. */
  dustSol: 0.1,
  dustAfterMs: 2 * 24 * 3_600_000,
  /** Hard cap on rows (about 250 bytes each on disk, so ~2.5 GB): past it the least recently traded pairs go first. */
  maxRows: 10_000_000,
  /** Scoring: a coin's PnL halves in weight every this long since it was last traded. */
  halfLifeMs: 14 * 24 * 3_600_000,
  /** A wallet is ranked once it sold at least this many coins. */
  minSold: 10,
  top: 200,
  /** Wallets grouped per query while scoring, so the event loop breathes between groups. */
  chunk: 5_000,
} as const;

interface Pending {
  i: number;
  o: number;
  f: number;
  l: number;
}

export interface SmartWallet {
  wallet: string;
  /** Recency-weighted realized SOL, and the plain sum. */
  score: number;
  realizedSol: number;
  /** Coins sold at least once, and of those the ones that brought back more than they cost. */
  sold: number;
  wins: number;
  solIn: number;
  lastTs: number;
  /** Other wallets of the same cluster that also ranked, left out in favour of this one. */
  linked: number;
}

export interface SmartList {
  at: number;
  minSold: number;
  halfLifeDays: number;
  scanned: number;
  excluded: { operators: number; linked: number };
  wallets: SmartWallet[];
}

export interface SmartDeps {
  /** A cluster id for a wallet: an operator group, or the funder it shares with others. Null when it stands alone. */
  clusterOf?: (wallet: string) => string | null;
  /** True for a wallet in the operator graph: launch wallets trading their own coins are not smart money. */
  isOperator?: (wallet: string) => boolean;
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export class WalletLedger {
  readonly db: DatabaseSync;
  private pending = new Map<string, Pending>();
  private readonly s: Record<string, StatementSync>;
  /** Fills seen, pairs flushed, pairs left out when the pending map was full; read for the resource numbers. */
  readonly stats = { fills: 0, flushed: 0, dropped: 0, flushMsMax: 0 };

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_pnl (
        wallet TEXT NOT NULL,
        mint TEXT NOT NULL,
        sol_in REAL NOT NULL DEFAULT 0,
        sol_out REAL NOT NULL DEFAULT 0,
        first_ts INTEGER NOT NULL,
        last_ts INTEGER NOT NULL,
        PRIMARY KEY (wallet, mint)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS wallet_pnl_last ON wallet_pnl (last_ts);
    `);
    this.s = {
      put: db.prepare(`INSERT INTO wallet_pnl (wallet, mint, sol_in, sol_out, first_ts, last_ts) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (wallet, mint) DO UPDATE SET sol_in = sol_in + excluded.sol_in, sol_out = sol_out + excluded.sol_out,
        first_ts = min(first_ts, excluded.first_ts), last_ts = max(last_ts, excluded.last_ts)`),
      group: db.prepare(`SELECT wallet, sum(sol_in) AS sin, sum(CASE WHEN sol_out > 0 THEN sol_out - sol_in ELSE 0 END) AS pnl,
        sum(CASE WHEN sol_out > 0 THEN (sol_out - sol_in) * pow(0.5, (? - last_ts) / ?) ELSE 0 END) AS score,
        sum(sol_out > 0) AS sold, sum(sol_out > sol_in) AS wins, max(last_ts) AS last
        FROM wallet_pnl WHERE wallet > ? GROUP BY wallet ORDER BY wallet LIMIT ?`),
      old: db.prepare("DELETE FROM wallet_pnl WHERE last_ts < ?"),
      dust: db.prepare("DELETE FROM wallet_pnl WHERE last_ts < ? AND sol_in + sol_out < ?"),
      count: db.prepare("SELECT count(*) AS n FROM wallet_pnl"),
    };
  }

  /** One trade on the hot path: a Map lookup and four additions. */
  fill(wallet: string, mint: string, sol: number, isBuy: boolean, ts: number): void {
    if (!(sol >= PNL.minSol)) return;
    this.stats.fills++;
    const k = `${wallet}:${mint}`;
    let p = this.pending.get(k);
    if (!p) {
      if (this.pending.size >= PNL.maxPending) {
        this.stats.dropped++;
        return;
      }
      p = { i: 0, o: 0, f: ts, l: ts };
      this.pending.set(k, p);
    }
    if (isBuy) p.i += sol;
    else p.o += sol;
    if (ts < p.f) p.f = ts;
    if (ts > p.l) p.l = ts;
  }

  get queued(): number {
    return this.pending.size;
  }

  /** Writes the pending pairs in one transaction. */
  flush(): number {
    if (!this.pending.size) return 0;
    const t0 = performance.now();
    const batch = this.pending;
    this.pending = new Map();
    this.db.exec("BEGIN");
    try {
      for (const [k, p] of batch) {
        const at = k.indexOf(":");
        this.s.put!.run(k.slice(0, at), k.slice(at + 1), r4(p.i), r4(p.o), p.f, p.l);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.stats.flushed += batch.size;
    this.stats.flushMsMax = Math.max(this.stats.flushMsMax, Math.round(performance.now() - t0));
    return batch.size;
  }

  prune(now = Date.now(), maxRows: number = PNL.maxRows): { old: number; dust: number; capped: number } {
    const old = Number(this.s.old!.run(now - PNL.keepMs).changes);
    const dust = Number(this.s.dust!.run(now - PNL.dustAfterMs, PNL.dustSol).changes);
    let capped = 0;
    const over = this.rows() - maxRows;
    if (over > 0) {
      const cut = this.db.prepare("SELECT last_ts FROM wallet_pnl ORDER BY last_ts LIMIT 1 OFFSET ?").get(over - 1) as { last_ts: number } | undefined;
      if (cut) capped = Number(this.db.prepare("DELETE FROM wallet_pnl WHERE last_ts <= ?").run(cut.last_ts).changes);
    }
    return { old, dust, capped };
  }

  rows(): number {
    return Number((this.s.count!.get() as { n: number }).n);
  }

  /**
   * Scores every wallet in chunks (a pause between chunks) and returns the top list: operators out, one wallet per
   * cluster (the best one; the others counted as linked).
   */
  async score(now = Date.now(), deps: SmartDeps = {}, opts: { top?: number; minSold?: number } = {}): Promise<SmartList> {
    const minSold = opts.minSold ?? PNL.minSold;
    const top = opts.top ?? PNL.top;
    const keep: SmartWallet[] = [];
    let after = "";
    let scanned = 0;
    for (;;) {
      const rows = this.s.group!.all(now, PNL.halfLifeMs, after, PNL.chunk) as Array<{ wallet: string; sin: number; pnl: number; score: number; sold: number; wins: number; last: number }>;
      if (!rows.length) break;
      after = rows[rows.length - 1]!.wallet;
      scanned += rows.length;
      for (const r of rows) {
        if (Number(r.sold) < minSold || !(r.score > 0)) continue;
        keep.push({ wallet: r.wallet, score: r4(r.score), realizedSol: r4(r.pnl), sold: Number(r.sold), wins: Number(r.wins), solIn: r4(r.sin), lastTs: Number(r.last), linked: 0 });
      }
      // Only the best few times the list size need be kept while scanning.
      if (keep.length > top * 20) {
        keep.sort((a, b) => b.score - a.score);
        keep.length = top * 10;
      }
      await new Promise<void>((r) => setImmediate(r));
    }
    keep.sort((a, b) => b.score - a.score);
    const out: SmartWallet[] = [];
    const seen = new Map<string, SmartWallet>();
    let operators = 0;
    let linked = 0;
    for (const w of keep) {
      if (out.length >= top) break;
      if (deps.isOperator?.(w.wallet)) {
        operators++;
        continue;
      }
      const c = deps.clusterOf?.(w.wallet) ?? null;
      const first = c ? seen.get(c) : undefined;
      if (first) {
        first.linked++;
        linked++;
        continue;
      }
      if (c) seen.set(c, w);
      out.push(w);
    }
    return { at: now, minSold, halfLifeDays: PNL.halfLifeMs / 86_400_000, scanned, excluded: { operators, linked }, wallets: out };
  }
}

/** The list as served, kept in a file next to the data so a restart serves yesterday's until today's is built. */
export class SmartWallets {
  private list: SmartList | null = null;
  private readonly file: string | null;
  constructor(file: string | null = null) {
    this.file = file;
    if (file && existsSync(file)) {
      try {
        this.list = JSON.parse(readFileSync(file, "utf8")) as SmartList;
      } catch {
        this.list = null;
      }
    }
  }

  get current(): SmartList | null {
    return this.list;
  }

  set(list: SmartList): void {
    this.list = list;
    if (!this.file) return;
    writeFileSync(`${this.file}.tmp`, JSON.stringify(list));
    renameSync(`${this.file}.tmp`, this.file);
  }
}

/** Flushes the ledger every half minute; prunes and scores once a day (first run an hour after start). */
export function startWalletLedger(ledger: WalletLedger, smart: SmartWallets, deps: SmartDeps, { log = (_m: string) => {} } = {}): () => void {
  const flush = setInterval(() => {
    try {
      ledger.flush();
    } catch (error) {
      log(`wallet ledger not written: ${(error as Error).message}`);
    }
  }, PNL.flushMs);
  flush.unref();
  let busy = false;
  const daily = async () => {
    if (busy) return;
    busy = true;
    try {
      const p = ledger.prune();
      const list = await ledger.score(Date.now(), deps);
      smart.set(list);
      const s = ledger.stats;
      log(`smart wallets: ${list.wallets.length} of ${list.scanned} wallets (${ledger.rows()} rows; pruned ${p.old} old, ${p.dust} dust, ${p.capped} over the cap; ${s.fills} fills, ${s.flushed} pairs written, ${s.dropped} dropped, slowest flush ${s.flushMsMax} ms)`);
    } catch (error) {
      log(`smart wallets not scored: ${(error as Error).message}`);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(() => void daily(), 60 * 60_000);
  first.unref();
  const day = setInterval(() => void daily(), 24 * 3_600_000);
  day.unref();
  return () => {
    clearInterval(flush);
    clearTimeout(first);
    clearInterval(day);
    try {
      ledger.flush();
    } catch {
      /* the last half minute is lost */
    }
  };
}
