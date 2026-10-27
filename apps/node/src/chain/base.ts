import { PumpTape, type PumpEvent } from "./pump.ts";
import { addr, addrs, type EvmLog, jsonRpc, num, type Rpc, signed, str, topicAddr, TRANSFER_TOPIC, word, ZERO } from "./bsc.ts";
import { PositionBook } from "./bscHolders.ts";
import { BASE_CHAIN, baseFunderKeys, BscLineage } from "./bscFunders.ts";
import { SocialsRegistry } from "./socials.ts";

/**
 * Base, read the way BNB Chain is: Clanker's factory writes one log for every launch, and every trade of a Clanker
 * token is a Swap on Uniswap v4's one PoolManager, keyed by the pool's id. Those logs become the tape's events.
 *
 * Clanker has no bonding curve: a token is born in its Uniswap pool with the whole supply on one side and nothing on
 * the other, so the tape reads its pool trades as the curve trades it knows (first buyers, bundles, the dev's exit),
 * and the quote the pool has taken in stands where the curve's balance would. Nothing graduates.
 *
 * A Swap names the router that called the PoolManager, not the trader. The trader is read from the token's own
 * Transfer in the same transaction: the wallet the tokens landed in (a buy) or left (a sell). Logs of one transaction
 * are held together for a moment so the two can meet.
 */

/** Clanker v4.0.0: creates every Clanker token on Base since mid 2025; v4.1.0 changed hooks and extensions, not the factory. */
export const CLANKER_FACTORY = "0xe85a59c628f7d27878aceb4bf3b35733630083a9";
/** Uniswap v4's PoolManager on Base: every v4 pool lives inside it. */
export const POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b";
export const WETH = "0x4200000000000000000000000000000000000006";

/** keccak256 of each event's signature: the first topic of its log. */
export const TOPIC = {
  // TokenCreated(address msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address mevModule, uint256 extensionsSupply, address[] extensions)
  create: "0x9299d1d1a88d8e1abdc591ae7a167a6bc63a8f17d695804e9091ee33aa89fb67",
  // Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)
  swap: "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
} as const;

/** Public WebSockets that carry Base's logs; the feed moves to the next one when a connection fails. */
export const DEFAULT_WS = "wss://base-rpc.publicnode.com,wss://base.drpc.org";
export const DEFAULT_RPC = "https://base-rpc.publicnode.com";
/** Base writes a block every two seconds: two days is this many blocks. */
const BLOCK_MS = 2_000;
export const BACKFILL_BLOCKS = Math.round((48 * 3_600_000) / BLOCK_MS);
/** publicnode answers eth_getLogs over ten thousand blocks at a time, two days back; drpc's free plan stops at ten thousand too. */
const CHUNK = 9_999;
/** ...and takes at most ten addresses in one filter over HTTP (the socket takes thousands). */
const ADDRESSES_PER_CALL = 10;
const STALL_MS = 5 * 60_000;
/** Clanker v4 mints a hundred billion of every token. */
export const CLANKER_SUPPLY = 100_000_000_000;
/** How long one transaction's logs wait for each other before the trades in it are read. */
const SETTLE_MS = 1_500;

/** One Clanker launch, as the factory wrote it. */
export interface ClankerLaunch {
  mint: string;
  /** The wallet that owns the token and its fees: the person who asked for it. */
  admin: string;
  /** The wallet that called the factory: the admin, or a deployer service (clanker.world's own, Bankr's) acting for them. */
  deployer: string;
  name: string;
  symbol: string;
  image: string | null;
  description: string | null;
  links: { x: string | null; telegram: string | null; web: string | null };
  /** Where the request came from: "clanker.world", "Bankr", "clank.fun"; and the social platform behind it. */
  interface: string | null;
  platform: string | null;
  poolId: string;
  /** The token the pool is quoted in: WETH, USDC or another token. */
  quote: string;
  hook: string;
  locker: string;
  mevModule: string;
  extensions: string[];
  extensionsSupply: number;
  ts: number | null;
  block: number;
  tx: string;
}

