import { fromRpc, parseLaunchpads, RAYDIUM_AMM_PROGRAM, RAYDIUM_CPMM_PROGRAM, type RpcTx } from "./launchpads.ts";
import { firstSeen, readPoolMeta } from "./poolMeta.ts";
import { fromBase58, type PumpEvent, type Venue } from "./pumpParse.ts";
import type { PumpTape } from "./pump.ts";

/**
 * A coin asked about that launched before the stream watched: found and read from the chain on demand, then kept on
 * the tape and followed live like a launch the stream saw. Its main pool (DexScreener's pairs, checked against the
 * pool account's owner, or the Raydium programs' accounts by mint), the pool's opening transaction (creator, when),
 * the mint's own birth when its history is short, name, symbol and supply, and the pool's most recent swaps.
 *
 * One coin at a time, a short queue, and a miss is not asked again for ten minutes: a burst of x-rays for coins
 * nobody launched on Raydium cannot run the RPC dry. Raydium AMM v4 and CPMM only, the pools the stream can follow.
 */

type Rpc = <T>(method: string, params: unknown[]) => Promise<T | null>;

const WSOL = "So11111111111111111111111111111111111111112";

export type AdoptState =
  | { state: "tracked" }
  | { state: "reading"; etaSec: number }
  | { state: "missed"; reason: string }
  | { state: "busy" };

export interface AdoptOptions {
  rpc: Rpc;
  fetchFn?: typeof fetch;
  /** Most recent pool transactions read back for buyers, sells and price. */
  backfill?: number;
  /** Pages of 1,000 signatures walked back to the pool's opening; a busier pool keeps its opening unknown. */
  pages?: number;
  /** Gap between transaction reads. */
  gapMs?: number;
  missMs?: number;
  /** Coins waiting behind the one being read; more are told to come back. */
  maxQueue?: number;
  log?: (m: string) => void;
}

type Pair = { chainId?: string; dexId?: string; pairAddress?: string; pairCreatedAt?: number; baseToken?: { address?: string }; quoteToken?: { address?: string }; liquidity?: { usd?: number } };
type Sig = { signature: string; blockTime?: number | null; err?: unknown; slot?: number };
type Tx = RpcTx & { slot?: number; blockTime?: number | null; meta: RpcTx["meta"] & { err?: unknown } };

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** The pool's program says what it is: AMM v4 or CPMM, or neither. */
async function venueOfPool(pool: string, rpc: Rpc): Promise<Venue | null> {
  const a = await rpc<{ value?: { owner?: string } | null }>("getAccountInfo", [pool, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]).catch(() => null);
  const owner = a?.value?.owner;
  return owner === RAYDIUM_AMM_PROGRAM ? "raydium" : owner === RAYDIUM_CPMM_PROGRAM ? "cpmm" : null;
}

/** The coin's deepest SOL pool on Raydium AMM v4 or CPMM, or null. */
export async function findPool(mint: string, rpc: Rpc, fetchFn: typeof fetch = fetch): Promise<{ pool: string; venue: Venue; listedAt: number | null } | null> {
  try {
    const r = await fetchFn(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(6_000) });
    const pairs = r.ok ? ((await r.json()) as Pair[]) : [];
    const sol = (Array.isArray(pairs) ? pairs : [])
      .filter((p) => p.dexId === "raydium" && p.pairAddress && (p.quoteToken?.address === WSOL || p.baseToken?.address === WSOL))
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    for (const p of sol.slice(0, 3)) {
      const venue = await venueOfPool(p.pairAddress!, rpc);
      if (venue) return { pool: p.pairAddress!, venue, listedAt: p.pairCreatedAt ?? null };
    }
  } catch {
    /* the programs' accounts next */
  }
  // Without DexScreener: the pool accounts that hold this mint, AMM v4 (coin mint at 400, pc at 432) and CPMM (token 0 at 168, 1 at 200).
  const scans: Array<[string, Venue, number, number]> = [
    [RAYDIUM_CPMM_PROGRAM, "cpmm", 168, 200],
    [RAYDIUM_AMM_PROGRAM, "raydium", 400, 432],
  ];
  for (const [program, venue, a, b] of scans) {
    for (const [mine, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const found = await rpc<Array<{ pubkey: string }>>("getProgramAccounts", [program, { encoding: "base64", dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: { offset: mine, bytes: mint } }, { memcmp: { offset: other, bytes: WSOL } }] }]).catch(() => null);
      if (found?.[0]?.pubkey) return { pool: found[0].pubkey, venue, listedAt: null };
    }
  }
  return null;
}

export class Adopter {
  private readonly rpc: Rpc;
  private readonly fetchFn: typeof fetch;
  private readonly tape: PumpTape;
  private readonly backfillN: number;
  private readonly pages: number;
  private readonly gapMs: number;
  private readonly missMs: number;
  private readonly maxQueue: number;
  private readonly log: (m: string) => void;
  private readonly queue: string[] = [];
  private readonly missed = new Map<string, { at: number; reason: string }>();
  private current: { mint: string; startedAt: number } | null = null;
  private readonly waiters = new Map<string, Array<() => void>>();
  /** Seconds one coin takes, as the last ones took; a first guess before any. */
  private took = 20;

  constructor(tape: PumpTape, o: AdoptOptions) {
    this.tape = tape;
    this.rpc = o.rpc;
    this.fetchFn = o.fetchFn ?? fetch;
    this.backfillN = o.backfill ?? 120;
    this.pages = o.pages ?? 8;
    this.gapMs = o.gapMs ?? 120;
    this.missMs = o.missMs ?? 10 * 60_000;
    this.maxQueue = o.maxQueue ?? 3;
    this.log = o.log ?? (() => {});
  }

