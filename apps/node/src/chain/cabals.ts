import type { DatabaseSync } from "node:sqlite";
import { deployerOf, exchangeOf, launcherOf } from "./exchanges.ts";
import type { PumpTape } from "./pump.ts";

/**
 * Cabals: wallets that work as one hand, read from the long memory. Four ties join two wallets:
 *   - the same wallet paid for both creators (an exchange or a launcher ties no one);
 *   - a wallet keeps sniping a creator's launches (crew);
 *   - two first-second wallets were flagged a ring on the same launch (they snipe launches together);
 *   - a wallet bought in the launch block of the same creator's launches twice or more.
 * Every connected set of three wallets or more is a cabal, with the record of all its members: launches, dumps,
 * snipes, when it was first and last seen. Rebuilt every hour from the memory, a slice at a time, so the stream
 * never waits on it. Each cabal keeps its number for as long as its oldest wallet stays in it.
 */

export interface Cabal {
  id: number;
  wallets: number;
  launches: number;
  dumped: number;
  graduated: number;
  snipes: number;
  firstSeen: number;
  lastSeen: number;
  /** Up to 200 members: wallet, what it did. */
  members: Array<{ wallet: string; launches: number; dumped: number; snipes: number; crewHits: number; bundleHits: number }>;
}

const MIN_WALLETS = 3;
/** A wallet this busy is a platform or a bot that touches everything, not a member: it ties no one together. */
const HUB_LAUNCHES = 150;
const HUB_SNIPES = 150;
const MEMBERS_KEPT = 200;
const SLICE = 400;
const F_RING = 4;

const pause = () => new Promise<void>((r) => setImmediate(r));

class UnionFind {
  private readonly parent = new Map<number, number>();
  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    while (x !== root) {
      const next = this.parent.get(x)!;
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  members(): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      const list = out.get(r) ?? [];
      list.push(x);
      out.set(r, list);
    }
    return out;
  }
}