const parseJson = (s: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** The factory's TokenCreated as a launch; null for any other log. */
export function parseCreate(log: EvmLog): ClankerLaunch | null {
  if (log.removed || log.address.toLowerCase() !== CLANKER_FACTORY || log.topics[0] !== TOPIC.create || log.topics.length < 3) return null;
  const d = log.data;
  try {
    const meta = parseJson(str(d, 4)) ?? {};
    const context = parseJson(str(d, 5)) ?? {};
    const links = { x: null as string | null, telegram: null as string | null, web: null as string | null };
    for (const s of Array.isArray(meta.socialMediaUrls) ? (meta.socialMediaUrls as unknown[]) : []) {
      const o = s && typeof s === "object" ? (s as { platform?: unknown; url?: unknown }) : null;
      const url = text(o?.url, 200);
      const platform = String(o?.platform ?? "").toLowerCase();
      if (!url) continue;
      if (platform === "x" || platform === "twitter" || /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i.test(url)) links.x ??= url;
      else if (platform === "telegram" || /^(?:https?:\/\/)?t\.me\//i.test(url)) links.telegram ??= url;
      else if (platform === "website" || platform === "web") links.web ??= url;
    }
    const supplyWord = word(d, 12);
    return {
      mint: topicAddr(log.topics[1]!),
      admin: topicAddr(log.topics[2]!),
      deployer: addr(d, 0),
      name: str(d, 2).trim().slice(0, 64),
      symbol: str(d, 3).trim().slice(0, 32),
      image: text(str(d, 1), 300),
      description: text(meta.description, 500),
      links,
      interface: text(context.interface, 40),
      platform: text(context.platform, 40),
      poolId: `0x${d.slice(2 + 8 * 64, 66 + 8 * 64)}`.toLowerCase(),
      quote: addr(d, 9),
      hook: addr(d, 7),
      locker: addr(d, 10),
      mevModule: addr(d, 11),
      extensions: addrs(d, 13),
      extensionsSupply: Number(supplyWord) / 1e18,
      ts: log.blockTimestamp ? Number(log.blockTimestamp) * 1000 : null,
      block: Number(log.blockNumber),
      tx: log.transactionHash,
    };
  } catch {
    return null;
  }
}

/** A Clanker launch as the tape's create: the admin is the creator; a pool quoted in anything but ETH names its quote. */
export function createEvent(l: ClankerLaunch): Extract<PumpEvent, { kind: "create" }> {
  const via = l.interface && l.interface.toLowerCase() !== "clanker.world" ? l.interface : undefined;
  return { kind: "create", creator: l.admin, mint: l.mint, name: l.name, symbol: l.symbol, ts: l.ts, venue: "clanker", quote: l.quote === WETH ? null : l.quote, supply: CLANKER_SUPPLY, ...(via ? { platform: via } : {}) };
}

/** A followed Uniswap v4 pool: its token, which side the token is, the quote's decimals and what the pool has taken in. */
export interface Pool {
  mint: string;
  /** True when the token is currency0 (its address sorts below the quote's). */
  baseIsToken0: boolean;
  quoteDecimals: number;
  /** Quote bought in minus quote paid out since launch, in whole units: what the pool holds, fees aside. */
  quoteNet: number;
}

export interface ParsedSwap {
  pool: string;
  isBuy: boolean;
  tokens: number;
  /** Whole units of the quote. */
  quote: number;
  /** The router or hook that called the PoolManager; the trader is read from the Transfer logs. */
  sender: string;
  ts: number | null;
  block: number;
  tx: string;
  logIndex: number;
}

/**
 * A PoolManager Swap as a trade. The amounts are the trader's deltas: positive is what they received from the pool,
 * negative what they paid in. Null when the log is not a swap of a followed pool, or moves one side only.
 */
export function parseSwap(log: EvmLog, pool: Pool): ParsedSwap | null {
  if (log.removed || log.topics[0] !== TOPIC.swap || log.topics.length < 3) return null;
  try {
    const a0 = signed(log.data, 0);
    const a1 = signed(log.data, 1);
    const tokenDelta = pool.baseIsToken0 ? a0 : a1;
    const quoteDelta = pool.baseIsToken0 ? a1 : a0;
    const isBuy = tokenDelta > 0n && quoteDelta < 0n;
    if (!isBuy && !(tokenDelta < 0n && quoteDelta > 0n)) return null;
    const abs = (n: bigint) => (n < 0n ? -n : n);
    return {
      pool: log.topics[1]!.toLowerCase(),
      isBuy,
      tokens: Number(abs(tokenDelta)) / 1e18,
      quote: Number(abs(quoteDelta)) / 10 ** pool.quoteDecimals,
      sender: topicAddr(log.topics[2]!),
      ts: log.blockTimestamp ? Number(log.blockTimestamp) * 1000 : null,
      block: Number(log.blockNumber),
      tx: log.transactionHash,
      logIndex: Number(log.logIndex),
    };
  } catch {
    return null;
  }
}

interface Transfer {
  token: string;
  from: string;
  to: string;
  amount: number;
  logIndex: number;
}

/** One transaction's swaps and token transfers, held until they are all in. */
interface Bucket {
  tx: string;
  block: number;
  at: number;
  swaps: ParsedSwap[];
  transfers: Transfer[];
}

/**
 * The trader behind a swap, from the token's transfers in the same transaction: on a buy the wallet with the most
 * tokens netted in, on a sell the one with the most netted out. Routers that pass tokens through net to nothing. The
 * PoolManager, the factory, the mint and the zero address are the pool's own legs, never the trader.
 */
export function traderOf(swap: ParsedSwap, mint: string, transfers: Transfer[], legs: Set<string>): string | null {
  const net = new Map<string, number>();
  for (const t of transfers) {
    if (t.token !== mint) continue;
    if (!legs.has(t.from)) net.set(t.from, (net.get(t.from) ?? 0) - t.amount);
    if (!legs.has(t.to)) net.set(t.to, (net.get(t.to) ?? 0) + t.amount);
  }
  let best: string | null = null;
  let most = 0;
  for (const [w, n] of net) {
    const v = swap.isBuy ? n : -n;
    if (v > most) {
      most = v;
      best = w;
    }
  }
  return best;
}

const DECIMALS = "0x313ce567";
/** An ERC-20's decimals, from the chain. */
export async function decimalsOf(token: string, rpc: Rpc = jsonRpc, url = DEFAULT_RPC): Promise<number> {
  const out = await rpc<string>(url, "eth_call", [{ to: token, data: DECIMALS }, "latest"]);
  if (!out || out.length < 66) throw new Error("decimals: short answer");
  const n = Number(word(out, 0));
  if (!Number.isFinite(n) || n > 36) throw new Error("decimals: odd answer");
  return n;
}

export interface FeedOptions {
  /** One WebSocket URL, or several separated by commas, tried in turn. */
  wsUrl?: string;
  rpcUrl?: string;
  /** The last block applied before a restart: reading resumes after it, never more than two days back. */
  cursor?: number | null;
  /** The pools followed before a restart, from `snapshot()`. */
  pools?: Array<[string, Pool]>;
  log?: (message: string) => void;
  rpc?: Rpc;
  /** The decimals lookup, replaceable in tests. */
  decimalsOf?: (token: string) => Promise<number>;
  /** Where every wallet's position per token is kept, for the holders report. */
  book?: PositionBook;
  /** Told of every launch once it is on the tape, with what the factory wrote about it. */
  onLaunch?: (launch: ClankerLaunch) => void;
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Feeds one tape from Clanker's and the PoolManager's logs. Swaps and transfers of one transaction are held together
 * for a moment, then read in order: the swap's trader is the wallet its transfer names.
 */
export class BaseFeed {
  cursor: number | null;
  /** True while the WebSocket delivers. */
  connected = false;
  /** Two days of logs read on start; true once the feed is live. */
  backfilled = false;
  private stopped = false;
  private ws: WebSocket | null = null;
  private readonly seen = new Set<string>();
  private sessions = 0;
  private readonly opts: Required<Pick<FeedOptions, "wsUrl" | "rpcUrl" | "log" | "rpc">> & Pick<FeedOptions, "WebSocketImpl" | "onLaunch">;
  private readonly decimals: (token: string) => Promise<number>;
  private readonly knownDecimals = new Map<string, number>([[WETH, 18]]);
  /** The pools of the tokens on the tape, by pool id. */
  readonly pools = new Map<string, Pool>();
  /** Pools whose create is still being read: swaps in their transactions wait. */
  private readonly pending = new Set<string>();
  private readonly buckets = new Map<string, Bucket>();
  private poolSub: { ws: WebSocket; id: string | null; wanted: string } | null = null;
  private transferSub: { ws: WebSocket; id: string | null; wanted: number } | null = null;
  private subTimer: ReturnType<typeof setInterval> | null = null;
  private settleTimer: ReturnType<typeof setInterval> | null = null;
  private readonly book: PositionBook;
  private pruner: ReturnType<typeof setInterval> | null = null;
  /** Swaps whose trader no transfer named: the router stands in. Counted, so the log says how often. */
  unnamed = 0;

  private readonly tape: PumpTape;

  constructor(tape: PumpTape, o: FeedOptions = {}) {
    this.tape = tape;
    this.cursor = o.cursor ?? null;
    this.opts = { wsUrl: o.wsUrl ?? DEFAULT_WS, rpcUrl: o.rpcUrl ?? DEFAULT_RPC, log: o.log ?? console.log, rpc: o.rpc ?? jsonRpc, WebSocketImpl: o.WebSocketImpl, onLaunch: o.onLaunch };
    this.decimals = o.decimalsOf ?? ((token) => decimalsOf(token, this.opts.rpc, this.opts.rpcUrl));
    this.book = o.book ?? baseBook;
    // Pools kept across a restart are followed again, for the tokens the tape still has.
    for (const [id, p] of o.pools ?? []) if (tape.token(p.mint)) this.pools.set(id, { ...p });
  }

  /** The cursor and the followed pools, for the next start. */
  snapshot(): string {
    return JSON.stringify({ cursor: this.cursor, at: Date.now(), pools: [...this.pools] });
  }

  /** Addresses that are the pool's own legs for this token: never the trader, never a holder. */
  private legsOf(mint: string): Set<string> {
    return new Set([POOL_MANAGER, CLANKER_FACTORY, ZERO, mint]);
  }

  /** One log in: a launch is read now; a swap or a transfer waits for the rest of its transaction. */
  onLog(log: EvmLog, now = Date.now()): void {
    if (log.removed) return;
    const key = `${log.transactionHash}:${Number(log.logIndex)}`;
    if (this.seen.has(key)) return;
    const address = log.address.toLowerCase();
    const topic = log.topics[0];
    if (address === CLANKER_FACTORY) {
      if (topic !== TOPIC.create) return;
      this.seen.add(key);
      this.trim();
      const launch = parseCreate(log);
      if (launch) void this.onCreate(launch, now);
      return;
    }
    if (address === POOL_MANAGER && topic === TOPIC.swap) {
      const pool = this.pools.get(log.topics[1]?.toLowerCase() ?? "");
      if (!pool) return;
      const swap = parseSwap(log, pool);
      if (!swap) return;
      this.seen.add(key);
      this.trim();
      this.bucketOf(swap.tx, swap.block, now).swaps.push(swap);
      return;
    }
    if (topic === TRANSFER_TOPIC && log.topics.length >= 3 && this.tape.token(address)) {
      this.seen.add(key);
      this.trim();
      const amount = log.data.length >= 66 ? num(log.data, 0) : 0;
      if (amount > 0) this.bucketOf(log.transactionHash, Number(log.blockNumber), now).transfers.push({ token: address, from: topicAddr(log.topics[1]!), to: topicAddr(log.topics[2]!), amount, logIndex: Number(log.logIndex) });
    }
  }

  private trim(): void {
    if (this.seen.size > 40_000) for (const k of [...this.seen].slice(0, 20_000)) this.seen.delete(k);
  }

  private bucketOf(tx: string, block: number, now: number): Bucket {
    let b = this.buckets.get(tx);
    if (!b) {
      b = { tx, block, at: now, swaps: [], transfers: [] };
      this.buckets.set(tx, b);
    }
    if (block > (this.cursor ?? 0)) this.cursor = block;
    return b;
  }

  /** A launch: its quote's decimals are read, then the tape has it and its pool is followed. */
  private async onCreate(l: ClankerLaunch, now: number): Promise<void> {
    if (l.block > (this.cursor ?? 0)) this.cursor = l.block;
    if (this.pools.has(l.poolId)) return;
    this.pending.add(l.poolId);
    let decimals = this.knownDecimals.get(l.quote);
    if (decimals === undefined) {
      for (let attempt = 0; attempt < 3 && decimals === undefined; attempt++) {
        try {
          decimals = await this.decimals(l.quote);
        } catch (error) {
          if (attempt === 2) this.opts.log(`[base] decimals of ${l.quote} not read (${(error as Error).message?.slice(0, 80)}): taken as 18`);
          else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      this.knownDecimals.set(l.quote, decimals ?? 18);
    }
    const pool: Pool = { mint: l.mint, baseIsToken0: BigInt(l.mint) < BigInt(l.quote), quoteDecimals: decimals ?? 18, quoteNet: 0 };
    // A token restored with the tape but without its pool (an older snapshot) is followed again, not launched twice.
    const fresh = !this.tape.token(l.mint);
    if (fresh) this.tape.apply(createEvent(l), l.ts ?? now, l.tx, l.block);
    this.pools.set(l.poolId, pool);
    this.pending.delete(l.poolId);
    this.followPools();
    this.followTransfers();
    if (!fresh) return;
    this.opts.onLaunch?.(l);
    // Live, the launch transaction's own swap (the dev's buy) was written before the pool was followed: its receipt has it.
    if (this.backfilled) await this.readReceipt(l.tx, now);
  }

  /** Every log of one transaction, from its receipt: the launch's dev buy and the supply's first moves. */
  private async readReceipt(tx: string, now: number): Promise<void> {
    try {
      const receipt = await this.opts.rpc<{ logs?: EvmLog[]; blockNumber?: string } | null>(this.opts.rpcUrl, "eth_getTransactionReceipt", [tx]);
      for (const log of receipt?.logs ?? []) this.onLog({ ...log, blockNumber: log.blockNumber ?? receipt?.blockNumber ?? "0x0", transactionHash: log.transactionHash ?? tx }, now);
      const b = this.buckets.get(tx);
      if (b) {
        this.buckets.delete(tx);
        this.resolve(b, now);
      }
    } catch (error) {
      this.opts.log(`[base] receipt of ${tx.slice(0, 12)} not read: ${(error as Error).message?.slice(0, 80)}`);
    }
  }

  /** Buckets whose transaction is old enough, oldest first; the ones waiting on a launch stay. */
  settle(now = Date.now(), all = false): void {
    const due = [...this.buckets.values()].filter((b) => (all || now - b.at >= SETTLE_MS) && !b.swaps.some((s) => this.pending.has(s.pool))).sort((a, b) => a.block - b.block || Math.min(...a.swaps.map((s) => s.logIndex), ...a.transfers.map((t) => t.logIndex)) - Math.min(...b.swaps.map((s) => s.logIndex), ...b.transfers.map((t) => t.logIndex)));
    for (const b of due) {
      this.buckets.delete(b.tx);
      this.resolve(b, now);
    }
  }

  /** One transaction read: each swap becomes a trade by the wallet its transfer names; transfers without a swap move positions. */
  private resolve(b: Bucket, now: number): void {
    const traded = new Set<string>();
    for (const s of b.swaps.sort((x, y) => x.logIndex - y.logIndex)) {
      const pool = this.pools.get(s.pool);
      if (!pool) continue;
      traded.add(pool.mint);
      const user = traderOf(s, pool.mint, b.transfers, this.legsOf(pool.mint)) ?? s.sender;
      if (user === s.sender) this.unnamed += 1;
      pool.quoteNet = Math.max(0, pool.quoteNet + (s.isBuy ? s.quote : -s.quote));
      const ts = s.ts ?? now;
      this.tape.apply({ kind: "trade", mint: pool.mint, user, isBuy: s.isBuy, tokens: s.tokens, sol: s.quote, ts, curveSol: pool.quoteNet }, ts, s.tx, s.block);
      this.book.note(pool.mint, user, s.tokens, s.isBuy, ts);
    }
    for (const t of b.transfers) {
      if (traded.has(t.token)) continue;
      const legs = this.legsOf(t.token);
      if (legs.has(t.from) || legs.has(t.to) || t.from === t.to) continue;
      this.book.move(t.token, t.from, t.to, t.amount, now);
    }
  }

  /** What a pool holds of its quote, as the swaps added up; null for a pool the feed does not follow. */
  quoteNetOf(mint: string): number | null {
    for (const p of this.pools.values()) if (p.mint === mint) return p.quoteNet;
    return null;
  }

  /** One subscription for every followed pool's swaps; replaced when the set changes. Nothing without a live socket. */
  private followPools(): void {
    const sub = this.poolSub;
    if (!sub || sub.ws.readyState !== 1) return;
    const wanted = [...this.pools.keys()].sort().join(",");
    if (wanted === sub.wanted) return;
    sub.wanted = wanted;
    if (sub.id) sub.ws.send(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_unsubscribe", params: [sub.id] }));
    sub.id = null;
    if (!wanted) return;
    sub.ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_subscribe", params: ["logs", { address: POOL_MANAGER, topics: [TOPIC.swap, wanted.split(",")] }] }));
  }

  /** The Transfer subscription follows every token the tape keeps; renewed when the count changes. */
  private followTransfers(): void {
    const sub = this.transferSub;
    if (!sub || sub.ws.readyState !== 1) return;
    const mints = this.tape.mints();
    if (mints.length === sub.wanted) return;
    sub.wanted = mints.length;
    if (sub.id) sub.ws.send(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "eth_unsubscribe", params: [sub.id] }));
    sub.id = null;
    if (!mints.length) return;
    sub.ws.send(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "eth_subscribe", params: ["logs", { address: mints, topics: [TRANSFER_TOPIC] }] }));
  }

  private async getLogs(filter: Record<string, unknown>, attempts = 4): Promise<EvmLog[]> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.opts.rpc<EvmLog[]>(this.opts.rpcUrl, "eth_getLogs", [filter]);
      } catch (error) {
        if (attempt >= attempts - 1) throw error;
        await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
      }
    }
  }

  /**
   * Logs from `from` to `to`, in chunks: the factory's first, so the chunk's launches are followed before its swaps and
   * transfers are asked for. Stops when its session is over.
   */
  private async fill(from: number, to: number, session: number): Promise<void> {
    let chunks = 0;
    for (let next = from; next <= to && !this.stopped && session === this.sessions; ) {
      const start = next;
      const end = Math.min(to, start + CHUNK);
      next = end + 1;
      const range = { fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` };
      const creates = await this.getLogs({ ...range, address: CLANKER_FACTORY, topics: [TOPIC.create] });
      if (session !== this.sessions) return;
      for (const log of creates) {
        const key = `${log.transactionHash}:${Number(log.logIndex)}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        const launch = parseCreate(log);
        if (launch) await this.onCreate(launch, Date.now());
      }
      const poolIds = [...this.pools.keys()];
      // The transfers asked for are those of the tokens that traded in the chunk: they name each swap's trader. A
      // plain move of a token nobody traded that hour is the lesser record, and ten addresses a call is the limit.
      const traded = new Set<string>();
      if (poolIds.length) {
        const swaps = await this.getLogs({ ...range, address: POOL_MANAGER, topics: [TOPIC.swap, poolIds] });
        if (session !== this.sessions) return;
        for (const log of swaps) {
          const pool = this.pools.get(log.topics[1]?.toLowerCase() ?? "");
          if (pool) traded.add(pool.mint);
          this.onLog(log);
        }
      }
      const mints = [...traded];
      let missed = 0;
      for (let i = 0; i < mints.length; i += ADDRESSES_PER_CALL) {
        try {
          const transfers = await this.getLogs({ ...range, address: mints.slice(i, i + ADDRESSES_PER_CALL), topics: [TRANSFER_TOPIC] }, 2);
          if (session !== this.sessions) return;
          for (const log of transfers) this.onLog(log);
        } catch {
          missed += 1;
        }
      }
      if (missed) this.opts.log(`[base] transfers ${start}..${end}: ${missed} of ${Math.ceil(mints.length / ADDRESSES_PER_CALL)} reads failed; those swaps name their router`);
      this.settle(Date.now(), true);
      if (this.cursor === null || end > this.cursor) this.cursor = end;
      if (++chunks % 3 === 0) this.opts.log(`[base] backfill ${Math.round(((end - from) / Math.max(1, to - from)) * 100)}%: ${this.tape.status().tracked} tokens`);
    }
  }

  /** Reads two days of logs (or the gap since the cursor), then stays on the WebSocket, reconnecting with backoff. */
  start(): () => void {
    void this.run();
    this.settleTimer = setInterval(() => this.settle(), 500);
    this.settleTimer.unref?.();
    // Two days is what the tape keeps: older tokens, their pools and positions go, like the other tapes' pruners.
    this.pruner = setInterval(() => {
      this.tape.prune();
      this.book.prune();
      for (const [id, p] of this.pools) if (!this.tape.token(p.mint)) this.pools.delete(id);
    }, 10 * 60_000);
    this.pruner.unref?.();
    return () => {
      this.stopped = true;
      if (this.pruner) clearInterval(this.pruner);
      if (this.settleTimer) clearInterval(this.settleTimer);
      this.ws?.close();
    };
  }

  private async run(): Promise<void> {
    let delay = 1_000;
    while (!this.stopped) {
      try {
        await this.session();
        delay = 1_000;
      } catch (error) {
        if (!this.stopped) this.opts.log(`[base] feed error: ${(error as Error).message?.slice(0, 200)}`);
      }
      this.connected = false;
      this.tape.connected = false;
      if (this.stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  }

  /** One WebSocket: subscribe first and hold what arrives, fill the gap up to the head, release the buffer, go live. */
  private session(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const Impl = this.opts.WebSocketImpl ?? WebSocket;
      const urls = this.opts.wsUrl.split(",").map((u) => u.trim()).filter(Boolean);
      const session = ++this.sessions;
      const url = urls[(session - 1) % urls.length]!;
      const ws = new Impl(url);
      this.ws = ws;
      let buffer: EvmLog[] | null = [];
      let heard = Date.now();
      let subscribed = false;
      const stall = setInterval(() => {
        if (Date.now() - heard >= STALL_MS) {
          reject(new Error(`no logs for ${Math.round((Date.now() - heard) / 1000)} s, reconnecting`));
          ws.close();
        }
      }, 15_000);
      let finished = false;
      const done = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearInterval(stall);
        if (this.ws === ws) this.ws = null;
        if (this.poolSub?.ws === ws) this.poolSub = null;
        if (this.transferSub?.ws === ws) this.transferSub = null;
        if (this.subTimer) {
          clearInterval(this.subTimer);
          this.subTimer = null;
        }
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        error ? reject(new Error(`${url}: ${error.message}`)) : resolve();
      };
      ws.onopen = () => {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["logs", { address: CLANKER_FACTORY, topics: [TOPIC.create] }] }));
      };
      ws.onmessage = (m) => {
        heard = Date.now();
        let msg: { id?: number; result?: unknown; error?: { message?: string }; params?: { result?: EvmLog } };
        try {
          msg = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (msg.id === 2) {
          if (!msg.error && this.poolSub?.ws === ws) this.poolSub.id = String(msg.result);
          else if (msg.error) this.opts.log(`[base] pools not followed: ${msg.error.message}`);
          return;
        }
        if (msg.id === 3 || msg.id === 5) return;
        if (msg.id === 4) {
          if (!msg.error && this.transferSub?.ws === ws) this.transferSub.id = String(msg.result);
          else if (msg.error) this.opts.log(`[base] transfers not followed: ${msg.error.message}`);
          return;
        }
        if (msg.id === 1) {
          if (msg.error) return done(new Error(`subscribe: ${msg.error.message}`));
          subscribed = true;
          this.poolSub = { ws, id: null, wanted: "" };
          this.transferSub = { ws, id: null, wanted: -1 };
          this.followPools();
          this.followTransfers();
          if (this.subTimer) clearInterval(this.subTimer);
          this.subTimer = setInterval(() => {
            this.followPools();
            this.followTransfers();
          }, 30_000);
          this.subTimer.unref?.();
          void this.catchUp(session).then(() => {
            if (session !== this.sessions) return;
            const held = buffer ?? [];
            buffer = null;
            for (const log of held) this.onLog(log);
            this.backfilled = true;
            if (!this.connected) {
              this.connected = true;
              this.tape.connected = true;
              this.opts.log(`[base] Clanker stream live: ${this.tape.status().tracked} tokens on the tape, ${this.pools.size} pools followed`);
            }
          }, done);
          return;
        }
        const log = msg.params?.result;
        if (!log || !subscribed) return;
        if (buffer) buffer.push(log);
        else this.onLog(log);
      };
      ws.onerror = () => done(new Error("socket error"));
      ws.onclose = () => done(this.stopped ? undefined : new Error("socket closed"));
    });
  }

  /** The blocks since the cursor (two days on a cold start), up to the head as it stands now. */
  private async catchUp(session: number): Promise<void> {
    const head = Number(await this.opts.rpc<string>(this.opts.rpcUrl, "eth_blockNumber", []));
    if (!Number.isFinite(head) || head <= 0) throw new Error("no block height");
    const from = Math.max(this.cursor === null ? 0 : this.cursor + 1, head - BACKFILL_BLOCKS);
    if (from > head) return;
    if (head - from > 1_000) this.opts.log(`[base] reading ${head - from} blocks of Clanker logs (${Math.round(((head - from) * BLOCK_MS) / 3_600_000)} h)`);
    await this.fill(from, head, session);
  }
}