  /** Where this coin stands, without starting anything. */
  state(mint: string, now = Date.now()): AdoptState | null {
    if (this.tape.has(mint) && this.current?.mint !== mint) return { state: "tracked" };
    if (this.current?.mint === mint) return { state: "reading", etaSec: Math.max(2, Math.round(this.took - (now - this.current.startedAt) / 1000)) };
    const at = this.queue.indexOf(mint);
    if (at >= 0) {
      const left = this.current ? Math.max(2, this.took - (now - this.current.startedAt) / 1000) : 0;
      return { state: "reading", etaSec: Math.round(left + this.took * (at + 1)) };
    }
    const miss = this.missed.get(mint);
    if (miss && now - miss.at < this.missMs) return { state: "missed", reason: miss.reason };
    return null;
  }

  /** Asks for the coin to be read; says where it stands. */
  request(mint: string, now = Date.now()): AdoptState {
    const s = this.state(mint, now);
    if (s) return s;
    if (this.queue.length >= this.maxQueue) return { state: "busy" };
    this.queue.push(mint);
    if (!this.current) void this.run();
    return this.state(mint, now) ?? { state: "busy" };
  }

  /** Asks, then waits up to `ms` for the answer. */
  async ensure(mint: string, ms: number): Promise<AdoptState> {
    const first = this.request(mint);
    if (first.state !== "reading" || ms <= 0) return first;
    await Promise.race([new Promise<void>((r) => this.waiters.set(mint, [...(this.waiters.get(mint) ?? []), r])), sleep(ms)]);
    return this.state(mint) ?? { state: "busy" };
  }

  private async run(): Promise<void> {
    while (this.queue.length) {
      const mint = this.queue.shift()!;
      const startedAt = Date.now();
      this.current = { mint, startedAt };
      try {
        const reason = await this.read(mint);
        if (reason) this.missed.set(mint, { at: Date.now(), reason });
        else this.took = Math.max(3, Math.min(60, Math.round((this.took + (Date.now() - startedAt) / 1000) / 2)));
        this.log(`adopt ${mint}: ${reason ?? "tracked"} in ${Math.round((Date.now() - startedAt) / 1000)} s`);
      } catch (e) {
        this.missed.set(mint, { at: Date.now(), reason: "the chain read failed" });
        this.log(`adopt ${mint}: failed ${(e as Error).message}`);
      }
      if (this.missed.size > 5_000) this.missed.clear();
      this.current = null;
      for (const w of this.waiters.get(mint) ?? []) w();
      this.waiters.delete(mint);
    }
  }

  /** Reads one coin onto the tape; the reason it could not, or null. */
  private async read(mint: string): Promise<string | null> {
    const found = await findPool(mint, this.rpc, this.fetchFn);
    if (!found) return "no Raydium pool against SOL";
    const { pool, venue } = found;
    // The pool's signatures, newest first: the first page is the recent trades, the last page its opening.
    let newest: Sig[] = [];
    let oldest: Sig | null = null;
    let before: string | undefined;
    for (let i = 0; i < this.pages; i++) {
      const sigs = await this.rpc<Sig[]>("getSignaturesForAddress", [pool, { limit: 1000, ...(before ? { before } : {}) }]);
      if (!Array.isArray(sigs) || !sigs.length) break;
      if (!i) newest = sigs;
      if (sigs.length < 1000) {
        oldest = sigs[sigs.length - 1]!;
        break;
      }
      before = sigs[sigs.length - 1]!.signature;
    }
    if (!newest.length) return "the pool's history could not be read";
    const getTx = (sig: string) => this.rpc<Tx>("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    let creator = "";
    let openedAt: number | null = found.listedAt;
    if (oldest) {
      const tx = await getTx(oldest.signature);
      if (tx) {
        const ts = (tx.blockTime ?? oldest.blockTime ?? 0) * 1000;
        const open = parseLaunchpads(fromRpc(tx, fromBase58), ts).find((e) => e.kind === "create" && e.mint === mint);
        creator = open?.kind === "create" ? open.creator : (tx.transaction.message.accountKeys[0] ?? "");
        if (ts) openedAt = ts;
      }
    }
    openedAt ??= (newest[newest.length - 1]?.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;
    const meta = await readPoolMeta(mint, this.rpc);
    const born = await firstSeen(mint, this.rpc, 2);
    // From here on the stream follows it; the trades before now are read back after, so none falls in between.
    if (!this.tape.adoptToken({ mint, venue, pool, creator, createdAt: openedAt, mintCreatedAt: born?.at ?? null, ...meta })) return null;
    const trades: Array<{ ev: PumpEvent; tx?: string; slot?: number }> = [];
    for (const s of newest.filter((x) => !x.err).slice(0, this.backfillN)) {
      await sleep(this.gapMs);
      const tx = await getTx(s.signature).catch(() => null);
      if (!tx || tx.meta?.err) continue;
      const ts = (tx.blockTime ?? s.blockTime ?? 0) * 1000;
      for (const ev of parseLaunchpads(fromRpc(tx, fromBase58), ts)) if (ev.kind === "trade" && ev.mint === mint && ev.venue === venue) trades.push({ ev, tx: s.signature, ...(tx.slot ?? s.slot ? { slot: tx.slot ?? s.slot } : {}) });
    }
    this.tape.backfill(mint, trades);
    return null;
  }
}

/** The node's one adopter, set on the node that reads the chain. */
export const adoption: { current: Adopter | null } = { current: null };
