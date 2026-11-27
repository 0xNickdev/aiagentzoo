import { DAMM_V2_PROGRAM, DBC_POOL_AUTHORITY, DBC_PROGRAM, fromRpc, LAUNCHLAB_PROGRAM, parseLaunchpads, RAYDIUM_AMM_PROGRAM, RAYDIUM_CPMM_PROGRAM, type RpcTx } from "./launchpads.ts";
import { firstSeen, programAddress, readPoolMeta } from "./poolMeta.ts";
import { base58, fromBase58, parsePumpLogs, PUMP_AMM_PROGRAM, PUMP_PROGRAM, type PumpEvent, type Venue } from "./pumpParse.ts";
import type { DexRead, PumpTape } from "./pump.ts";

/**
 * A coin asked about that launched before the stream watched: found and read from the chain on demand, then kept on
 * the tape and followed live like a launch the stream saw. Its main pool (DexScreener's pairs, checked against the
 * pool account's owner, or the Raydium programs' accounts by mint), the pool's opening transaction (creator, when),
 * the mint's own birth when its history is short, name, symbol and supply, and the pool's most recent swaps.
 *
 * One coin at a time, a short queue, and a miss is not asked again for ten minutes: a burst of x-rays for coins
 * nobody launched cannot run the RPC dry. Raydium AMM v4 and CPMM, PumpSwap, Meteora's DAMM v2, and the pump.fun,
 * LaunchLab and Meteora curves: what the stream reads. A Meteora coin found in its DAMM v2 pool is adopted as Meteora's
 * coin, graduated, not as a launch into the pool.
 */

/** A coin's launch as the long memory kept it. */
export interface Known {
  creator: string;
  createdAt: number;
  name?: string;
  symbol?: string;
}

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
  /** Trades read before the card goes up, how many at once, and how long the opening is searched for. */
  firstTrades?: number;
  batch?: number;
  openingMs?: number;
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
  /** A launchpad coin trading in the pool it graduated to: the pool's own program (venue is then the launchpad's). */
  poolVenue?: Venue;
  /** That launchpad's curve account, where the launch itself is; for Meteora found from the migration when needed. */
  curve?: string;
  listedAt: number | null;
  dex?: DexRead;
}

/** Which program owns an account, and so what it is. */
const OWNERS: Record<string, Pick<Where, "kind" | "venue">> = {
  [RAYDIUM_AMM_PROGRAM]: { kind: "raydium", venue: "raydium" },
  [RAYDIUM_CPMM_PROGRAM]: { kind: "raydium", venue: "cpmm" },
  [DAMM_V2_PROGRAM]: { kind: "raydium", venue: "damm" },
  [PUMP_AMM_PROGRAM]: { kind: "pumpswap" },
  [PUMP_PROGRAM]: { kind: "curve" },
  [LAUNCHLAB_PROGRAM]: { kind: "curve", venue: "launchlab" },
  [DBC_PROGRAM]: { kind: "curve", venue: "dbc" },
};

async function ownerOf(address: string, rpc: Rpc): Promise<{ owner: string; size: number } | null> {
  const a = await rpc<{ value?: { owner?: string; space?: number; data?: [string, string] } | null }>("getAccountInfo", [address, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]).catch(() => null);
  return a?.value?.owner ? { owner: a.value.owner, size: a.value.space ?? 0 } : null;
}

/** Where a DAMM v2 pool keeps its creator (cp_amm's Pool, a fixed layout: 8-byte discriminator, then 640 bytes before it). */
const DAMM_CREATOR_AT = 648;

/**
 * Whether a pool is a launchpad coin's graduation: a DAMM v2 pool whose creator is Meteora's curve (every pool its
 * migration opens names the curve's authority).
 */
