import { DBC_PROGRAM, fromRpc, LAUNCHLAB_PROGRAM, parseLaunchpads, RAYDIUM_AMM_PROGRAM, RAYDIUM_CPMM_PROGRAM, type RpcTx } from "./launchpads.ts";
import { firstSeen, programAddress, readPoolMeta } from "./poolMeta.ts";
import { fromBase58, parsePumpLogs, PUMP_AMM_PROGRAM, PUMP_PROGRAM, type PumpEvent, type Venue } from "./pumpParse.ts";
import type { DexRead, PumpTape } from "./pump.ts";

/**
 * A coin asked about that launched before the stream watched: found and read from the chain on demand, then kept on
 * the tape and followed live like a launch the stream saw. Its main pool (DexScreener's pairs, checked against the
 * pool account's owner, or the Raydium programs' accounts by mint), the pool's opening transaction (creator, when),
 * the mint's own birth when its history is short, name, symbol and supply, and the pool's most recent swaps.
 *
 * One coin at a time, a short queue, and a miss is not asked again for ten minutes: a burst of x-rays for coins
 * nobody launched cannot run the RPC dry. Raydium AMM v4 and CPMM, PumpSwap, and the pump.fun, LaunchLab and Meteora
 * curves: what the stream reads. Meteora's DAMM pools (where its curve graduates) are not read.
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
  /** First wait of the 429 backoff (then doubled), and the wait before a failed read-back is tried again. */
  backoffMs?: number;
  retryMs?: number;
  retries?: number;
  /** Coins waiting behind the one being read; more are told to come back. */
  maxQueue?: number;
  log?: (m: string) => void;
}

type Pair = { chainId?: string; dexId?: string; pairAddress?: string; pairCreatedAt?: number; priceUsd?: string; marketCap?: number; fdv?: number; baseToken?: { address?: string }; quoteToken?: { address?: string }; liquidity?: { usd?: number; base?: number; quote?: number }; txns?: { h24?: { buys?: number; sells?: number } } };

/** DexScreener's numbers for a pool: price, cap, the SOL side of its liquidity, the day's buys and sells. */
export function dexReadOf(p: Pair, now = Date.now()): DexRead {
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x && Number.isFinite(Number(x)) ? Number(x) : null);
  return {
    priceUsd: num(p.priceUsd),
    mcapUsd: num(p.marketCap ?? p.fdv),
    liquidityUsd: num(p.liquidity?.usd),
    poolSol: num(p.quoteToken?.address === WSOL ? p.liquidity?.quote : p.liquidity?.base),
    buys24h: num(p.txns?.h24?.buys),
    sells24h: num(p.txns?.h24?.sells),
    at: now,
  };
}

/**
 * An RPC call that the public endpoint may refuse with 429 (rpcRead then answers null): tried again after 1, 2, 4
 * and 8 seconds before giving up. `baseMs` 0 in tests.
 */
export async function patient<T>(call: () => Promise<T | null>, baseMs = 1_000, tries = 5): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const r = await call().catch(() => null);
    if (r !== null && r !== undefined) return r;
    if (i < tries - 1) await sleep(baseMs * 2 ** i);
  }
  return null;
}
type Sig = { signature: string; blockTime?: number | null; err?: unknown; slot?: number };
type Tx = RpcTx & { slot?: number; blockTime?: number | null; meta: RpcTx["meta"] & { err?: unknown; logMessages?: string[] | null } };

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());


/** Where a coin trades, as the adopter reads it: a Raydium pool, a PumpSwap pool, or a launchpad's curve. */
export interface Where {
  kind: "raydium" | "pumpswap" | "curve";
  /** Undefined is pump.fun (its curve, or PumpSwap after graduation). */
  venue?: Venue;
  /** The pool or curve account: its signatures are the coin's trades. */
  pool: string;
  listedAt: number | null;
  dex?: DexRead;
}

/** Which program owns an account, and so what it is. */
const OWNERS: Record<string, Pick<Where, "kind" | "venue">> = {
  [RAYDIUM_AMM_PROGRAM]: { kind: "raydium", venue: "raydium" },
  [RAYDIUM_CPMM_PROGRAM]: { kind: "raydium", venue: "cpmm" },
  [PUMP_AMM_PROGRAM]: { kind: "pumpswap" },
  [PUMP_PROGRAM]: { kind: "curve" },
  [LAUNCHLAB_PROGRAM]: { kind: "curve", venue: "launchlab" },
  [DBC_PROGRAM]: { kind: "curve", venue: "dbc" },
};

async function ownerOf(address: string, rpc: Rpc): Promise<{ owner: string; size: number } | null> {
  const a = await rpc<{ value?: { owner?: string; space?: number; data?: [string, string] } | null }>("getAccountInfo", [address, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]).catch(() => null);
  return a?.value?.owner ? { owner: a.value.owner, size: a.value.space ?? 0 } : null;
}

