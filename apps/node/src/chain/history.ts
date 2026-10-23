import { DatabaseSync, type StatementSync } from "node:sqlite";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { ChainFacts, CreatorRecord, PulseEvent, PumpTape } from "./pump.ts";

/**
 * The north node's long memory. The tape forgets a token after two days; this keeps what the X-Ray needs of it
 * (its facts, first-second wallets, launch bundle and dev) for at least 90 days in a SQLite file of its own,
 * and a running record per wallet: launches, dumps, snipes, crew and bundle hits.
 *
 * Wallets and tokens are stored once and referred to by integer id; the facts and wallet lists of a token sit in one
 * deflated blob. Writes are queued and land in one transaction every few seconds, so the stream never waits on disk.
 */

export type HistoryRecord = NonNullable<ReturnType<PumpTape["historyOf"]>> & { funder?: string | null };

export const HISTORY_KEEP_MS = 90 * 24 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

const ROLE = { dev: 0, early: 1, bundle: 2, crew: 3 } as const;
type Role = keyof typeof ROLE;
const ROLE_NAME: Role[] = ["dev", "early", "bundle", "crew"];
const COUNTER: Record<Role, string> = { dev: "launches", early: "snipes", bundle: "bundle_hits", crew: "crew_hits" };

/** Flags of an early wallet, packed. */
const F_BUNDLE = 1, F_CREW = 2, F_RING = 4, F_SERIAL = 8;

/** One early wallet as kept: wallet id, bought and held (in 1/10,000 of supply), seconds in, seconds to exit (-1: never), flags, snipes in 48h. */
type EarlyRow = [number, number, number, number, number, number, number];
interface Body {
  f: ChainFacts;
  e: EarlyRow[];
  /** Launch bundle: wallet id and share in 1/10,000 of supply. */
  b: Array<[number, number]>;
}

const bp = (x: number) => Math.round(x * 10_000);

/** Numbers trimmed to four decimals so the blob stays small. */
const slimFacts = (f: ChainFacts): ChainFacts =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 10_000) / 10_000 : v])) as unknown as ChainFacts;

export interface HistoryEarly {
  wallet: string;
  bought: number;
  held: number;
  afterSec: number;
  exitSec: number | null;
  bundle: boolean;
  snipes48h: number;
  crew: boolean;
  ring: boolean;
  serial: boolean;
}

export interface HistoryTotals {
  wallet: string;
  launches: number;
  dumped: number;
  medianDumpMin: number | null;
  graduated: number;
  recent: CreatorRecord["recent"];
}

