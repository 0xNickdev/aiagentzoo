import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/**
 * PumpSwap pools by the volume they show, each one read from the chain: who opened it and with how much SOL, whether
 * that wallet has taken the liquidity back, and how many of its trades only passed a bag from one wallet to another.
 * The list comes from GeckoTerminal; every number about a pool beyond its volume and counts is read from its own
 * transactions. A pool opened straight on PumpSwap never crosses the launchpad stream, so the tape cannot see it.
 */

const WSOL = "So11111111111111111111111111111111111111112";
const LIST = "https://api.geckoterminal.com/api/v2/networks/solana/dexes/pumpswap/pools?sort=h24_volume_usd_desc&page=";
const DEFAULT_RPC = "https://solana-rpc.publicnode.com";
/** Pools older than this are listed with their volume only: paging a months-old pool to its first trade is not worth the calls. */
export const READ_WINDOW_MS = 72 * 3_600_000;
const SAMPLE = 60;
const MAX_PAGES = 150;
const PAGE = 1000;
const EVERY_MS = 10 * 60_000;
const READS_PER_PASS = 20;

export interface PoolRow {
  pool: string;
  mint: string;
  symbol: string;
  createdAt: number;
  volumeUsd: number;
  fdvUsd: number | null;
  buyers: number;
  sellers: number;
  trades: number;
}
export interface PoolRead {
  creator: string;
  /** SOL the pool was opened with. */
  solIn: number;
  openedAt: number;
  /** Transactions on the pool that landed, when it was read. */
  trades: number;
  lastAt: number;
  /** Of `n` trades drawn at random, `passes` moved a bag from one wallet to another through the pool. */
  sample: { n: number; passes: number };
  /** The opener taking the liquidity back: how much SOL came out and when. */
  taken: { sol: number; at: number } | null;
  readAt: number;
}
export interface PoolEntry {
  row: PoolRow;
  read: PoolRead | null;
  seenAt: number;
}

type Fetch = typeof fetch;
interface Sig {
  signature: string;
  blockTime: number | null;
  err: unknown;
}
interface TokenBalance {
  owner?: string;
  mint: string;
  uiTokenAmount: { uiAmountString?: string | null };
}
export interface ParsedTx {
  blockTime: number | null;
  meta: { preTokenBalances?: TokenBalance[] | null; postTokenBalances?: TokenBalance[] | null } | null;
  transaction: { message: { accountKeys: Array<{ pubkey: string; signer: boolean }> } };
}

/** Each owner's change in one token across a transaction. */
function deltas(tx: ParsedTx, mint: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (list: TokenBalance[] | null | undefined, sign: number) => {
    for (const b of list ?? []) {
      if (b.mint !== mint || !b.owner) continue;
      out.set(b.owner, (out.get(b.owner) ?? 0) + sign * Number(b.uiTokenAmount.uiAmountString ?? 0));
    }
  };
  add(tx.meta?.preTokenBalances, -1);
  add(tx.meta?.postTokenBalances, 1);
  return out;
}

export const signerOf = (tx: ParsedTx): string | null => tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey ?? null;
/** How much SOL the pool gained (or lost, when negative) in a transaction. */
export const poolSol = (tx: ParsedTx, pool: string): number => deltas(tx, WSOL).get(pool) ?? 0;

/**
 * What a trade on the pool was. A pass is one wallet's bag landing in another wallet inside a single transaction while
 * the pool ends where it started: a sell and a buy of the same tokens, signed together. An ordinary trade moves tokens
 * between one wallet and the pool, so it has no second wallet on the other side.
 */