/** pump.fun's bonding curve account for a mint. */
export const bondingCurveOf = (mint: string) => programAddress([Buffer.from("bonding-curve"), fromBase58(mint)], PUMP_PROGRAM);

/**
 * Where the coin trades now: the deepest pair DexScreener lists whose account one of the programs we read owns
 * (Raydium AMM v4 and CPMM, PumpSwap, pump.fun's curve, LaunchLab, Meteora's curve). Raydium only against SOL, as its
 * reader counts the SOL vault. Without DexScreener: pump.fun's curve account, then the Raydium pools by mint.
 */
export async function findPool(mint: string, rpc: Rpc, fetchFn: typeof fetch = fetch): Promise<Where | null> {
  try {
    const r = await fetchFn(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(6_000) });
    const pairs = r.ok ? ((await r.json()) as Pair[]) : [];
    const listed = (Array.isArray(pairs) ? pairs : []).filter((p) => p.pairAddress).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    for (const p of listed.slice(0, 4)) {
      const o = await ownerOf(p.pairAddress!, rpc);
      const what = o ? OWNERS[o.owner] : undefined;
      if (!what) continue;
      const sol = p.quoteToken?.address === WSOL || p.baseToken?.address === WSOL;
      if (what.kind === "raydium" && !sol) continue;
      return { ...what, pool: p.pairAddress!, listedAt: p.pairCreatedAt ?? null, dex: dexReadOf(p) };
    }
  } catch {
    /* read the chain instead */
  }
  const curve = bondingCurveOf(mint);
  const o = await ownerOf(curve, rpc);
  if (o?.owner === PUMP_PROGRAM) return { kind: "curve", pool: curve, listedAt: null };
  // The pool accounts that hold this mint, AMM v4 (coin mint at 400, pc at 432) and CPMM (token 0 at 168, 1 at 200).
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
      if (found?.[0]?.pubkey) return { kind: "raydium", venue, pool: found[0].pubkey, listedAt: null };
    }
  }
  return null;
}

/** The events of one transaction as the stream would read them: pump.fun and PumpSwap from their logs, the rest whole. */
function eventsOf(w: Pick<Where, "kind" | "venue">, tx: Tx, ts: number): PumpEvent[] {
  const fromLogs = w.kind === "pumpswap" || (w.kind === "curve" && !w.venue);
  if (fromLogs) return parsePumpLogs(tx.meta?.logMessages ?? []).map((e) => (e.kind === "trade" || e.kind === "swap" ? { ...e, ts: e.ts || ts } : e));
  return parseLaunchpads(fromRpc(tx, fromBase58), ts);
}