export class HistoryStore {
  readonly db: DatabaseSync;
  private pending = new Map<string, HistoryRecord>();
  /** The oldest first_seen, worked out once (it has no index) and kept up to date by writes and prunes. */
  private sinceAt: number | null | undefined;
  private readonly s: Record<string, StatementSync>;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY,
        wallet TEXT NOT NULL UNIQUE,
        launches INTEGER NOT NULL DEFAULT 0,
        dumped INTEGER NOT NULL DEFAULT 0,
        snipes INTEGER NOT NULL DEFAULT 0,
        crew_hits INTEGER NOT NULL DEFAULT 0,
        bundle_hits INTEGER NOT NULL DEFAULT 0,
        serial INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY,
        mint TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        creator_id INTEGER NOT NULL,
        venue TEXT,
        created_at INTEGER NOT NULL,
        first_seen INTEGER NOT NULL,
        graduated_at INTEGER,
        dev_sold_pct INTEGER,
        dev_dumped_at INTEGER,
        peak_curve_sol REAL,
        pool_drained_at INTEGER,
        funder TEXT,
        body BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tokens_creator ON tokens (creator_id, created_at);
      CREATE INDEX IF NOT EXISTS tokens_created ON tokens (created_at);
      CREATE TABLE IF NOT EXISTS wallet_tokens (
        wallet_id INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        role INTEGER NOT NULL,
        took INTEGER,
        at INTEGER NOT NULL,
        PRIMARY KEY (wallet_id, token_id, role)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS wallet_tokens_token ON wallet_tokens (token_id);
    `);
    // Columns added after the first stores were written: what the dev took out, who was left holding, alive at last look.
    const have = new Set((this.db.prepare("PRAGMA table_info(tokens)").all() as Array<{ name: string }>).map((c) => c.name));
    for (const [name, type] of [["dev_took", "REAL"], ["left_holding", "INTEGER"], ["alive", "INTEGER"]] as const) {
      if (!have.has(name)) this.db.exec(`ALTER TABLE tokens ADD COLUMN ${name} ${type}`);
    }
    const p = (sql: string) => this.db.prepare(sql);
    this.s = {
      wallet: p("INSERT INTO wallets (wallet, first_seen, last_seen) VALUES (?, ?, ?) ON CONFLICT (wallet) DO UPDATE SET last_seen = max(last_seen, excluded.last_seen) RETURNING id"),
      walletRow: p("SELECT * FROM wallets WHERE wallet = ?"),
      prev: p("SELECT id, dev_dumped_at FROM tokens WHERE mint = ?"),
      insertToken: p(`INSERT INTO tokens (mint, symbol, name, creator_id, venue, created_at, first_seen, graduated_at, dev_sold_pct, dev_dumped_at, peak_curve_sol, pool_drained_at, funder, body, updated_at, dev_took, left_holding, alive)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`),
      updateToken: p(`UPDATE tokens SET symbol = ?, name = ?, graduated_at = coalesce(graduated_at, ?), dev_sold_pct = coalesce(?, dev_sold_pct),
        dev_dumped_at = coalesce(dev_dumped_at, ?), peak_curve_sol = max(coalesce(peak_curve_sol, 0), coalesce(?, 0)), pool_drained_at = coalesce(pool_drained_at, ?),
        funder = coalesce(?, funder), body = ?, updated_at = ?, dev_took = coalesce(?, dev_took), left_holding = coalesce(left_holding, ?), alive = coalesce(?, alive) WHERE id = ?`),
      link: p("INSERT OR IGNORE INTO wallet_tokens (wallet_id, token_id, role, took, at) VALUES (?, ?, ?, ?, ?)"),
      relink: p("UPDATE wallet_tokens SET took = ? WHERE wallet_id = ? AND token_id = ? AND role = ?"),
      dumped: p("UPDATE wallets SET dumped = dumped + 1 WHERE id = ?"),
      serial: p("UPDATE wallets SET serial = 1 WHERE id = ?"),
      ...Object.fromEntries(ROLE_NAME.map((r) => [`count_${r}`, p(`UPDATE wallets SET ${COUNTER[r]} = ${COUNTER[r]} + 1 WHERE id = ?`)])),
      has: p("SELECT 1 FROM tokens WHERE mint = ?"),
      token: p("SELECT t.*, w.wallet AS creator FROM tokens t JOIN wallets w ON w.id = t.creator_id WHERE t.mint = ?"),
      recent: p("SELECT mint, symbol, created_at, dev_dumped_at, graduated_at, pool_drained_at, dev_took, left_holding, alive FROM tokens WHERE creator_id = ? ORDER BY created_at DESC LIMIT 12"),
      dumpMins: p("SELECT dev_dumped_at - created_at AS ms FROM tokens WHERE creator_id = ? AND dev_dumped_at IS NOT NULL AND created_at > ? AND created_at <= ? ORDER BY ms LIMIT 2000"),
      window: p(`SELECT count(*) AS n, sum(created_at > ?) AS n24, sum(dev_dumped_at IS NOT NULL) AS dumped, sum(graduated_at IS NOT NULL) AS graduated
        FROM tokens WHERE creator_id = ? AND created_at > ? AND created_at <= ?`),
      graduated: p("SELECT count(*) AS n FROM tokens WHERE creator_id = ? AND graduated_at IS NOT NULL"),
      roles: p(`SELECT wt.role, wt.took, wt.at, t.mint, t.symbol, t.created_at, t.dev_dumped_at, t.graduated_at, t.pool_drained_at, c.wallet AS creator
        FROM wallet_tokens wt JOIN tokens t ON t.id = wt.token_id JOIN wallets c ON c.id = t.creator_id
        WHERE wt.wallet_id = ? ORDER BY wt.token_id DESC LIMIT ?`),
      since: p("SELECT min(first_seen) AS at FROM tokens"),
      counts: p("SELECT (SELECT count(*) FROM tokens) AS tokens, (SELECT count(*) FROM wallets) AS wallets"),
      oldTokens: p("SELECT id FROM tokens WHERE created_at < ? LIMIT ?"),
      walletPage: p("SELECT id, last_seen FROM wallets WHERE id > ? ORDER BY id LIMIT ?"),
    };
  }

  /** Queued for the next flush; a later record of the same token replaces an earlier one. */
  enqueue(rec: HistoryRecord): void {
    this.pending.set(rec.mint, rec);
  }

  get queued(): number {
    return this.pending.size;
  }

  /** Writes everything queued in one transaction. */
  flush(now = Date.now()): number {
    if (!this.pending.size) return 0;
    const batch = [...this.pending.values()];
    this.pending = new Map();
    this.write(batch, now);
    return batch.length;
  }

  write(records: HistoryRecord[], now = Date.now()): void {
    this.db.exec("BEGIN");
    try {
      for (const r of records) this.writeOne(r, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private walletId(wallet: string, at: number): number {
    return Number((this.s.wallet!.get(wallet, at, at) as { id: number | bigint }).id);
  }

  private link(walletId: number, tokenId: number, role: Role, took: number | null, at: number): void {
    const { changes } = this.s.link!.run(walletId, tokenId, ROLE[role], took, at);
    if (Number(changes) > 0) this.s[`count_${role}`]!.run(walletId);
    else if (took !== null) this.s.relink!.run(took, walletId, tokenId, ROLE[role]);
  }

  private writeOne(r: HistoryRecord, now: number): void {
    const creatorId = this.walletId(r.creator, now);
    const early = r.early.slice(0, 30).map((e) => ({ e, id: this.walletId(e.wallet, now) }));
    const bundle = r.bundle.slice(0, 12).map((b) => ({ b, id: this.walletId(b.wallet, now) }));
    const body: Body = {
      f: slimFacts(r.facts),
      e: early.map(({ e, id }): EarlyRow => [id, bp(e.bought), bp(e.held), e.afterSec, e.exitSec ?? -1, (e.bundle ? F_BUNDLE : 0) | (e.crew ? F_CREW : 0) | (e.ring ? F_RING : 0) | (e.serial ? F_SERIAL : 0), e.snipes48h]),
      b: bundle.map(({ b, id }) => [id, bp(b.share)]),
    };
    const blob = deflateRawSync(JSON.stringify(body));
    const graduatedAt = r.graduated ? now : null;
    const drainedAt = r.drained ? now : null;
    const prev = this.s.prev!.get(r.mint) as { id: number | bigint; dev_dumped_at: number | null } | undefined;
    let tokenId: number;
    if (!prev) {
      if (this.sinceAt === null) this.sinceAt = now;
      tokenId = Number((this.s.insertToken!.get(r.mint, r.symbol, r.name, creatorId, r.venue, r.createdAt, now, graduatedAt, r.devSoldPct, r.dumpedAt, r.curveSol, drainedAt, r.funder ?? null, blob, now, r.devTookSol ?? null, r.leftHolding ?? null, r.alive === undefined ? null : r.alive ? 1 : 0) as { id: number | bigint }).id);
    } else {
      tokenId = Number(prev.id);
      this.s.updateToken!.run(r.symbol, r.name, graduatedAt, r.devSoldPct, r.dumpedAt, r.curveSol, drainedAt, r.funder ?? null, blob, now, r.devTookSol ?? null, r.leftHolding ?? null, r.alive === undefined ? null : r.alive ? 1 : 0, tokenId);
    }
    this.link(creatorId, tokenId, "dev", null, r.createdAt);
    if (r.dumpedAt !== null && (!prev || prev.dev_dumped_at === null)) this.s.dumped!.run(creatorId);
    for (const { e, id } of early) {
      this.link(id, tokenId, "early", bp(e.bought), r.createdAt);
      if (e.crew) this.link(id, tokenId, "crew", bp(e.bought), r.createdAt);
      if (e.serial) this.s.serial!.run(id);
    }
    for (const { b, id } of bundle) this.link(id, tokenId, "bundle", bp(b.share), r.createdAt);
  }

  has(mint: string): boolean {
    return Boolean(this.s.has!.get(mint));
  }

  /** When the store first saw a token: the X-Ray says how far back it remembers. */
  since(): number | null {
    if (this.sinceAt === undefined) this.sinceAt = ((this.s.since!.get() as { at: number | null } | undefined)?.at) ?? null;
    return this.sinceAt;
  }

  counts(): { tokens: number; wallets: number } {
    const c = this.s.counts!.get() as { tokens: number; wallets: number };
    return { tokens: Number(c.tokens), wallets: Number(c.wallets) };
  }

  private walletsById(ids: number[]): Map<number, string> {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return new Map();
    const rows = this.db.prepare(`SELECT id, wallet FROM wallets WHERE id IN (${uniq.map(() => "?").join(",")})`).all(...uniq) as Array<{ id: number; wallet: string }>;
    return new Map(rows.map((r) => [Number(r.id), r.wallet]));
  }

  /** A token rebuilt from history, shaped like the tape's own reading, or null when it was never kept. */
  report(mint: string, now = Date.now()) {
    const row = this.s.token!.get(mint) as
      | { creator_id: number; creator: string; symbol: string; name: string; venue: string | null; created_at: number; first_seen: number; graduated_at: number | null; dev_dumped_at: number | null; dev_sold_pct: number | null; peak_curve_sol: number | null; pool_drained_at: number | null; funder: string | null; body: Uint8Array; updated_at: number }
      | undefined;
    if (!row) return null;
    const body = JSON.parse(inflateRawSync(row.body).toString()) as Body;
    const names = this.walletsById([...body.e.map((e) => e[0]), ...body.b.map((b) => b[0])]);
    const early: HistoryEarly[] = body.e.flatMap(([id, bought, held, afterSec, exitSec, flags, snipes48h]) => {
      const wallet = names.get(id);
      if (!wallet) return [];
      return [{ wallet, bought: bought / 10_000, held: held / 10_000, afterSec, exitSec: exitSec < 0 ? null : exitSec, bundle: Boolean(flags & F_BUNDLE), snipes48h, crew: Boolean(flags & F_CREW), ring: Boolean(flags & F_RING), serial: Boolean(flags & F_SERIAL) }];
    });
    const bundle = body.b.flatMap(([id, share]) => (names.has(id) ? [{ wallet: names.get(id)!, share: share / 10_000 }] : []));
    const facts: ChainFacts = { ...body.f, ageMin: Math.max(0, Math.round((now - row.created_at) / 60_000)), graduated: body.f.graduated || row.graduated_at !== null, ...(row.pool_drained_at !== null ? { drained: true } : {}) };
    return {
      mint,
      symbol: row.symbol,
      name: row.name,
      creator: row.creator,
      createdAt: row.created_at,
      venue: row.venue,
      facts,
      early,
      bundle,
      funder: row.funder,
      graduatedAt: row.graduated_at,
      devDumpedAt: row.dev_dumped_at,
      poolDrainedAt: row.pool_drained_at,
      peakCurveSol: row.peak_curve_sol,
      recordedAt: row.updated_at,
      // What the check would have read at launch: the creator's two days up to this token.
      creatorRecord: this.creatorRecord(row.creator, row.created_at),
    };
  }

  /** The creator's record over the 48 hours up to `end`, shaped like the tape's. */
  creatorRecord(wallet: string, end = Date.now()): CreatorRecord | null {
    const w = this.s.walletRow!.get(wallet) as { id: number } | undefined;
    if (!w) return null;
    const win = this.s.window!.get(end - DAY_MS, w.id, end - 2 * DAY_MS, end) as { n: number; n24: number | null; dumped: number | null; graduated: number | null };
    if (!Number(win.n)) return null;
    return {
      wallet,
      launches24h: Number(win.n24 ?? 0),
      launches48h: Number(win.n),
      dumped: Number(win.dumped ?? 0),
      medianDumpMin: this.medianDumpMin(w.id, end - 2 * DAY_MS, end),
      graduated: Number(win.graduated ?? 0),
      recent: this.recentOf(w.id),
    };
  }

  /** Everything the store holds on a creator, back to its first day. */
  creatorTotals(wallet: string): HistoryTotals | null {
    const w = this.s.walletRow!.get(wallet) as { id: number; launches: number; dumped: number } | undefined;
    if (!w || !w.launches) return null;
    return {
      wallet,
      launches: Number(w.launches),
      dumped: Number(w.dumped),
      medianDumpMin: this.medianDumpMin(w.id, 0, Number.MAX_SAFE_INTEGER),
      graduated: Number((this.s.graduated!.get(w.id) as { n: number }).n),
      recent: this.recentOf(w.id),
    };
  }

  private medianDumpMin(creatorId: number, from: number, to: number): number | null {
    const ms = (this.s.dumpMins!.all(creatorId, from, to) as Array<{ ms: number }>).map((r) => Math.max(0, Math.round(Number(r.ms) / 60_000)));
    return ms.length ? ms[Math.floor(ms.length / 2)]! : null;
  }

  private recentOf(creatorId: number): CreatorRecord["recent"] {
    type Row = { mint: string; symbol: string; created_at: number; dev_dumped_at: number | null; graduated_at: number | null; pool_drained_at: number | null; dev_took: number | null; left_holding: number | null; alive: number | null };
    return (this.s.recent!.all(creatorId) as Row[]).map((t) => ({
      mint: t.mint,
      symbol: t.symbol,
      createdAt: t.created_at,
      dumpedAfterMin: t.dev_dumped_at === null ? null : Math.max(0, Math.round((t.dev_dumped_at - t.created_at) / 60_000)),
      dumpedAfterSec: t.dev_dumped_at === null ? null : Math.max(0, Math.round((t.dev_dumped_at - t.created_at) / 1000)),
      devTookSol: t.dev_took,
      leftHolding: t.left_holding,
      alive: t.pool_drained_at !== null ? false : t.alive === null ? null : t.alive === 1,
      graduated: t.graduated_at !== null,
    }));
  }

  /** The wallet dossier: its counters and its last tokens, each with the roles it played there. */
  wallet(wallet: string, limit = 50) {
    const w = this.s.walletRow!.get(wallet) as
      | { id: number; launches: number; dumped: number; snipes: number; crew_hits: number; bundle_hits: number; serial: number; first_seen: number; last_seen: number }
      | undefined;
    if (!w) return null;
    const rows = this.s.roles!.all(w.id, limit * 4) as Array<{ role: number; took: number | null; mint: string; symbol: string; created_at: number; dev_dumped_at: number | null; graduated_at: number | null; pool_drained_at: number | null; creator: string }>;
    const tokens = new Map<string, { mint: string; symbol: string; createdAt: number; creator: string; roles: Role[]; took: number | null; devDumpedAfterMin: number | null; graduated: boolean; drained: boolean }>();
    for (const r of rows) {
      let t = tokens.get(r.mint);
      if (!t) {
        if (tokens.size >= limit) break;
        t = {
          mint: r.mint,
          symbol: r.symbol,
          createdAt: r.created_at,
          creator: r.creator,
          roles: [],
          took: null,
          devDumpedAfterMin: r.dev_dumped_at === null ? null : Math.max(0, Math.round((r.dev_dumped_at - r.created_at) / 60_000)),
          graduated: r.graduated_at !== null,
          drained: r.pool_drained_at !== null,
        };
        tokens.set(r.mint, t);
      }
      const role = ROLE_NAME[r.role];
      if (role && !t.roles.includes(role)) t.roles.push(role);
      if (r.took !== null && (role === "early" || t.took === null)) t.took = r.took / 10_000;
    }
    return {
      wallet,
      launches: Number(w.launches),
      dumped: Number(w.dumped),
      snipes: Number(w.snipes),
      crewHits: Number(w.crew_hits),
      bundleHits: Number(w.bundle_hits),
      serial: Boolean(w.serial),
      firstSeen: w.first_seen,
      lastSeen: w.last_seen,
      tokens: [...tokens.values()],
    };
  }

  /**
   * Drops tokens created before the cutoff, with their wallet links, a chunk per transaction; then wallets not seen
   * since. Yields between chunks so the stream keeps flowing.
   */
  async prune(now = Date.now(), keepMs = HISTORY_KEEP_MS, chunk = 2_000): Promise<{ tokens: number; wallets: number }> {
    const cutoff = now - keepMs;
    const pause = () => new Promise<void>((r) => setImmediate(r));
    let tokens = 0;
    let wallets = 0;
    for (;;) {
      const ids = (this.s.oldTokens!.all(cutoff, chunk) as Array<{ id: number }>).map((r) => Number(r.id));
      if (!ids.length) break;
      const list = ids.map(() => "?").join(",");
      this.db.exec("BEGIN");
      this.db.prepare(`DELETE FROM wallet_tokens WHERE token_id IN (${list})`).run(...ids);
      this.db.prepare(`DELETE FROM tokens WHERE id IN (${list})`).run(...ids);
      this.db.exec("COMMIT");
      tokens += ids.length;
      this.sinceAt = undefined;
      await pause();
    }
    let after = 0;
    for (;;) {
      const page = this.s.walletPage!.all(after, chunk * 5) as Array<{ id: number; last_seen: number }>;
      if (!page.length) break;
      after = Number(page[page.length - 1]!.id);
      const old = page.filter((r) => r.last_seen < cutoff).map((r) => Number(r.id));
      if (old.length) {
        this.db.prepare(`DELETE FROM wallets WHERE id IN (${old.map(() => "?").join(",")})`).run(...old);
        wallets += old.length;
      }
      await pause();
    }
    return { tokens, wallets };
  }

  close(): void {
    this.db.close();
  }
}

export interface HistoryOptions {
  /** The funder already traced for a creator, if any. */
  funderOf?: (creator: string) => string | null | undefined;
  log?: (m: string) => void;
  flushMs?: number;
  /** Walk the tape already in memory into the store, a slice at a time. */
  backfill?: boolean;
}

/** When a token is written after its launch: the first seconds settled, then the first quarter hour, then three hours in. */
const SETTLE_MS = [60_000, 15 * 60_000, 3 * 3_600_000];
const QUEUE_MAX = 200_000;

/**
 * Feeds the store from the tape: each launch is written as its first minute settles and twice more later, and a
 * token is written again at once when its dev dumps, it graduates or its pool is drained.
 */
export function startHistory(store: HistoryStore, tape: PumpTape, { funderOf, log = () => {}, flushMs = 5_000, backfill = true }: HistoryOptions = {}): () => void {
  const queues = SETTLE_MS.map((delay) => ({ delay, items: [] as Array<[number, string]> }));
  const soon = new Set<string>();
  const previous = tape.onMoment;
  tape.onMoment = (e: PulseEvent) => {
    previous?.(e);
    if (e.kind === "launch" || e.kind === "serial") {
      for (const q of queues) if (q.items.length < QUEUE_MAX) q.items.push([e.at + q.delay, e.mint]);
    } else if (e.kind === "dump" || e.kind === "graduated" || e.kind === "drained") soon.add(e.mint);
  };
  const take = (mint: string, now: number) => {
    const rec = tape.historyOf(mint, now);
    if (rec) store.enqueue({ ...rec, funder: funderOf?.(rec.creator) ?? null });
  };
  const tick = () => {
    const now = Date.now();
    try {
      const due = new Set(soon);
      soon.clear();
      for (const q of queues) {
        let n = 0;
        while (n < q.items.length && q.items[n]![0] <= now) due.add(q.items[n++]![1]);
        if (n) q.items.splice(0, n);
      }
      for (const mint of due) take(mint, now);
      store.flush(now);
    } catch (error) {
      log(`history not written: ${(error as Error).message}`);
    }
  };
  const flushTimer = setInterval(tick, flushMs);
  flushTimer.unref();

  let stopped = false;
  if (backfill) {
    void (async () => {
      const mints = tape.mints();
      let added = 0;
      for (let i = 0; i < mints.length && !stopped; i += 100) {
        const now = Date.now();
        try {
          const fresh = mints.slice(i, i + 100).filter((m) => !store.has(m));
          for (const m of fresh) take(m, now);
          added += fresh.length;
          store.flush(now);
        } catch (error) {
          log(`history backfill: ${(error as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      log(`history backfilled ${added} tokens from the tape`);
    })();
  }

  const prune = async () => {
    try {
      const r = await store.prune();
      if (r.tokens || r.wallets) log(`history pruned ${r.tokens} tokens, ${r.wallets} wallets older than 90 days`);
    } catch (error) {
      log(`history not pruned: ${(error as Error).message}`);
    }
  };
  const firstPrune = setTimeout(prune, 10 * 60_000);
  firstPrune.unref();
  const pruneTimer = setInterval(prune, DAY_MS);
  pruneTimer.unref();

  return () => {
    stopped = true;
    clearInterval(flushTimer);
    clearTimeout(firstPrune);
    clearInterval(pruneTimer);
    tape.onMoment = previous;
    tick();
  };
}