export function kindOf(tx: ParsedTx, pool: string, mint: string): "pass" | "buy" | "sell" | "other" {
  const d = deltas(tx, mint);
  const poolDelta = d.get(pool) ?? 0;
  let gave = 0;
  let got = 0;
  for (const [owner, v] of d) {
    if (owner === pool) continue;
    if (v < gave) gave = v;
    if (v > got) got = v;
  }
  if (gave < 0 && got >= -gave * 0.9 && Math.abs(poolDelta) <= -gave * 0.05) return "pass";
  if (poolDelta < 0) return "buy";
  if (poolDelta > 0) return "sell";
  return "other";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc<T>(fetchFn: Fetch, url: string, method: string, params: unknown[]): Promise<T> {
  let last: Error = new Error("no answer");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`${method} ${r.status}`);
      const body = (await r.json()) as { result?: T; error?: { message?: string } };
      if (body.error) throw new Error(`${method}: ${body.error.message ?? "refused"}`);
      return body.result as T;
    } catch (error) {
      last = error as Error;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw last;
}

/** GeckoTerminal's PumpSwap pools by 24-hour volume, SOL pairs only: three pages, sixty pools. */
export async function listTop(fetchFn: Fetch = fetch): Promise<PoolRow[]> {
  const rows: PoolRow[] = [];
  for (const page of [1, 2, 3]) {
    if (page > 1) await sleep(2_500);
    let r = await fetchFn(`${LIST}${page}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    // The list allows a few calls a minute: one refusal is waited out, a second one ends the round.
    if (r.status === 429) (await sleep(20_000), (r = await fetchFn(`${LIST}${page}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) })));
    if (!r.ok) throw new Error(`pool list ${r.status}`);
    const body = (await r.json()) as { data?: Array<{ attributes: Record<string, any>; relationships: Record<string, { data: { id: string } }> }> };
    for (const p of body.data ?? []) {
      const a = p.attributes;
      if (p.relationships.quote_token?.data.id !== `solana_${WSOL}`) continue;
      const day = a.transactions?.h24 ?? {};
      rows.push({
        pool: String(a.address),
        mint: String(p.relationships.base_token?.data.id ?? "").replace(/^solana_/, ""),
        symbol: String(a.name ?? "").split(" / ")[0] ?? "",
        createdAt: Date.parse(a.pool_created_at) || 0,
        volumeUsd: Number(a.volume_usd?.h24) || 0,
        fdvUsd: a.fdv_usd ? Number(a.fdv_usd) : null,
        buyers: Number(day.buyers) || 0,
        sellers: Number(day.sellers) || 0,
        trades: (Number(day.buys) || 0) + (Number(day.sells) || 0),
      });
    }
  }
  return rows.sort((a, b) => b.volumeUsd - a.volumeUsd);
}