/** Whether an event is one of this coin's trades where it trades now. */
function isTrade(w: Where, mint: string, ev: PumpEvent): boolean {
  if (w.kind === "pumpswap") return ev.kind === "swap" && ev.pool === w.pool;
  if (ev.kind !== "trade" || ev.mint !== mint) return false;
  return w.kind === "raydium" ? ev.venue === w.venue : true;
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
  private readonly backoffMs: number;
  private readonly retryMs: number;
  private readonly retries: number;
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
    this.pages = o.pages ?? 32;
    this.gapMs = o.gapMs ?? 250;
    this.missMs = o.missMs ?? 10 * 60_000;
    this.maxQueue = o.maxQueue ?? 3;
    this.backoffMs = o.backoffMs ?? 1_000;
    this.retryMs = o.retryMs ?? 60_000;
    this.retries = o.retries ?? 3;
    this.log = o.log ?? (() => {});
  }

  /** After a restart: tries again to read the past trades of adopted coins that came back partial. */
  async resume(): Promise<void> {
    for (const c of this.tape.unreadAdopted()) await this.readBack(c.mint, { kind: c.kind, ...(c.venue ? { venue: c.venue } : {}), pool: c.pool, listedAt: null }, null, null, 0).catch(() => {});
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
    const w = await findPool(mint, this.rpc, this.fetchFn);
    if (!w) return "no pool or curve we can read";
    const opening = await this.walk(w.pool);
    let creator = "";
    let openedAt: number | null = w.listedAt;
    let made: Extract<PumpEvent, { kind: "create" }> | null = null;
    // A PumpSwap pool opens at graduation: the launch itself is on pump.fun's curve, read from there when reachable.
    const first = w.kind === "pumpswap" ? ((await this.walk(bondingCurveOf(mint))).oldest ?? opening.oldest) : opening.oldest;
    if (first) {
      const tx = await patient(() => this.getTx(first.signature), this.backoffMs);
      if (tx) {
        const ts = (tx.blockTime ?? first.blockTime ?? 0) * 1000;
        const lineOf: Where = w.kind === "pumpswap" && first !== opening.oldest ? { ...w, kind: "curve" } : w;
        const open = eventsOf(lineOf, tx, ts).find((e) => e.kind === "create" && e.mint === mint);
        if (open?.kind === "create") made = open;
        creator = made ? made.creator : (tx.transaction.message.accountKeys[0] ?? "");
        if (made?.ts) openedAt = made.ts;
        else if (ts) openedAt = ts;
      }
    }
    openedAt ??= (opening.newest[opening.newest.length - 1]?.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;
    const meta = await readPoolMeta(mint, (m, p) => patient(() => this.rpc(m, p), this.backoffMs));
    const born = await firstSeen(mint, (m, p) => patient(() => this.rpc(m, p), this.backoffMs), 2);
    const named = { ...(made?.name ? { name: made.name } : {}), ...(made?.symbol ? { symbol: made.symbol } : {}), ...meta };
    // From here on the stream follows it; the trades before now are read back after, so none falls in between.
    const adopted = this.tape.adoptToken({
      mint,
      kind: w.kind,
      ...(w.venue ? { venue: w.venue } : {}),
      pool: w.pool,
      creator,
      createdAt: openedAt,
      mintCreatedAt: born?.at ?? null,
      ...(made?.quote ? { quote: made.quote } : {}),
      ...(made?.platform ? { platform: made.platform } : {}),
      ...(made?.mayhem ? { mayhem: true } : {}),
      ...(made?.supply && !meta.supply ? { supply: made.supply } : {}),
      ...named,
    });
    if (!adopted) return null;
    await this.readBack(mint, w, opening.newest.length ? opening.newest : null, w.dex ?? null, 0);
    return null;
  }

  /** An account's signatures, newest first, in pages of 250: the first page is its recent trades, the last its opening. */
  private async walk(address: string): Promise<{ newest: Sig[]; oldest: Sig | null }> {
    let newest: Sig[] = [];
    let oldest: Sig | null = null;
    let before: string | undefined;
    for (let i = 0; i < this.pages; i++) {
      if (i) await sleep(this.gapMs);
      const page = await patient(() => this.rpc<Sig[]>("getSignaturesForAddress", [address, { limit: PAGE, ...(before ? { before } : {}) }]), this.backoffMs);
      if (!Array.isArray(page) || !page.length) break;
      if (!i) newest = page;
      if (page.length < PAGE) {
        oldest = page[page.length - 1]!;
        break;
      }
      before = page[page.length - 1]!.signature;
    }
    return { newest, oldest };
  }

  private getTx(sig: string): Promise<Tx | null> {
    return this.rpc<Tx>("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  }

  /**
   * The latest trades read back onto the tape. When the signatures or none of the transactions can be read, the coin
   * is marked partial with DexScreener's numbers, and the read is tried again in the background, a few times.
   */
  private async readBack(mint: string, w: Where, page: Sig[] | null, dex: DexRead | null, attempt: number): Promise<void> {
    page ??= await patient(() => this.rpc<Sig[]>("getSignaturesForAddress", [w.pool, { limit: PAGE }]), this.backoffMs);
    const wanted = Array.isArray(page) ? page.filter((x) => !x.err).slice(0, this.backfillN) : null;
    const trades: Array<{ ev: PumpEvent; tx?: string; slot?: number }> = [];
    let read = 0;
    for (const s of wanted ?? []) {
      await sleep(this.gapMs);
      const tx = await patient(() => this.getTx(s.signature), this.backoffMs, 3);
      if (!tx) continue;
      read += 1;
      if (tx.meta?.err) continue;
      const ts = (tx.blockTime ?? s.blockTime ?? 0) * 1000;
      for (const ev of eventsOf(w, tx, ts)) if (isTrade(w, mint, ev)) trades.push({ ev, tx: s.signature, ...(tx.slot ?? s.slot ? { slot: tx.slot ?? s.slot } : {}) });
    }
    const ok = wanted !== null && (wanted.length === 0 || read > 0);
    const n = ok ? this.tape.backfill(mint, trades) : 0;
    if (!ok && !dex) dex = await this.dexOf(mint, w.pool);
    this.tape.noteBackfill(mint, { ok, read: n, dex: ok ? null : dex });
    this.log(`adopt ${mint}: read back ${n} trades${ok ? "" : ", not read, partial"}`);
    if (!ok && attempt < this.retries && this.tape.has(mint)) {
      const timer = setTimeout(() => void this.readBack(mint, w, null, null, attempt + 1).catch(() => {}), this.retryMs);
      timer.unref?.();
    }
  }

  private async dexOf(mint: string, pool: string): Promise<DexRead | null> {
    try {
      const r = await this.fetchFn(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(6_000) });
      const pairs = r.ok ? ((await r.json()) as Pair[]) : [];
      const p = Array.isArray(pairs) ? pairs.find((x) => x.pairAddress === pool) : undefined;
      return p ? dexReadOf(p) : null;
    } catch {
      return null;
    }
  }
}

/** Signatures asked per page: small, so a refused page costs little. */
const PAGE = 250;

/** The node's one adopter, set on the node that reads the chain. */
export const adoption: { current: Adopter | null } = { current: null };