export class CabalIndex {
  private readonly db: DatabaseSync;
  private byWallet = new Map<string, number>();
  private list: Cabal[] = [];
  private building = false;
  builtAt = 0;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cabals (
        id INTEGER PRIMARY KEY,
        key_wallet INTEGER NOT NULL UNIQUE,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cabal_wallets (
        wallet TEXT PRIMARY KEY,
        cabal_id INTEGER NOT NULL
      ) WITHOUT ROWID;
    `);
    this.load();
  }

  /** What was built last, from the table, so a restart answers at once. */
  private load(): void {
    const rows = this.db.prepare("SELECT id, body, updated_at FROM cabals ORDER BY id").all() as Array<{ id: number; body: string; updated_at: number }>;
    const list: Cabal[] = [];
    for (const r of rows) {
      try {
        list.push({ ...(JSON.parse(r.body) as Omit<Cabal, "id">), id: Number(r.id) });
        this.builtAt = Math.max(this.builtAt, Number(r.updated_at));
      } catch {
        /* a broken row is skipped */
      }
    }
    this.list = list.sort((a, b) => b.dumped - a.dumped || b.launches - a.launches);
    this.byWallet = new Map((this.db.prepare("SELECT wallet, cabal_id FROM cabal_wallets").all() as Array<{ wallet: string; cabal_id: number }>).map((r) => [r.wallet, Number(r.cabal_id)]));
  }

  /** The cabal a wallet belongs to, if any. */
  of(wallet: string): number | null {
    return this.byWallet.get(wallet) ?? null;
  }

  get(id: number): Cabal | null {
    return this.list.find((c) => c.id === id) ?? null;
  }

  /** The cabals with the most dumps first. */
  top(limit = 50): Cabal[] {
    return this.list.slice(0, limit);
  }

  count(): number {
    return this.list.length;
  }

  /** Walks the memory and rebuilds every cabal. Returns how many; 0 while another build runs. */
  async build(now = Date.now(), log: (m: string) => void = () => {}): Promise<number> {
    if (this.building) return 0;
    this.building = true;
    try {
      const uf = new UnionFind();
      const hot = (w: string) => exchangeOf(w) !== null || launcherOf(w) !== null;
      // Hubs: launchpad deployers, ticker farms and bots that snipe everything would glue every cabal into one.
      const hubs = new Set<number>();
      for (const r of this.db.prepare("SELECT id, wallet, launches, snipes FROM wallets WHERE launches >= ? OR snipes >= ?").all(HUB_LAUNCHES, HUB_SNIPES) as Array<{ id: number; wallet: string; launches: number; snipes: number }>) hubs.add(Number(r.id));
      for (const r of this.db.prepare("SELECT id, wallet FROM wallets").all() as Array<{ id: number; wallet: string }>) if (deployerOf(r.wallet) || hot(r.wallet)) hubs.add(Number(r.id));
      const tie = (a: number, b: number) => {
        if (!hubs.has(a) && !hubs.has(b)) uf.union(a, b);
      };
      await pause();
      // Ties through a funder: every creator a wallet paid for, unless that wallet is everyone's.
      const funded = this.db.prepare("SELECT funder, creator_id FROM tokens WHERE funder IS NOT NULL").all() as Array<{ funder: string; creator_id: number }>;
      const byFunder = new Map<string, Set<number>>();
      for (const r of funded) {
        if (hot(r.funder)) continue;
        const set = byFunder.get(r.funder) ?? new Set();
        set.add(Number(r.creator_id));
        byFunder.set(r.funder, set);
      }
      for (const set of byFunder.values()) {
        const list = [...set].filter((c) => !hubs.has(c));
        for (let k = 1; k < list.length; k++) tie(list[0]!, list[k]!);
      }
      await pause();
      // Crew: a wallet in a creator's launches again and again.
      const crew = this.db.prepare("SELECT wt.wallet_id AS w, t.creator_id AS c FROM wallet_tokens wt JOIN tokens t ON t.id = wt.token_id WHERE wt.role = 3").all() as Array<{ w: number; c: number }>;
      for (const r of crew) tie(Number(r.w), Number(r.c));
      await pause();
      // The launch block, twice for the same creator.
      const bundles = this.db.prepare("SELECT wt.wallet_id AS w, t.creator_id AS c, count(*) AS n FROM wallet_tokens wt JOIN tokens t ON t.id = wt.token_id WHERE wt.role = 2 GROUP BY wt.wallet_id, t.creator_id HAVING n >= 2").all() as Array<{ w: number; c: number; n: number }>;
      for (const r of bundles) tie(Number(r.w), Number(r.c));
      await pause();
      // Rings: first-second wallets flagged as sniping together, token by token, a slice at a time.
      const ids = (this.db.prepare("SELECT id FROM tokens ORDER BY id").all() as Array<{ id: number }>).map((r) => Number(r.id));
      const bodyOf = this.db.prepare("SELECT body FROM tokens WHERE id = ?");
      for (let i = 0; i < ids.length; i += SLICE) {
        for (const id of ids.slice(i, i + SLICE)) {
          const row = bodyOf.get(id) as { body: Uint8Array } | undefined;
          if (!row) continue;
          let e: Array<[number, number, number, number, number, number, number]>;
          try {
            e = (JSON.parse(Buffer.from(row.body).toString("utf8")) as { e?: typeof e }).e ?? [];
          } catch {
            continue;
          }
          const ring = e.filter((x) => (x[5] & F_RING) !== 0).map((x) => x[0]).filter((w) => !hubs.has(w));
          for (let k = 1; k < ring.length; k++) tie(ring[0]!, ring[k]!);
        }
        await pause();
      }
      // The sets, with each member's record.
      const walletOf = this.db.prepare("SELECT wallet, launches, dumped, snipes, crew_hits, bundle_hits, first_seen, last_seen FROM wallets WHERE id = ?");
      const graduatedOf = this.db.prepare("SELECT count(*) AS n FROM tokens WHERE creator_id = ? AND graduated_at IS NOT NULL");
      const built: Array<{ key: number; cabal: Omit<Cabal, "id">; walletIds: number[] }> = [];
      let n = 0;
      for (const [, ids] of uf.members()) {
        if (ids.length < MIN_WALLETS) continue;
        const members: Cabal["members"] = [];
        let launches = 0, dumped = 0, graduated = 0, snipes = 0, firstSeen = Infinity, lastSeen = 0;
        const sorted = [...ids].sort((a, b) => a - b);
        for (const id of sorted) {
          const w = walletOf.get(id) as { wallet: string; launches: number; dumped: number; snipes: number; crew_hits: number; bundle_hits: number; first_seen: number; last_seen: number } | undefined;
          if (!w) continue;
          launches += Number(w.launches);
          dumped += Number(w.dumped);
          snipes += Number(w.snipes);
          if (Number(w.launches) > 0) graduated += Number((graduatedOf.get(id) as { n: number }).n);
          firstSeen = Math.min(firstSeen, Number(w.first_seen));
          lastSeen = Math.max(lastSeen, Number(w.last_seen));
          members.push({ wallet: w.wallet, launches: Number(w.launches), dumped: Number(w.dumped), snipes: Number(w.snipes), crewHits: Number(w.crew_hits), bundleHits: Number(w.bundle_hits) });
        }
        if (members.length < MIN_WALLETS) continue;
        members.sort((a, b) => b.launches + b.snipes - (a.launches + a.snipes));
        built.push({ key: sorted[0]!, cabal: { wallets: members.length, launches, dumped, graduated, snipes, firstSeen: Number.isFinite(firstSeen) ? firstSeen : now, lastSeen, members: members.slice(0, MEMBERS_KEPT) }, walletIds: sorted });
        if (++n % 200 === 0) await pause();
      }
      // Written in one transaction: numbers stay with their oldest wallet, new cabals get the next number.
      const allMembers = new Map<number, string[]>();
      this.db.exec("BEGIN");
      try {
        const upsert = this.db.prepare("INSERT INTO cabals (key_wallet, body, updated_at) VALUES (?, ?, ?) ON CONFLICT (key_wallet) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at RETURNING id");
        this.db.exec("DELETE FROM cabal_wallets");
        const link = this.db.prepare("INSERT OR REPLACE INTO cabal_wallets (wallet, cabal_id) VALUES (?, ?)");
        for (const b of built) {
          const id = Number((upsert.get(b.key, JSON.stringify(b.cabal), now) as { id: number | bigint }).id);
          allMembers.set(id, b.cabal.members.map((m) => m.wallet));
          for (const m of b.cabal.members) link.run(m.wallet, id);
        }
        this.db.prepare("DELETE FROM cabals WHERE updated_at < ?").run(now);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.load();
      this.builtAt = now;
      log(`cabals: ${this.list.length} from ${funded.length} funded launches, ${crew.length} crew hits, ${bundles.length} repeat bundlers`);
      return this.list.length;
    } finally {
      this.building = false;
    }
  }

  /** The tokens a cabal's creators have on the tape right now, newest first. */
  live(id: number, tape: PumpTape, limit = 12): Array<{ mint: string; symbol: string; creator: string; createdAt: number }> {
    const c = this.get(id);
    if (!c) return [];
    const out: Array<{ mint: string; symbol: string; creator: string; createdAt: number }> = [];
    for (const m of c.members) {
      const p = tape.creator(m.wallet);
      if (!p) continue;
      for (const l of p.recent) out.push({ mint: l.mint, symbol: l.symbol, creator: m.wallet, createdAt: l.createdAt });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}

/** Rebuilds the cabals now and then every hour. */
export function startCabals(index: CabalIndex, { log = () => {}, everyMs = 3_600_000, delayMs = 60_000 }: { log?: (m: string) => void; everyMs?: number; delayMs?: number } = {}): () => void {
  const run = () => void index.build(Date.now(), log).catch((e) => log(`cabals failed: ${(e as Error).message?.slice(0, 120)}`));
  const first = setTimeout(run, delayMs);
  const timer = setInterval(run, everyMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