export async function graduatedFrom(mint: string, w: Where, rpc: Rpc): Promise<Pick<Where, "venue" | "poolVenue" | "curve"> | null> {
  if (w.venue === "damm") {
    const a = await rpc<{ value?: { data?: [string, string] } | null }>("getAccountInfo", [w.pool, { encoding: "base64", dataSlice: { offset: DAMM_CREATOR_AT, length: 32 } }]).catch(() => null);
    const raw = a?.value?.data?.[0] ? Buffer.from(a.value.data[0], "base64") : null;
    return raw?.length === 32 && base58(raw) === DBC_POOL_AUTHORITY ? { venue: "dbc", poolVenue: "damm" } : null;
  }
  return null;
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
      const w: Where = { ...what, pool: p.pairAddress!, listedAt: p.pairCreatedAt ?? null, dex: dexReadOf(p) };
      // A DAMM pool is read only as a Meteora coin's graduation.
      const grad = what.venue === "damm" ? await graduatedFrom(mint, w, rpc) : null;
      if (grad) return { ...w, ...grad };
      if (what.venue === "damm") continue;
      return w;
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
  // In the pool it graduated to: only that pool's trades, not the curve's or another pool's.
  if (w.poolVenue) return ev.venue === w.poolVenue && ev.pool === w.pool;
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
  private current: { mint: string; startedAt: number; stage: Stage; stageAt: number; batchesLeft: number } | null = null;
  private readonly waiters = new Map<string, Array<() => void>>();
  /** Seconds one coin takes to a usable card, as the last ones took; a first guess before any. */
  private took = 8;
  /** The slow work (the rest of the read-back, the search for the opening), one job at a time, behind the cards. */
  private readonly slow: Array<() => Promise<void>> = [];
  private slowRunning = false;
  private readonly batch: number;
  private readonly firstN: number;
  private readonly openingMs: number;

  constructor(tape: PumpTape, o: AdoptOptions) {
    this.tape = tape;
    this.rpc = o.rpc;
    this.fetchFn = o.fetchFn ?? fetch;
    this.backfillN = o.backfill ?? 200;
    this.firstN = Math.min(this.backfillN, o.firstTrades ?? 50);
    this.batch = o.batch ?? 15;
    this.pages = o.pages ?? 32;
    this.gapMs = o.gapMs ?? 100;
    this.missMs = o.missMs ?? 10 * 60_000;
    this.maxQueue = o.maxQueue ?? 3;
    this.backoffMs = o.backoffMs ?? 1_000;
    this.retryMs = o.retryMs ?? 60_000;
    this.retries = o.retries ?? 3;
    this.openingMs = o.openingMs ?? 3 * 60_000;
    this.log = o.log ?? (() => {});
  }

  /** After a restart: tries again to read the past trades of adopted coins that came back partial. */
  async resume(): Promise<void> {
    for (const c of this.tape.unreadAdopted()) await this.readBack(c.mint, { kind: c.kind, ...(c.venue ? { venue: c.venue } : {}), ...(c.poolVenue ? { poolVenue: c.poolVenue } : {}), pool: c.pool, listedAt: null }, null, null, 0).catch(() => {});
  }

  /** Where this coin stands, without starting anything. */
  state(mint: string, now = Date.now()): AdoptState | null {
    if (this.tape.has(mint) && this.current?.mint !== mint) return { state: "tracked" };
    if (this.current?.mint === mint) return { state: "reading", etaSec: this.leftOfCurrent(now) };
    const at = this.queue.indexOf(mint);
    if (at >= 0) return { state: "reading", etaSec: Math.round((this.current ? this.leftOfCurrent(now) : 0) + this.took * (at + 1)) };
    const miss = this.missed.get(mint);
    if (miss && now - miss.at < this.missMs) return { state: "missed", reason: miss.reason };
    return null;
  }

  /** Seconds the coin being read still needs, from the stage it is in: what that stage usually takes, less its time so far, plus the stages after. */
  private leftOfCurrent(now: number): number {
    const c = this.current!;
    const after = STAGES.slice(STAGES.indexOf(c.stage) + 1).reduce((n, st) => n + (st === "trades" ? STAGE_SEC.trades * Math.max(1, Math.ceil(this.firstN / this.batch)) : STAGE_SEC[st]), 0);
    const here = c.stage === "trades" ? STAGE_SEC.trades * Math.max(1, c.batchesLeft) : STAGE_SEC[c.stage];
    return Math.max(1, Math.round(Math.max(0.5, here - (now - c.stageAt) / 1000) + after));
  }

  private stage(stage: Stage, batchesLeft = 0): void {
    if (this.current) Object.assign(this.current, { stage, stageAt: Date.now(), batchesLeft });
  }

  /** Queues slow work behind the cards; one job at a time. */
  private later(job: () => Promise<void>): void {
    this.slow.push(job);
    if (this.slowRunning) return;
    this.slowRunning = true;
    void (async () => {
      while (this.slow.length) await this.slow.shift()!().catch(() => {});
      this.slowRunning = false;
    })();
  }

  /** Waits until the slow lane is empty (for tests and shutdown). */
  async idle(): Promise<void> {
    while (this.slowRunning || this.slow.length) await sleep(5);
  }

  /** Asks for the coin to be read; says where it stands. */
  /** What the long memory already knows of a coin: then its opening is not searched for. */
  private readonly known = new Map<string, Known>();

  request(mint: string, now = Date.now(), known?: Known): AdoptState {
    if (known) this.known.set(mint, known);
    const s = this.state(mint, now);
    if (s) return s;
    if (this.queue.length >= this.maxQueue) return { state: "busy" };
    this.queue.push(mint);
    if (!this.current) void this.run();
    return this.state(mint, now) ?? { state: "busy" };
  }

  /** Asks, then waits up to `ms` for the answer. */
  async ensure(mint: string, ms: number, known?: Known): Promise<AdoptState> {
    const first = this.request(mint, Date.now(), known);
    if (first.state !== "reading" || ms <= 0) return first;
    await Promise.race([new Promise<void>((r) => this.waiters.set(mint, [...(this.waiters.get(mint) ?? []), r])), sleep(ms)]);
    return this.state(mint) ?? { state: "busy" };
  }

  private async run(): Promise<void> {
    while (this.queue.length) {
      const mint = this.queue.shift()!;
      const startedAt = Date.now();
      this.current = { mint, startedAt, stage: "find", stageAt: startedAt, batchesLeft: 0 };
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

  /**
   * Reads one coin onto the tape as fast as a usable card allows: where it trades, its name and supply, its latest
   * trades in parallel batches. The opening (creator, launch time) and the older trades are read in the slow lane after.
   */
  private async read(mint: string): Promise<string | null> {
    const w = await findPool(mint, this.rpc, this.fetchFn);
    if (!w) return "no pool or curve we can read";
    this.stage("meta");
    const [meta, page] = await Promise.all([
      readPoolMeta(mint, (m, p) => patient(() => this.rpc(m, p), this.backoffMs)),
      patient(() => this.rpc<Sig[]>("getSignaturesForAddress", [w.pool, { limit: Math.max(PAGE, this.backfillN) }]), this.backoffMs),
    ]);
    const createdAt = (w.listedAt ?? (Array.isArray(page) && page.length ? (page[page.length - 1]!.blockTime ?? 0) * 1000 : 0)) || Date.now();
    // The card goes up now and the stream follows it from here; who opened it is looked up after.
    const k = this.known.get(mint);
    this.known.delete(mint);
    const adopted = this.tape.adoptToken({
      mint,
      kind: w.kind,
      ...(w.venue ? { venue: w.venue } : {}),
      ...(w.poolVenue ? { poolVenue: w.poolVenue } : {}),
      pool: w.pool,
      // Known from the long memory: its creator and launch, no search.
      creator: k?.creator ?? "",
      createdAt: k?.createdAt ?? createdAt,
      ...(k ? {} : { creatorPending: true }),
      ...(k?.name ? { name: k.name } : {}),
      ...(k?.symbol ? { symbol: k.symbol } : {}),
      ...meta,
    });
    if (!adopted) return null;
    const sigs = Array.isArray(page) ? page : null;
    await this.readBack(mint, w, sigs ? sigs.slice(0, this.firstN) : null, w.dex ?? null, 0, true);
    if (sigs && sigs.length > this.firstN) this.later(() => this.readBack(mint, w, sigs.slice(this.firstN, this.backfillN), null, this.retries, false));
    if (!k) this.later(() => this.findOpening(mint, w));
    return null;
  }

  /** Who opened the pool or launched the coin, and when: paged back in the slow lane, given up after `openingMs`. */
  private async findOpening(mint: string, w: Where): Promise<void> {
    const until = Date.now() + this.openingMs;
    // A PumpSwap pool opens at graduation: the launch itself is on pump.fun's curve. So does a LaunchLab or Meteora
    // coin's pool: the launch is on its curve, which for Meteora the migration (the pool's first transaction) names.
    let where = w.kind === "pumpswap" ? bondingCurveOf(mint) : (w.curve ?? w.pool);
    if (w.poolVenue && !w.curve) {
      const opened = (await this.walk(w.pool, until)).oldest;
      const tx = opened ? await patient(() => this.getTx(opened.signature), this.backoffMs) : null;
      const curve = tx ? migratedFrom(tx, mint) : null;
      if (!curve) {
        this.tape.fillOpening(mint, {});
        this.log(`adopt ${mint}: opening not found, the migration was not read`);
        return;
      }
      where = curve;
    }
    const opening: Pick<Where, "kind" | "venue"> = w.kind === "pumpswap" ? { kind: "curve" } : w.poolVenue ? { kind: "curve", venue: w.venue } : w;
    const first = (await this.walk(where, until)).oldest;
    let found: Parameters<PumpTape["fillOpening"]>[1] = {};
    if (first) {
      const tx = await patient(() => this.getTx(first.signature), this.backoffMs);
      if (tx) {
        const ts = (tx.blockTime ?? first.blockTime ?? 0) * 1000;
        const made = eventsOf(opening, tx, ts).find((e) => e.kind === "create" && e.mint === mint);
        found = made?.kind === "create"
          ? { creator: made.creator, createdAt: made.ts || ts, ...(made.name ? { name: made.name } : {}), ...(made.symbol ? { symbol: made.symbol } : {}), ...(made.quote ? { quote: made.quote } : {}), ...(made.platform ? { platform: made.platform } : {}), ...(made.supply ? { supply: made.supply } : {}) }
          : { creator: tx.transaction.message.accountKeys[0] ?? "", ...(ts ? { createdAt: ts } : {}) };
      }
    }
    const born = Date.now() < until ? await firstSeen(mint, (m, p) => patient(() => this.rpc(m, p), this.backoffMs), 2) : null;
    this.tape.fillOpening(mint, { ...found, ...(born ? { mintCreatedAt: born.at } : {}) });
    this.log(`adopt ${mint}: opening ${found.creator ? `by ${found.creator}` : "not found"}`);
  }

  /** An account's signatures, newest first, in pages of 250: the first page is its recent trades, the last its opening. */
  private async walk(address: string, until = Infinity): Promise<{ newest: Sig[]; oldest: Sig | null }> {
    let newest: Sig[] = [];
    let oldest: Sig | null = null;
    let before: string | undefined;
    for (let i = 0; i < this.pages && Date.now() < until; i++) {
      if (i) await sleep(this.gapMs);
      const page = await patient(() => this.rpc<Sig[]>("getSignaturesForAddress", [address, { limit: 1000, ...(before ? { before } : {}) }]), this.backoffMs);
      if (!Array.isArray(page) || !page.length) break;
      if (!i) newest = page;
      if (page.length < 1000) {
        oldest = page[page.length - 1]!;
        break;
      }
      before = page[page.length - 1]!.signature;
    }
    return { newest, oldest };
  }

  private getTx(sig: string): Promise<Tx | null> {
    return this.rpc<Tx>("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
  }

  /**
   * The latest trades read back onto the tape. When the signatures or none of the transactions can be read, the coin
   * is marked partial with DexScreener's numbers, and the read is tried again in the background, a few times.
   */
  private async readBack(mint: string, w: Where, page: Sig[] | null, dex: DexRead | null, attempt: number, front = false): Promise<void> {
    page ??= await patient(() => this.rpc<Sig[]>("getSignaturesForAddress", [w.pool, { limit: this.firstN }]), this.backoffMs);
    const wanted = Array.isArray(page) ? page.filter((x) => !x.err).slice(0, this.backfillN) : null;
    const trades: Array<{ ev: PumpEvent; tx?: string; slot?: number }> = [];
    let read = 0;
    // Newest first, in parallel batches; each call still backs off on a refusal.
    for (let i = 0; wanted && i < wanted.length; i += this.batch) {
      if (front) this.stage("trades", Math.ceil((wanted.length - i) / this.batch));
      const part = wanted.slice(i, i + this.batch);
      const got = await Promise.all(part.map((s) => patient(() => this.getTx(s.signature), this.backoffMs, 3)));
      got.forEach((tx, k) => {
        if (!tx) return;
        read += 1;
        if (tx.meta?.err) return;
        const s = part[k]!;
        const ts = (tx.blockTime ?? s.blockTime ?? 0) * 1000;
        for (const ev of eventsOf(w, tx, ts)) if (isTrade(w, mint, ev)) trades.push({ ev, tx: s.signature, ...(tx.slot ?? s.slot ? { slot: tx.slot ?? s.slot } : {}) });
      });
    }
    const ok = wanted !== null && (wanted.length === 0 || read > 0);
    const n = ok ? this.tape.backfill(mint, trades) : 0;
    if (!ok && !dex) dex = await this.dexOf(mint, w.pool);
    this.tape.noteBackfill(mint, { ok, read: n, dex: ok ? null : dex });
    this.log(`adopt ${mint}: read back ${n} trades${ok ? "" : ", not read, partial"}`);
    if (!ok && attempt < this.retries && this.tape.has(mint)) {
      const timer = setTimeout(() => this.later(() => this.readBack(mint, w, null, null, attempt + 1)), this.retryMs);
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

/** Meteora's curve account in the transaction that migrated this mint to DAMM v2: migration_damm_v2's first account. */
function migratedFrom(tx: Tx, mint: string): string | null {
  const MIGRATE = Buffer.from([156, 169, 230, 103, 53, 228, 80, 64]);
  const raw = fromRpc(tx, fromBase58);
  const ix = raw.ixs.find((i) => i.program === DBC_PROGRAM && i.data.subarray(0, 8).equals(MIGRATE) && i.accounts[13] === mint);
  return ix?.accounts[0] ?? null;
}

/** Signatures asked for the card's first page. */
const PAGE = 250;
type Stage = "find" | "meta" | "trades";
const STAGES: Stage[] = ["find", "meta", "trades"];
/** What each stage usually takes, in seconds; trades per batch. */
const STAGE_SEC: Record<Stage, number> = { find: 2, meta: 1.5, trades: 1.5 };

/** The node's one adopter, set on the node that reads the chain. */
export const adoption: { current: Adopter | null } = { current: null };