/**
 * What clanker.world itself says about a token: who asked for it, when, its ticker, picture and links. Read for
 * tokens the tape never saw launch (older than two days). Answers are kept; misses too, briefly.
 */
export interface ClankerToken {
  creator: string;
  createdAt: number;
  name: string | null;
  symbol: string | null;
  image: string | null;
  /** What it is paired with, as clanker.world names it: "WETH", "USDC"... */
  quote: string | null;
  poolId: string | null;
  interface: string | null;
  links: { x: string | null; telegram: string | null; web: string | null };
}

const CLANKER_API = "https://www.clanker.world/api/tokens";
const INFO_MS = 10 * 60_000;
const MISS_MS = 5 * 60_000;

export class ClankerInfo {
  private readonly kept = new Map<string, { at: number; info: ClankerToken | null }>();
  private readonly inflight = new Map<string, Promise<ClankerToken | null>>();
  private readonly f: typeof fetch;
  constructor(f: typeof fetch = fetch) {
    this.f = f;
  }

  peek(mint: string): ClankerToken | null | undefined {
    return this.kept.get(mint.toLowerCase())?.info;
  }

  image(mint: string): string | undefined {
    return this.peek(mint)?.image ?? undefined;
  }

  async get(mint: string, now = Date.now()): Promise<ClankerToken | null> {
    const key = mint.toLowerCase();
    const hit = this.kept.get(key);
    if (hit && now - hit.at < (hit.info ? INFO_MS : MISS_MS)) return hit.info;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.read(key)
      .catch(() => null)
      .then((info) => {
        this.kept.set(key, { at: Date.now(), info });
        if (this.kept.size > 20_000) this.kept.delete(this.kept.keys().next().value!);
        this.inflight.delete(key);
        return info;
      });
    this.inflight.set(key, p);
    return p;
  }

