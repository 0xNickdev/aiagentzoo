import { existsSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";
import { exchangeOf, launcherOf } from "./exchanges.ts";

/**
 * The operator graph: launch wallets the long memory ties together across launches, one operator per group.
 *
 * A rugger swaps wallets every launch; what he cannot swap as easily is where the SOL comes from, the wallets he
 * snipes his own launches with, the private tool he launches from, or the SOL he moves from one launch wallet to the
 * next. Each of those is an on-chain tie, and two launch wallets with one are joined (union-find, kept in history.db).
 * An X account or Telegram group shared by launches is kept as evidence and named, but never joins anything on its
 * own: anyone can paste anyone's link into metadata. So an operator always has at least one on-chain tie.
 *
 * Updated incrementally: each run reads the tokens written since the last one (by id), a bounded number at a time.
 */

export type TieType = "funder" | "transfer" | "snipers" | "print" | "account";
export const ONCHAIN_TIES: ReadonlySet<TieType> = new Set(["funder", "transfer", "snipers", "print"]);
/**
 * The ties that join groups of any size. Shared snipers are only supporting evidence: sniper bots buy everyone's
 * launches, and union-find through them chained hundreds of unrelated devs together, so they join two lone wallets at most.
 */
export const STRONG_TIES: ReadonlySet<TieType> = new Set(["funder", "transfer", "print"]);

export const OPGRAPH = {
  /** Bumped when the tie rules change: a node seeing an older version in op_state rebuilds the graph from history. */
  version: 2,
  /** A funder that paid more launch wallets than this is a service (an exchange, a launcher, a bot farm's hot wallet): not one hand. */
  funderMaxDevs: 10,
  /** Early wallets sniping more launches than this (in the long memory) are bots, not the dev's own: they tie nothing. */
  sniperMaxSnipes: 8,
  /** Only wallets in this many seconds of the launch count as its snipers. */
  sniperWithinSec: 5,
  /** Two launch wallets share at least this many of those rare early wallets to be tied. */
  sharedSnipers: 3,
  /** A snipers tie joins only when the joined group stays this small: it never chains groups together. */
  sniperJoinMax: 2,
  /** An exact tool print shared by at most this many wallets is a private setup; above it, a product anyone uses. */
  printMaxWallets: 12,
  /** An account on launches by more devs than this is borrowed (a famous trader's link): kept out even as evidence. */
  accountMaxDevs: 3,
  /** A group stops growing here: past it a tie is kept as evidence but joins nothing. A group at the cap is too broad to judge. */
  maxMembers: 60,
  /** Tokens read per run, and a token is read only once it has settled (its funder traced, its first quarter hour written). */
  perRun: 5_000,
  settleMs: 20 * 60_000,
  /** Evidence and members not touched for this long go, like the rest of the long memory. */
  keepMs: 90 * 24 * 3_600_000,
} as const;

export interface OperatorTie {
  type: TieType;
  other: string;
  detail: string | null;
  firstSeen: number;
}

export interface OperatorSummary {
  /** The group's id: one of its launch wallets, stable until the group joins a bigger one. */
  id: string;
  /** Launch wallets in the group, this one included. */
  creators: number;
  members: string[];
  /** Launches and dumps by the group's other wallets, from the long memory. */
  launches: number;
  dumped: number;
  /** X accounts and Telegram groups the group's launches linked to (evidence only). */
  accounts: string[];
  /** How many ties of each kind hold the group together. */
  ties: Partial<Record<TieType, number>>;
  /** The ties that touch the asked wallet, newest first. */
  near: OperatorTie[];
  firstSeen: number;
  /** The group hit the member cap: too broad to be one hand, so it never moves a verdict. */
  tooBroad?: boolean;
}

export interface OpGraphDeps {
  /** A launch's exact tool print and the other wallets that launched with it, while the tape still holds it. */
  printOf?: (mint: string) => { key: string; wallets: number; common: boolean; creators: string[] } | null;
  /** Where tokens, wallets and socials are read (history.db, read-only); the graph's own tables stay in `db`. Defaults to `db`. */
  src?: DatabaseSync;
  /** A reader only: no schema is made (the writer made it). */
  readOnly?: boolean;
}

const OPGRAPH_SCHEMA = `
      CREATE TABLE IF NOT EXISTS op_members (
        creator TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS op_members_root ON op_members (root);
      CREATE TABLE IF NOT EXISTS op_edges (
        a TEXT NOT NULL,
        b TEXT NOT NULL,
        type TEXT NOT NULL,
        detail TEXT,
        first_seen INTEGER NOT NULL,
        PRIMARY KEY (a, b, type)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS op_edges_b ON op_edges (b);
      CREATE INDEX IF NOT EXISTS op_edges_seen ON op_edges (first_seen);
      CREATE TABLE IF NOT EXISTS op_state (k TEXT PRIMARY KEY, v INTEGER NOT NULL) WITHOUT ROWID;
    `;

/** The graph's own file (opgraph.db): WAL, so the worker writes while the main thread reads, never inside history.db. */
export function openOpGraphDb(path: string, opts: { readOnly?: boolean } = {}): DatabaseSync {
  if (opts.readOnly) {
    // Make the file and schema first if the worker has not yet, then read it only.
    if (!existsSync(path)) {
      const w = openOpGraphDb(path);
      w.exec(OPGRAPH_SCHEMA);
      w.close();
    }
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 5000;");
    return db;
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 30000;");
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  return db;
}

type Pair = [string, string];
const ordered = (a: string, b: string): Pair => (a < b ? [a, b] : [b, a]);

export class OperatorGraph {
  readonly db: DatabaseSync;
  readonly src: DatabaseSync;
  private readonly s: Record<string, StatementSync>;
  private readonly deps: OpGraphDeps;

  constructor(db: DatabaseSync, deps: OpGraphDeps = {}) {
    this.db = db;
    this.src = deps.src ?? db;
    this.deps = deps;
    if (!deps.readOnly) db.exec(OPGRAPH_SCHEMA);
    const p = (sql: string) => db.prepare(sql);
    const h = (sql: string) => this.src.prepare(sql);
    this.s = {
      root: p("SELECT root FROM op_members WHERE creator = ?"),
      size: p("SELECT count(*) AS n FROM op_members WHERE root = ?"),
      member: p("INSERT INTO op_members (creator, root, first_seen, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT (creator) DO UPDATE SET last_seen = max(last_seen, excluded.last_seen)"),
      reroot: p("UPDATE op_members SET root = ? WHERE root = ?"),
      members: p("SELECT creator, first_seen FROM op_members WHERE root = ? ORDER BY first_seen LIMIT ?"),
      edge: p("INSERT OR IGNORE INTO op_edges (a, b, type, detail, first_seen) VALUES (?, ?, ?, ?, ?)"),
      near: p("SELECT a, b, type, detail, first_seen FROM op_edges WHERE a = ? UNION ALL SELECT a, b, type, detail, first_seen FROM op_edges WHERE b = ? ORDER BY first_seen DESC LIMIT ?"),
      state: p("SELECT v FROM op_state WHERE k = ?"),
      setState: p("INSERT INTO op_state (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v"),
      batch: h("SELECT t.id, t.mint, t.created_at, t.first_seen, t.funder, t.body, t.creator_id, w.wallet AS creator FROM tokens t JOIN wallets w ON w.id = t.creator_id WHERE t.id > ? ORDER BY t.id LIMIT ?"),
      funderDevs: h("SELECT count(DISTINCT creator_id) AS n FROM tokens WHERE funder = ?"),
      funderPrev: h("SELECT w.wallet FROM tokens t JOIN wallets w ON w.id = t.creator_id WHERE t.funder = ? AND t.creator_id <> ? ORDER BY t.created_at DESC LIMIT 1"),
      isCreator: h("SELECT launches FROM wallets WHERE wallet = ?"),
      sniperCreators: h("SELECT DISTINCT t.creator_id FROM wallet_tokens wt JOIN tokens t ON t.id = wt.token_id WHERE wt.wallet_id = ? AND wt.role = 1 AND t.creator_id <> ? LIMIT 60"),
      walletName: h("SELECT wallet FROM wallets WHERE id = ?"),
    };
  }

  private social: { accounts: StatementSync; devs: StatementSync; others: StatementSync } | null | undefined;
  /** The socials table is made by the socials registry; a store without it has no account evidence. */
  private socialQueries() {
    if (this.social === undefined) {
      try {
        this.social = {
          accounts: this.src.prepare("SELECT account FROM social_links WHERE mint = ?"),
          devs: this.src.prepare("SELECT count(DISTINCT creator) AS n FROM social_links WHERE account = ?"),
          others: this.src.prepare("SELECT creator FROM social_links WHERE account = ? GROUP BY creator ORDER BY max(created_at) DESC LIMIT 20"),
        };
      } catch {
        this.social = null;
      }
    }
    return this.social;
  }

  private rootOf(w: string): string | null {
    return ((this.s.root!.get(w) as { root: string } | undefined)?.root) ?? null;
  }

  private sizeOf(root: string): number {
    return Number((this.s.size!.get(root) as { n: number }).n);
  }

  /**
   * Records a tie between two launch wallets. An on-chain tie joins their groups, unless the joined group would pass
   * the cap; an account tie is evidence only. Returns true when the groups were joined.
   */
  tie(a: string, b: string, type: TieType, detail: string | null, at: number): boolean {
    if (!a || !b || a === b) return false;
    const [x, y] = ordered(a, b);
    this.s.edge!.run(x, y, type, detail, at);
    if (!ONCHAIN_TIES.has(type)) return false;
    const ra = this.rootOf(a);
    const rb = this.rootOf(b);
    if (ra && ra === rb) return false;
    const sa = ra ? this.sizeOf(ra) : 1;
    const sb = rb ? this.sizeOf(rb) : 1;
    if (sa + sb > (STRONG_TIES.has(type) ? OPGRAPH.maxMembers : OPGRAPH.sniperJoinMax)) return false;
    // The bigger group keeps its id; the smaller one's wallets move under it.
    const [bigRoot, bigWallet, smallRoot, smallWallet] = sa >= sb ? [ra ?? a, a, rb, b] : [rb ?? b, b, ra, a];
    this.s.member!.run(bigWallet, bigRoot, at, at);
    if (smallRoot) this.s.reroot!.run(bigRoot, smallRoot);
    else this.s.member!.run(smallWallet, bigRoot, at, at);
    return true;
  }

  /** Reads the tokens written since the last run, at most `limit`, and records the ties they show. */
  update(now = Date.now(), limit: number = OPGRAPH.perRun): { tokens: number; ties: number } {
    const after = Number((this.s.state!.get("tokens_id") as { v: number } | undefined)?.v ?? 0);
    // A graph started from nothing is built under the current rules.
    if (!after && this.stateOf("version") === null) this.s.setState!.run("version", OPGRAPH.version);
    type Row = { id: number; mint: string; created_at: number; first_seen: number; funder: string | null; body: Uint8Array; creator_id: number; creator: string };
    const rows = this.s.batch!.all(after, limit) as Row[];
    let last = after;
    let tokens = 0;
    let ties = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows) {
        // Not settled yet: its funder may still be on the way. The next run starts here.
        if (now - Number(r.first_seen) < OPGRAPH.settleMs) break;
        ties += this.read(r, now);
        last = Number(r.id);
        tokens++;
      }
      this.s.setState!.run("tokens_id", last);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { tokens, ties };
  }

  private read(r: { mint: string; created_at: number; funder: string | null; body: Uint8Array; creator_id: number; creator: string }, now: number): number {
    const at = Number(r.created_at) || now;
    let n = 0;
    const tie = (other: string | null | undefined, type: TieType, detail: string | null) => {
      if (!other || other === r.creator) return;
      this.tie(r.creator, other, type, detail, at);
      n++;
    };
    // Same funder: the wallet that paid this launch wallet paid an earlier one. Exchanges and services are no one's.
    const f = r.funder;
    if (f && !exchangeOf(f) && !launcherOf(f)) {
      const devs = Number((this.s.funderDevs!.get(f) as { n: number }).n);
      if (devs <= OPGRAPH.funderMaxDevs) {
        const prev = this.s.funderPrev!.get(f, r.creator_id) as { wallet: string } | undefined;
        tie(prev?.wallet, "funder", f);
      }
      // The funder launched coins itself: SOL moved from one launch wallet to the next.
      const own = this.s.isCreator!.get(f) as { launches: number } | undefined;
      if (own && Number(own.launches) > 0) tie(f, "transfer", null);
    }
    // Shared early snipers: the same few non-bot wallets in the first seconds of two devs' launches.
    try {
      const body = JSON.parse(inflateRawSync(r.body).toString()) as { e?: Array<[number, ...number[]]> };
      const ids = (body.e ?? []).filter((e) => Number(e[3] ?? 0) <= OPGRAPH.sniperWithinSec).map((e) => e[0]).slice(0, 30);
      if (ids.length) {
        const snipes = ids.length < OPGRAPH.sharedSnipers ? [] : this.src.prepare(`SELECT id, snipes FROM wallets WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<{ id: number; snipes: number }>;
        const shared = new Map<number, number>();
        for (const w of snipes) {
          if (Number(w.snipes) > OPGRAPH.sniperMaxSnipes) continue;
          for (const c of this.s.sniperCreators!.all(w.id, r.creator_id) as Array<{ creator_id: number }>) shared.set(Number(c.creator_id), (shared.get(Number(c.creator_id)) ?? 0) + 1);
        }
        for (const [cid, k] of shared) {
          if (k < OPGRAPH.sharedSnipers) continue;
          const other = (this.s.walletName!.get(cid) as { wallet: string } | undefined)?.wallet;
          tie(other, "snipers", `${k} shared`);
        }
      }
    } catch {
      /* a body that does not read ties nothing */
    }
    // A private tool print (exact build, few wallets) shared with other launch wallets.
    const print = this.deps.printOf?.(r.mint);
    if (print && !print.common && print.wallets >= 2 && print.wallets <= OPGRAPH.printMaxWallets) {
      for (const c of print.creators.slice(0, 5)) tie(c, "print", print.key);
    }
    // Accounts: evidence only, and only accounts not borrowed from launches by many devs.
    const q = this.socialQueries();
    if (q) {
      for (const { account } of q.accounts.all(r.mint) as Array<{ account: string }>) {
        if (Number((q.devs.get(account) as { n: number }).n) > OPGRAPH.accountMaxDevs) continue;
        for (const o of q.others.all(account) as Array<{ creator: string }>) tie(o.creator, "account", account);
      }
    }
    return n;
  }

  /** The operator a launch wallet belongs to, or null when no on-chain tie puts it in a group. */
  summary(creator: string, opts: { members?: number; near?: number } = {}): OperatorSummary | null {
    if (this.rebuilding()) return null;
    const root = this.rootOf(creator);
    if (!root) return null;
    const rows = this.s.members!.all(root, OPGRAPH.maxMembers) as Array<{ creator: string; first_seen: number }>;
    if (rows.length < 2) return null;
    const all = rows.map((r) => r.creator);
    const others = all.filter((w) => w !== creator);
    const list = (xs: string[]) => xs.map(() => "?").join(",");
    const rec = this.src.prepare(`SELECT sum(launches) AS l, sum(dumped) AS d FROM wallets WHERE wallet IN (${list(others)})`).get(...others) as { l: number | null; d: number | null };
    const ties: Partial<Record<TieType, number>> = {};
    const tieRows = this.db.prepare(`SELECT type, count(*) AS n FROM op_edges WHERE a IN (${list(all)}) AND b IN (${list(all)}) GROUP BY type`).all(...all, ...all) as Array<{ type: TieType; n: number }>;
    for (const t of tieRows) ties[t.type] = Number(t.n);
    let accounts: string[] = [];
    try {
      accounts = (this.src.prepare(`SELECT DISTINCT account FROM social_links WHERE creator IN (${list(all)}) LIMIT 8`).all(...all) as Array<{ account: string }>).map((a) => a.account);
    } catch {
      /* no socials table on this store */
    }
    // Accounts count only when two of the group's wallets share them: one dev's own link is not a tie.
    const shared = new Set((this.db.prepare(`SELECT detail FROM op_edges WHERE type = 'account' AND a IN (${list(all)}) AND b IN (${list(all)})`).all(...all, ...all) as Array<{ detail: string }>).map((r) => r.detail));
    accounts = accounts.filter((a) => shared.has(a));
    const near = (this.s.near!.all(creator, creator, opts.near ?? 10) as Array<{ a: string; b: string; type: TieType; detail: string | null; first_seen: number }>).map((e) => ({ type: e.type, other: e.a === creator ? e.b : e.a, detail: e.detail, firstSeen: Number(e.first_seen) }));
    return {
      id: root,
      creators: all.length,
      members: all.slice(0, opts.members ?? 50),
      launches: Number(rec.l ?? 0),
      dumped: Number(rec.d ?? 0),
      accounts,
      ties,
      near,
      firstSeen: Math.min(...rows.map((r) => Number(r.first_seen))),
      ...(all.length >= OPGRAPH.maxMembers ? { tooBroad: true } : {}),
    };
  }

  /** The group's id for a wallet, without the summary. */
  idOf(creator: string): string | null {
    if (this.rebuilding()) return null;
    return this.rootOf(creator);
  }

  private stateOf(k: string): number | null {
    const v = (this.s.state!.get(k) as { v: number } | undefined)?.v;
    return v === undefined ? null : Number(v);
  }

  /** True while a rebuild is reading history again: the half-built groups say nothing yet. */
  rebuilding(): boolean {
    return this.stateOf("rebuilding") === 1;
  }

  /** True when the tables were built under older tie rules (or never versioned) and hold anything. */
  outdated(): boolean {
    if (this.stateOf("version") === OPGRAPH.version) return false;
    const any = this.db.prepare("SELECT 1 FROM op_members LIMIT 1").get() ?? this.db.prepare("SELECT 1 FROM op_edges LIMIT 1").get();
    if (!any && !this.stateOf("tokens_id")) {
      this.s.setState!.run("version", OPGRAPH.version);
      return false;
    }
    return true;
  }

  /** Empties the graph and starts reading history from the first token under the current rules. */
  reset(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM op_members; DELETE FROM op_edges;");
      this.s.setState!.run("tokens_id", 0);
      this.s.setState!.run("version", OPGRAPH.version);
      this.s.setState!.run("rebuilding", 1);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Marks a rebuild caught up with history. */
  rebuilt(): void {
    this.s.setState!.run("rebuilding", 0);
  }

  /** One-shot rebuild in batches (the CLI's): reset, then read all of history. */
  rebuild(now = Date.now(), onBatch: (tokens: number) => void = () => {}): number {
    this.reset();
    let total = 0;
    for (;;) {
      const r = this.update(now);
      total += r.tokens;
      onBatch(total);
      if (r.tokens < OPGRAPH.perRun) break;
    }
    this.rebuilt();
    return total;
  }

  /** Group sizes: how many groups of each size, for reports. */
  sizes(): Map<number, number> {
    const rows = this.db.prepare("SELECT n, count(*) AS g FROM (SELECT count(*) AS n FROM op_members GROUP BY root) GROUP BY n ORDER BY n").all() as Array<{ n: number; g: number }>;
    return new Map(rows.map((r) => [Number(r.n), Number(r.g)]));
  }

  /** Drops evidence older than the long memory; members not seen since go too. */
  prune(now = Date.now()): number {
    const cut = now - OPGRAPH.keepMs;
    const { changes } = this.db.prepare("DELETE FROM op_edges WHERE first_seen < ?").run(cut);
    this.db.prepare("DELETE FROM op_members WHERE last_seen < ?").run(cut);
    return Number(changes);
  }
}

const TIE_TEXT: Record<TieType, string> = {
  funder: "same funder",
  transfer: "SOL from another launch wallet",
  snipers: "the same early snipers",
  print: "the same private launch tool",
  account: "the same account",
};

/**
 * The check's line for a dev inside an operator whose other wallets dump. Null when the group's record is clean or
 * thin. Never avoid on accounts: the group exists only through on-chain ties, and the line names them first.
 */
export function operatorGraphWarning(s: OperatorSummary | null | undefined, creator?: string): { text: string; avoid: boolean } | null {
  if (!s || s.creators < 2 || s.tooBroad) return null;
  if (s.dumped < 3 || s.dumped / Math.max(1, s.launches) < 0.5) return null;
  const kinds = (Object.keys(s.ties) as TieType[]).filter((k) => ONCHAIN_TIES.has(k));
  if (!kinds.length) return null;
  // A group held mainly by shared snipers is not one hand: no reason from it.
  const strongN = kinds.filter((k) => STRONG_TIES.has(k)).reduce((n, k) => n + (s.ties[k] ?? 0), 0);
  if (!strongN || strongN * 2 < (s.ties.snipers ?? 0)) return null;
  // The ties that touch this dev say how it was joined; the group's own say what else holds it.
  const nearKinds = [...new Set(s.near.filter((t) => t.other !== creator).map((t) => t.type))];
  const shown = [...new Set([...nearKinds.filter((k) => ONCHAIN_TIES.has(k)), ...kinds])].slice(0, 2).map((k) => TIE_TEXT[k]);
  const acc = s.accounts.slice(0, 1).map((a) => a.replace(/^x:/, "X ").replace(/^telegram:/, "Telegram ").replace(/^x-community:/, "X community "));
  const others = s.creators - 1;
  const text = `this dev shares ${shown.join(" and ")} as ${others} other launch wallet${others === 1 ? "" : "s"} whose ${s.launches} launches dumped ${s.dumped} times${acc.length ? `; same ${acc[0]}` : ""}`;
  const strong = kinds.some((k) => k === "funder" || k === "transfer");
  return { text, avoid: strong && s.dumped >= 5 && s.dumped / Math.max(1, s.launches) >= 0.7 };
}