/** The newest transactions on the pool that show its opener taking the SOL out. */
async function takenBy(fetchFn: Fetch, url: string, pool: string, creator: string, solIn: number, newest: Sig[]): Promise<PoolRead["taken"]> {
  for (const s of newest.filter((x) => !x.err).slice(0, 25)) {
    const tx = await rpc<ParsedTx | null>(fetchFn, url, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
    await sleep(120);
    if (!tx || signerOf(tx) !== creator) continue;
    const out = -poolSol(tx, pool);
    if (out >= Math.max(5, solIn * 0.5)) return { sol: out, at: (tx.blockTime ?? s.blockTime ?? 0) * 1000 };
  }
  return null;
}

/** One pool read end to end: its first transaction, a random draw of its trades, and its last ones. Null when the pool is too long to page. */
export async function readPool(row: PoolRow, fetchFn: Fetch = fetch, url: string = DEFAULT_RPC, now: number = Date.now()): Promise<PoolRead | null> {
  const sigs: Sig[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const got = await rpc<Sig[]>(fetchFn, url, "getSignaturesForAddress", [row.pool, { limit: PAGE, ...(before ? { before } : {}) }]);
    sigs.push(...got);
    if (got.length < PAGE) break;
    before = got[got.length - 1]!.signature;
    if (page === MAX_PAGES - 1) return null;
    await sleep(80);
  }
  const ok = sigs.filter((s) => !s.err);
  if (ok.length < 3) return null;
  const get = (s: Sig) => rpc<ParsedTx | null>(fetchFn, url, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
  const first = await get(ok[ok.length - 1]!);
  const creator = first ? signerOf(first) : null;
  if (!first || !creator) return null;
  const solIn = poolSol(first, row.pool);
  if (solIn <= 0) return null;
  // The draw leaves out the opening block and the closing transactions: they are read on their own.
  const body = ok.slice(5, -5);
  const picked = new Set<number>();
  while (picked.size < Math.min(SAMPLE, body.length)) picked.add(Math.floor(Math.random() * body.length));
  let n = 0;
  let passes = 0;
  for (const i of picked) {
    const tx = await get(body[i]!).catch(() => null);
    await sleep(120);
    if (!tx) continue;
    n++;
    if (kindOf(tx, row.pool, row.mint) === "pass") passes++;
  }
  const taken = await takenBy(fetchFn, url, row.pool, creator, solIn, sigs);
  return { creator, solIn, openedAt: (first.blockTime ?? 0) * 1000, trades: ok.length, lastAt: (ok[0]!.blockTime ?? 0) * 1000, sample: { n, passes }, taken, readAt: now };
}

/** The pools the node has read, kept on disk and refreshed while they stay on the list. */
export class PoolBook {
  private readonly entries = new Map<string, PoolEntry>();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  builtAt = 0;
  private readonly file: string | null;
  private readonly log: (m: string) => void;
  private readonly fetchFn: Fetch;
  private readonly url: string;

  constructor(file: string | null = null, log: (m: string) => void = () => {}, fetchFn: Fetch = fetch, url: string = process.env.POOLS_RPC_URL || process.env.SOLANA_RPC_URL || DEFAULT_RPC) {
    this.file = file;
    this.log = log;
    this.fetchFn = fetchFn;
    this.url = url;
    if (file && existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8")) as { builtAt?: number; entries?: PoolEntry[] };
        for (const e of saved.entries ?? []) this.entries.set(e.row.pool, e);
        this.builtAt = saved.builtAt ?? 0;
      } catch (error) {
        log(`pools not restored: ${(error as Error).message}`);
      }
    }
  }

  start(): void {
    if (this.timer) return;
    void this.pass();
    this.timer = setInterval(() => void this.pass(), EVERY_MS);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round: the list again, then the pools not read yet, then a look at whether the open ones were closed. */
  async pass(now: number = Date.now()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // A round the list refused still reads the pools the last list named.
      let current = Math.max(0, ...[...this.entries.values()].map((e) => e.seenAt));
      try {
        const rows = await listTop(this.fetchFn);
        for (const row of rows) this.entries.set(row.pool, { row, read: this.entries.get(row.pool)?.read ?? null, seenAt: now });
        if (rows.length) current = now;
      } catch (error) {
        this.log(`pool list not read: ${(error as Error).message}`);
      }
      for (const [pool, e] of this.entries) if (now - e.seenAt > READ_WINDOW_MS) this.entries.delete(pool);
      let reads = 0;
      for (const e of [...this.entries.values()].sort((a, b) => b.row.volumeUsd - a.row.volumeUsd)) {
        if (e.seenAt !== current || now - e.row.createdAt > READ_WINDOW_MS) continue;
        try {
          if (!e.read) {
            if (reads >= READS_PER_PASS) continue;
            reads++;
            e.read = await readPool(e.row, this.fetchFn, this.url, now);
          } else if (!e.read.taken) {
            const newest = await rpc<Sig[]>(this.fetchFn, this.url, "getSignaturesForAddress", [e.row.pool, { limit: 60 }]);
            const landed = newest.find((s) => !s.err);
            if (landed?.blockTime) e.read.lastAt = Math.max(e.read.lastAt, landed.blockTime * 1000);
            const taken = await takenBy(this.fetchFn, this.url, e.row.pool, e.read.creator, e.read.solIn, newest);
            // A closed pool is read once more in full, so its trade count and its draw cover its whole life.
            if (taken) e.read = (await readPool(e.row, this.fetchFn, this.url, now)) ?? { ...e.read, taken };
          }
        } catch (error) {
          this.log(`pool ${e.row.pool} not read: ${(error as Error).message}`);
        }
        this.save();
      }
      if (current) this.builtAt = now;
      this.save();
    } catch (error) {
      this.log(`pools pass failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ builtAt: this.builtAt, entries: [...this.entries.values()] }));
      renameSync(tmp, this.file);
    } catch (error) {
      this.log(`pools not saved: ${(error as Error).message}`);
    }
  }

  /** What the node read about the pool this token trades in, if it is one of the listed ones. */
  ofMint(mint: string): PoolEntry | null {
    let best: PoolEntry | null = null;
    for (const e of this.entries.values()) if (e.row.mint === mint && (!best || e.row.volumeUsd > best.row.volumeUsd)) best = e;
    return best;
  }

  /** The list as it is served: newest list order, each read pool with what its opener did across the other pools here. */
  view(now: number = Date.now()) {
    const all = [...this.entries.values()];
    const latest = Math.max(0, ...all.map((e) => e.seenAt));
    const listed = all.filter((e) => e.seenAt === latest).sort((a, b) => b.row.volumeUsd - a.row.volumeUsd);
    const byCreator = new Map<string, { pools: number; taken: number; solIn: number; solOut: number }>();
    for (const e of all) {
      if (!e.read) continue;
      const c = byCreator.get(e.read.creator) ?? { pools: 0, taken: 0, solIn: 0, solOut: 0 };
      c.pools++;
      if (e.read.taken) {
        c.taken++;
        c.solIn += e.read.solIn;
        c.solOut += e.read.taken.sol;
      }
      byCreator.set(e.read.creator, c);
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    const pools = listed.map((e) => {
      const r = e.read;
      const life = r ? Math.max(1, ((r.taken?.at ?? r.lastAt) - r.openedAt) / 1000) : 0;
      return {
        ...e.row,
        launchpad: e.row.mint.endsWith("pump") ? "pump.fun" : null,
        read: r
          ? {
              creator: r.creator,
              solIn: round(r.solIn),
              openedAt: r.openedAt,
              lastAt: r.lastAt,
              trades: r.trades,
              perSecond: round(r.trades / life),
              sample: r.sample,
              taken: r.taken ? { sol: round(r.taken.sol), at: r.taken.at } : null,
              creatorPools: byCreator.get(r.creator)?.pools ?? 1,
              creatorTaken: byCreator.get(r.creator)?.taken ?? 0,
              readAt: r.readAt,
            }
          : null,
      };
    });
    const read = pools.filter((p) => p.read);
    const closed = read.filter((p) => p.read!.taken);
    return {
      builtAt: this.builtAt || null,
      source: "PumpSwap pools by 24-hour volume as GeckoTerminal lists them; opener, SOL in and out, and the trade draw are read from each pool's own transactions",
      note: `Pools opened in the last ${READ_WINDOW_MS / 3_600_000} hours are read from the chain. A pass is a trade where one wallet's bag lands in another wallet inside one transaction and the pool ends where it started. The draw is ${SAMPLE} trades at random. This shows wallets and transfers, and says nothing about who owns a wallet.`,
      totals: {
        listed: pools.length,
        volumeUsd: Math.round(pools.reduce((s, p) => s + p.volumeUsd, 0)),
        newPools: pools.filter((p) => now - p.createdAt <= READ_WINDOW_MS).length,
        read: read.length,
        closed: closed.length,
        solIn: round(closed.reduce((s, p) => s + p.read!.solIn, 0)),
        solOut: round(closed.reduce((s, p) => s + p.read!.taken!.sol, 0)),
      },
      pools,
    };
  }
}