  private async read(mint: string): Promise<ClankerToken | null> {
    const r = await this.f(`${CLANKER_API}?address=${mint}`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (zooaiagency.com x-ray)" }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return null;
    const body = (await r.json()) as { data?: Array<Record<string, unknown>> };
    const d = body.data?.find((t) => String(t.contract_address ?? "").toLowerCase() === mint) ?? body.data?.[0];
    const creator = typeof d?.admin === "string" ? d.admin.toLowerCase() : null;
    const createdAt = new Date(String(d?.deployed_at ?? d?.created_at ?? "")).getTime();
    if (!d || !creator || !/^0x[0-9a-f]{40}$/.test(creator) || !Number.isFinite(createdAt) || createdAt <= 0) return null;
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const meta = (d.metadata && typeof d.metadata === "object" ? d.metadata : {}) as { socialMediaUrls?: unknown };
    const links = { x: null as string | null, telegram: null as string | null, web: null as string | null };
    for (const x of Array.isArray(meta.socialMediaUrls) ? (meta.socialMediaUrls as Array<{ platform?: unknown; url?: unknown }>) : []) {
      const url = s(x?.url);
      const platform = String(x?.platform ?? "").toLowerCase();
      if (!url) continue;
      if (platform === "x" || platform === "twitter") links.x ??= url;
      else if (platform === "telegram") links.telegram ??= url;
      else if (platform === "website") links.web ??= url;
    }
    const context = (d.social_context && typeof d.social_context === "object" ? d.social_context : {}) as { interface?: unknown };
    return { creator, createdAt, name: s(d.name), symbol: s(d.symbol), image: s(d.img_url), quote: s(d.pair), poolId: s(d.pool_address)?.toLowerCase() ?? null, interface: s(context.interface), links };
  }
}

/** The one Base tape per node process, next to the Solana and BNB Chain ones. */
export const baseTape = new PumpTape("ETH");
export const clanker = new ClankerInfo();
/** Who paid for which Clanker creator, when a key that covers Base is set. */
export const baseLineage = new BscLineage(baseTape, fetch, baseFunderKeys, BASE_CHAIN);
/** The X accounts and Telegram groups Clanker launches point to, and their record. Written from the factory's own log. */
export const baseSocials = new SocialsRegistry(baseTape);
/** What each wallet bought minus what it sold, per token, from the swaps the feed saw. */
export const baseBook = new PositionBook();

/** The factory's record of a launch into the socials registry: its accounts and picture, straight from the log. */
export function recordClanker(l: ClankerLaunch): void {
  baseSocials.recordMeta(l.mint, { twitter: l.links.x ?? undefined, telegram: l.links.telegram ?? undefined, image: l.image ?? undefined });
}

/** clanker.world's record of a token the tape never saw into the registry, once per token. */
const recorded = new Set<string>();
export async function recordClankerFromApi(mint: string): Promise<void> {
  const key = mint.toLowerCase();
  if (recorded.has(key)) return;
  const info = await clanker.get(key);
  if (!info) return;
  recorded.add(key);
  if (recorded.size > 50_000) recorded.clear();
  baseSocials.recordMeta(key, { twitter: info.links.x ?? undefined, telegram: info.links.telegram ?? undefined, image: info.image ?? undefined });
}
