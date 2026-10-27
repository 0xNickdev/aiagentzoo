import { PumpTape, type PumpEvent } from "./pump.ts";
import { bscBook, type PositionBook } from "./bscHolders.ts";
import { BscLineage } from "./bscFunders.ts";
import { SocialsRegistry } from "./socials.ts";

/**
 * BNB Chain, read the same way as Solana: four.meme's TokenManager2 writes a log for every launch, buy, sell and
 * graduation, and those logs become the tape's events. One tape per chain; the check and the X-Ray read either.
 *
 * Live logs come over a public WebSocket (eth_subscribe), the last two days come from eth_getLogs in blocks of five
 * thousand, and every reconnect fills the gap since the last block applied. No keys: the public endpoints carry
 * four.meme's volume with room to spare.
 */

/** four.meme's TokenManager2: creates and trades every token launched there since September 2024. */
export const TOKEN_MANAGER2 = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";
/** TokenManagerHelper3: reads a token's quote, price and curve from either TokenManager. */
export const HELPER3 = "0xf251f83e40a78868fcfa3fa4599dad6494e46034";
export const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
/** PancakeSwap V2: where a four.meme token's liquidity goes when it graduates. */
export const PANCAKE_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";
/** The pair's own events: reserves after every trade, and each swap. */
/** ERC-20 Transfer(address indexed from, address indexed to, uint256 value). */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ZERO = "0x0000000000000000000000000000000000000000";
export const PAIR_TOPIC = {
  sync: "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1", // Sync(uint112 reserve0, uint112 reserve1)
  swap: "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822", // Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)
} as const;

/** keccak256 of each event's signature: the first topic of its log. */
export const TOPIC = {
  create: "0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20", // TokenCreate(address creator, address token, uint256 requestId, string name, string symbol, uint256 totalSupply, uint256 launchTime, uint256 launchFee)
  buy: "0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942", // TokenPurchase(address token, address account, uint256 price, uint256 amount, uint256 cost, uint256 fee, uint256 offers, uint256 funds)
  sell: "0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19", // TokenSale(address token, address account, uint256 price, uint256 amount, uint256 cost, uint256 fee, uint256 offers, uint256 funds)
  liquidity: "0xc18aa71171b358b706fe3dd345299685ba21a5316c66ffa9e319268b033c44b0", // LiquidityAdded(address base, uint256 offers, address quote, uint256 funds)
} as const;

/** Public WebSockets that carry four.meme's logs; the feed moves to the next one when a connection fails. */
export const DEFAULT_WS = "wss://bsc-rpc.publicnode.com,wss://bsc.publicnode.com,wss://bsc.drpc.org";
export const DEFAULT_RPC = "https://bsc-rpc.publicnode.com";
/** Serves eth_getLogs two days back, five thousand blocks a call; publicnode stops a few thousand blocks behind the head. */
export const DEFAULT_LOGS = "https://rpc.48.club";
/** BNB Chain writes a block every 0.75 s since the Maxwell fork: two days is this many blocks. */
const BLOCK_MS = 750;
export const BACKFILL_BLOCKS = Math.round((48 * 3_600_000) / BLOCK_MS);
const CHUNK = 4_999;
/** The archive endpoint takes about 5 ms a block: a thousand at a time stays well inside its own timeout. */
const LOGS_CHUNK = 999;
/** Blocks near the head the live endpoint still serves logs for. */
const NEAR_HEAD = 3_000;
const WEI = 1e18;
const STALL_MS = 5 * 60_000;

export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  /** Erigon and reth put the block's time on the log; publicnode and 48.club both do. */
  blockTimestamp?: string;
  transactionHash: string;
  logIndex: string;
  removed?: boolean;
}

/** A tape event with where and when the chain wrote it. four.meme has no pool events, so every event names its token. */
export interface ChainEvent {
  ev: Exclude<PumpEvent, { kind: "swap" }>;
  /** Milliseconds, from the log's block time; null when the log came without one. */
  ts: number | null;
  block: number;
  tx: string;
  /** On a graduation: the token the pool is quoted in (WBNB when four.meme wrote the zero address). */
  quote?: string;
}

/** ABI words of a log's data, shared with the Base reader: the i-th 32-byte word as a number, an address or a string. */
export const word = (data: string, i: number): bigint => BigInt(`0x${data.slice(2 + i * 64, 66 + i * 64)}`);
export const addr = (data: string, i: number): string => `0x${data.slice(2 + i * 64 + 24, 66 + i * 64)}`.toLowerCase();
export const num = (data: string, i: number, decimals = 18): number => Number(word(data, i)) / 10 ** decimals;
/** A signed word (int128 or int256 both arrive sign-extended to 32 bytes). */
export const signed = (data: string, i: number): bigint => {
  const n = word(data, i);
  return n >= 1n << 255n ? n - (1n << 256n) : n;
};
/** An ABI string: its offset word points at a length word, then the bytes. */
export const str = (data: string, i: number): string => {
  const at = Number(word(data, i)) * 2;
  const len = Number(BigInt(`0x${data.slice(2 + at, 66 + at)}`));
  return Buffer.from(data.slice(66 + at, 66 + at + len * 2), "hex").toString("utf8");
};
/** An ABI dynamic array of addresses: its offset word points at a length word, then one word per address. */
export const addrs = (data: string, i: number): string[] => {
  const at = Number(word(data, i)) * 2;
  const len = Number(BigInt(`0x${data.slice(2 + at, 66 + at)}`));
  const out: string[] = [];
  for (let k = 0; k < len && k < 64; k++) out.push(`0x${data.slice(66 + at + k * 64 + 24, 66 + at + (k + 1) * 64)}`.toLowerCase());
  return out;
};
/** A topic as an address: the low twenty bytes of the word. */
export const topicAddr = (topic: string): string => `0x${topic.slice(26)}`.toLowerCase();

/**
 * One TokenManager2 log as a tape event. A create comes without its quote: the caller reads that from Helper3 and sets
 * `quote` before applying. Amounts are in whole tokens and whole BNB (or whole units of the quote token).
 */
export function parseLog(log: EvmLog): ChainEvent | null {
  if (log.removed || log.address.toLowerCase() !== TOKEN_MANAGER2) return null;
  const d = log.data;
  const block = Number(log.blockNumber);
  const ts = log.blockTimestamp ? Number(log.blockTimestamp) * 1000 : null;
  const base = { ts, block, tx: log.transactionHash };
  try {
    switch (log.topics[0]) {
      case TOPIC.create: {
        const supply = num(d, 5);
        return { ...base, ev: { kind: "create", creator: addr(d, 0), mint: addr(d, 1), name: str(d, 3).trim().slice(0, 64), symbol: str(d, 4).trim().slice(0, 32), ts, venue: "fourmeme", ...(supply > 0 ? { supply } : {}) } };
      }
      case TOPIC.buy:
      case TOPIC.sell:
        return { ...base, ev: { kind: "trade", mint: addr(d, 0), user: addr(d, 1), isBuy: log.topics[0] === TOPIC.buy, tokens: num(d, 3), sol: num(d, 4), ts: ts ?? Date.now(), curveSol: num(d, 7) } };
      case TOPIC.liquidity: {
        const quote = addr(d, 2);
        return { ...base, ev: { kind: "complete", mint: addr(d, 0) }, quote: /^0x0+$/.test(quote) ? WBNB : quote };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export type Rpc = <T>(url: string, method: string, params: unknown[]) => Promise<T>;

/** A followed PancakeSwap pair: its token, and which side of the pair the token is. */
export interface Pair {
  mint: string;
  /** True when the token is token0 (its address sorts below the quote's). */
  baseIsToken0: boolean;
  /** The quote reserve after the last Sync, in whole units. */
  quoteReserve: number | null;
}

const GET_PAIR = "0xe6a43905";
/** The PancakeSwap V2 pair of a token and its quote, from the factory; null when there is none. */
export async function pairOf(token: string, quote: string, rpc: Rpc = jsonRpc, url = DEFAULT_RPC): Promise<string | null> {
  const data = `${GET_PAIR}${token.slice(2).toLowerCase().padStart(64, "0")}${quote.slice(2).toLowerCase().padStart(64, "0")}`;
  const out = await rpc<string>(url, "eth_call", [{ to: PANCAKE_FACTORY, data }, "latest"]);
  if (!out || out.length < 66) return null;
  const pair = addr(out, 0);
  return /^0x0+$/.test(pair) ? null : pair;
}

const GET_RESERVES = "0x0902f1ac";
/** What the pool holds of the quote right now, in whole units: the tape only knows the last Sync it saw. */
export async function bscPoolSol(pair: string, baseIsToken0: boolean, rpc: Rpc = jsonRpc, url = DEFAULT_RPC): Promise<number | null> {
  const out = await rpc<string>(url, "eth_call", [{ to: pair, data: GET_RESERVES }, "latest"]);
  if (!out || out.length < 66 * 2) return null;
  return num(out, baseIsToken0 ? 1 : 0);
}

/** A pair's Sync or Swap log as a tape swap, given which side the token is. Sync only moves the reserve. */
export function parsePairLog(log: EvmLog, pair: Pair): Extract<PumpEvent, { kind: "swap" }> | null {
  if (log.removed) return null;
  const d = log.data;
  const ts = log.blockTimestamp ? Number(log.blockTimestamp) * 1000 : Date.now();
  try {
    if (log.topics[0] === PAIR_TOPIC.sync) {
      pair.quoteReserve = num(d, pair.baseIsToken0 ? 1 : 0);
      return null;
    }
    if (log.topics[0] !== PAIR_TOPIC.swap) return null;
    const [a0In, a1In, a0Out, a1Out] = [num(d, 0), num(d, 1), num(d, 2), num(d, 3)];
    const tokensIn = pair.baseIsToken0 ? a0In : a1In;
    const tokensOut = pair.baseIsToken0 ? a0Out : a1Out;
    const quoteIn = pair.baseIsToken0 ? a1In : a0In;
    const quoteOut = pair.baseIsToken0 ? a1Out : a0Out;
    const isBuy = tokensOut > 0 && quoteIn > 0;
    if (!isBuy && !(tokensIn > 0 && quoteOut > 0)) return null;
    const to = log.topics[2] ? `0x${log.topics[2].slice(26)}`.toLowerCase() : "";
    return { kind: "swap", pool: log.address.toLowerCase(), isBuy, sol: isBuy ? quoteIn : quoteOut, tokens: isBuy ? tokensOut : tokensIn, user: to, ts, poolSol: pair.quoteReserve ?? 0 };
  } catch {
    return null;
  }
}

export const jsonRpc: Rpc = async (url, method, params) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${method}: ${r.status}`);
  const body = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
  return body.result as never;
};

/** Helper3.getTokenInfo(token): the quote the token trades against is the third word. */
const GET_TOKEN_INFO = "0x1f69565f";
export async function quoteOf(token: string, rpc: Rpc = jsonRpc, url = DEFAULT_RPC): Promise<string | null> {
  const data = GET_TOKEN_INFO + token.slice(2).toLowerCase().padStart(64, "0");
  const out = await rpc<string>(url, "eth_call", [{ to: HELPER3, data }, "latest"]);
  if (!out || out.length < 66 * 3) throw new Error("getTokenInfo: short answer");
  const quote = addr(out, 2);
  return quote === WBNB || /^0x0+$/.test(quote) ? null : quote;
}

export interface FeedOptions {
  /** One WebSocket URL, or several separated by commas, tried in turn. */
  wsUrl?: string;
  rpcUrl?: string;
  logsUrl?: string;
  /** The last block applied before a restart: reading resumes after it, never more than two days back. */
  cursor?: number | null;
  log?: (message: string) => void;
  rpc?: Rpc;
  /** The quote lookup, replaceable in tests. */
  quoteOf?: (token: string) => Promise<string | null>;
  /** The pair lookup, replaceable in tests. */
  pairOf?: (token: string, quote: string) => Promise<string | null>;
  /** Where every wallet's position per token is kept, for the holders report. */
  book?: PositionBook;
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Feeds one tape from TokenManager2's logs. Events for a token whose create is still waiting on its quote queue up
 * behind it, so the creator's buy in the launch transaction lands after the create, as the tape expects.
 */
export class BscFeed {
  cursor: number | null;
  /** True while the WebSocket delivers. */
  connected = false;
  /** Two days of logs read on start; true once the feed is live. */
  backfilled = false;
  private stopped = false;
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, ChainEvent[]>();
  private readonly seen = new Set<string>();
  private sessions = 0;
  private readonly opts: Required<Pick<FeedOptions, "wsUrl" | "rpcUrl" | "logsUrl" | "log" | "rpc">> & Pick<FeedOptions, "WebSocketImpl">;
  private readonly quote: (token: string) => Promise<string | null>;
  private readonly pair: (token: string, quote: string) => Promise<string | null>;
  /** The PancakeSwap pairs of graduated tokens, followed on the socket next to TokenManager2. */
  readonly pairs = new Map<string, Pair>();
  private pairSub: { ws: WebSocket; id: string | null; wanted: string } | null = null;
  /** The Transfer subscription over every token on the tape, renewed as launches come and go. */
  private transferSub: { ws: WebSocket; id: string | null; wanted: number } | null = null;
  private transferTimer: ReturnType<typeof setInterval> | null = null;
  private readonly book: PositionBook;
  private pruner: ReturnType<typeof setInterval> | null = null;

  private readonly tape: PumpTape;

  constructor(tape: PumpTape, o: FeedOptions = {}) {
    this.tape = tape;
    this.cursor = o.cursor ?? null;
    this.opts = { wsUrl: o.wsUrl ?? DEFAULT_WS, rpcUrl: o.rpcUrl ?? DEFAULT_RPC, logsUrl: o.logsUrl ?? DEFAULT_LOGS, log: o.log ?? console.log, rpc: o.rpc ?? jsonRpc, WebSocketImpl: o.WebSocketImpl };
    this.quote = o.quoteOf ?? ((token) => quoteOf(token, this.opts.rpc, this.opts.rpcUrl));
    this.pair = o.pairOf ?? ((token, quote) => pairOf(token, quote, this.opts.rpc, this.opts.rpcUrl));
    this.book = o.book ?? bscBook;
    // Pools the tape kept across a restart are followed again.
    for (const pool of tape.poolAddresses()) {
      const mint = tape.mintOfPool(pool);
      if (mint) this.pairs.set(pool, { mint, baseIsToken0: BigInt(mint) < BigInt(tape.token(mint)?.facts.quote ?? WBNB), quoteReserve: null });
    }
  }

  /**
   * A token's own Transfer in: a plain move between wallets changes who holds what. A leg of a curve trade or a pool
   * swap (the curve, the pair or the mint itself on one side) is already counted from the trade.
   */
  onTransferLog(log: EvmLog, now = Date.now()): void {
    if (log.removed || log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) return;
    const key = `${log.transactionHash}:${Number(log.logIndex)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const from = `0x${log.topics[1]!.slice(26)}`.toLowerCase();
    const to = `0x${log.topics[2]!.slice(26)}`.toLowerCase();
    const token = log.address.toLowerCase();
    const leg = (w: string) => w === TOKEN_MANAGER2 || w === ZERO || w === token || this.pairs.has(w);
    if (leg(from) || leg(to) || from === to) return;
    const amount = num(log.data, 0);
    if (amount > 0) this.book.move(token, from, to, amount, now);
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

  /** A pair's log in: reserves or a swap on a graduated token's pool. */
  onPairLog(log: EvmLog, now = Date.now()): void {
    const pair = this.pairs.get(log.address.toLowerCase());
    if (!pair) return;
    const key = `${log.transactionHash}:${Number(log.logIndex)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const ev = parsePairLog(log, pair);
    if (!ev) return;
    this.tape.apply(ev, now, log.transactionHash, Number(log.blockNumber));
    this.book.note(pair.mint, ev.user, ev.tokens, ev.isBuy, now);
  }

  /** On a graduation: the pool from the factory, then the tape learns it and the socket follows it. */
  private async resolvePool(mint: string, quote: string, e: ChainEvent, now: number): Promise<void> {
    let pool: string | null = null;
    for (let attempt = 0; attempt < 3 && pool === null; attempt++) {
      try {
        pool = await this.pair(mint, quote);
        if (pool === null) await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
      } catch {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    if (!pool) return;
    this.tape.apply({ kind: "pool", mint, pool }, e.ts ?? now, e.tx, e.block);
    this.pairs.set(pool, { mint, baseIsToken0: BigInt(mint) < BigInt(quote), quoteReserve: null });
    this.followPairs();
  }

  /** One subscription for every followed pair; replaced when the set changes. Nothing without a live socket. */
  private followPairs(): void {
    const sub = this.pairSub;
    if (!sub || sub.ws.readyState !== 1) return;
    const wanted = [...this.pairs.keys()].sort().join(",");
    if (wanted === sub.wanted) return;
    sub.wanted = wanted;
    if (sub.id) sub.ws.send(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_unsubscribe", params: [sub.id] }));
    sub.id = null;
    if (!wanted) return;
    sub.ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_subscribe", params: ["logs", { address: wanted.split(","), topics: [[PAIR_TOPIC.sync, PAIR_TOPIC.swap]] }] }));
  }

  /** One log in: parsed, deduplicated, queued behind its token's create when that is still being read. */
  onLog(log: EvmLog, now = Date.now()): void {
    const e = parseLog(log);
    if (!e) return;
    const key = `${e.tx}:${Number(log.logIndex)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 20_000) for (const k of [...this.seen].slice(0, 10_000)) this.seen.delete(k);
    if (e.block > (this.cursor ?? 0)) this.cursor = e.block;
    if (e.ev.kind === "trade") this.book.note(e.ev.mint, e.ev.user, e.ev.tokens, e.ev.isBuy, e.ts ?? now);
    const queue = this.pending.get(e.ev.mint);
    if (queue) {
      queue.push(e);
      return;
    }
    if (e.ev.kind === "create") {
      this.pending.set(e.ev.mint, [e]);
      void this.resolveCreate(e.ev.mint, now);
      return;
    }
    this.tape.apply(e.ev, e.ts ?? now, e.tx, e.block);
    if (e.ev.kind === "complete" && e.quote && this.tape.token(e.ev.mint)) void this.resolvePool(e.ev.mint, e.quote, e, now);
  }

  private async resolveCreate(mint: string, now: number): Promise<void> {
    let quote: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        quote = await this.quote(mint);
        break;
      } catch (error) {
        if (attempt === 2) this.opts.log(`[bsc] quote of ${mint} not read (${(error as Error).message?.slice(0, 80)}): taken as BNB`);
        else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    const queue = this.pending.get(mint) ?? [];
    this.pending.delete(mint);
    for (const e of queue) {
      const ev = e.ev.kind === "create" ? { ...e.ev, quote } : e.ev;
      // Backfilled logs carry their block's time; live ones are applied as they arrive.
      this.tape.apply(ev, e.ts ?? now, e.tx, e.block);
      if (e.ev.kind === "complete" && e.quote) void this.resolvePool(e.ev.mint, e.quote, e, now);
    }
  }

  /** Logs from `from` to `to`, in order, from the endpoint that still has them. Stops when its session is over. */
  private async fill(from: number, to: number, head: number, session: number): Promise<void> {
    let chunks = 0;
    for (let next = from; next <= to && !this.stopped && session === this.sessions; ) {
      const start = next;
      const near = head - start <= NEAR_HEAD;
      const url = near ? this.opts.rpcUrl : this.opts.logsUrl;
      const end = Math.min(to, start + (near ? CHUNK : LOGS_CHUNK));
      next = end + 1;
      let logs: EvmLog[] | null = null;
      for (let attempt = 0; attempt < 4 && logs === null; attempt++) {
        try {
          logs = await this.opts.rpc<EvmLog[]>(url, "eth_getLogs", [{ fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, address: TOKEN_MANAGER2 }]);
        } catch (error) {
          if (attempt === 3) throw error;
          await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
        }
      }
      // The socket may have died while the chunk was in flight: the next session reads on from the cursor.
      if (session !== this.sessions) return;
      for (const log of logs!) this.onLog(log);
      if (this.cursor === null || end > this.cursor) this.cursor = end;
      if (++chunks % 25 === 0) this.opts.log(`[bsc] backfill ${Math.round(((end - from) / Math.max(1, to - from)) * 100)}%: ${this.tape.status().tracked} tokens`);
    }
  }

  /** Reads two days of logs (or the gap since the cursor), then stays on the WebSocket, reconnecting with backoff. */
  start(): () => void {
    void this.run();
    // Two days is what the tape keeps: older tokens and their positions go, like the Solana tape's own pruner.
    this.pruner = setInterval(() => {
      this.tape.prune();
      this.book.prune();
    }, 10 * 60_000);
    this.pruner.unref?.();
    return () => {
      this.stopped = true;
      if (this.pruner) clearInterval(this.pruner);
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
        if (!this.stopped) this.opts.log(`[bsc] feed error: ${(error as Error).message?.slice(0, 200)}`);
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
        if (this.pairSub?.ws === ws) this.pairSub = null;
        if (this.transferSub?.ws === ws) this.transferSub = null;
        if (this.transferTimer) {
          clearInterval(this.transferTimer);
          this.transferTimer = null;
        }
        // A failed fill or subscribe must not leave the socket open behind the next one.
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        error ? reject(new Error(`${url}: ${error.message}`)) : resolve();
      };
      ws.onopen = () => {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["logs", { address: TOKEN_MANAGER2 }] }));
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
          // The pairs' subscription; its id is what a later resubscribe ends.
          if (!msg.error && this.pairSub?.ws === ws) this.pairSub.id = String(msg.result);
          return;
        }
        if (msg.id === 3 || msg.id === 5) return;
        if (msg.id === 4) {
          if (!msg.error && this.transferSub?.ws === ws) this.transferSub.id = String(msg.result);
          else if (msg.error) this.opts.log(`[bsc] transfers not followed: ${msg.error.message}`);
          return;
        }
        if (msg.id === 1) {
          if (msg.error) return done(new Error(`subscribe: ${msg.error.message}`));
          subscribed = true;
          this.pairSub = { ws, id: null, wanted: "" };
          this.followPairs();
          this.transferSub = { ws, id: null, wanted: -1 };
          this.followTransfers();
          if (this.transferTimer) clearInterval(this.transferTimer);
          this.transferTimer = setInterval(() => this.followTransfers(), 60_000);
          this.transferTimer.unref?.();
          void this.catchUp(session).then(() => {
            if (session !== this.sessions) return;
            const held = buffer ?? [];
            buffer = null;
            // What the fill also read is dropped by its transaction and log index.
            for (const log of held) this.onLog(log);
            this.backfilled = true;
            if (!this.connected) {
              this.connected = true;
              this.tape.connected = true;
              this.opts.log(`[bsc] four.meme stream live: ${this.tape.status().tracked} tokens on the tape`);
            }
          }, done);
          return;
        }
        const log = msg.params?.result;
        if (!log || !subscribed) return;
        if (this.pairs.has(log.address.toLowerCase())) return this.onPairLog(log);
        if (log.topics[0] === TRANSFER_TOPIC && log.address.toLowerCase() !== TOKEN_MANAGER2) return this.onTransferLog(log);
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
    if (head - from > NEAR_HEAD) this.opts.log(`[bsc] reading ${head - from} blocks of four.meme logs (${Math.round(((head - from) * BLOCK_MS) / 3_600_000)} h)`);
    await this.fill(from, head, head, session);
  }
}

/**
 * What four.meme itself says about a token: who launched it, when, its ticker, picture and links. Read for tokens the
 * tape never saw launch (older than two days), and for the picture on any X-Ray. Answers are kept; misses too, briefly.
 */
export interface FourMemeToken {
  creator: string;
  createdAt: number;
  name: string | null;
  symbol: string | null;
  image: string | null;
  /** The token it is sold for: BNB, or another token's symbol. */
  quote: string | null;
  holders: number | null;
  /** Curve progress 0..1 and the quote amount that graduates it. */
  progress: number | null;
  graduatesAt: number | null;
  graduated: boolean;
  links: { x: string | null; telegram: string | null; web: string | null };
}

const FOUR_API = "https://four.meme/meme-api/v1/private/token/get/v2";
const INFO_MS = 10 * 60_000;
const MISS_MS = 5 * 60_000;

export class FourMemeInfo {
  private readonly kept = new Map<string, { at: number; info: FourMemeToken | null }>();
  private readonly inflight = new Map<string, Promise<FourMemeToken | null>>();
  private readonly f: typeof fetch;
  constructor(f: typeof fetch = fetch) {
    this.f = f;
  }

  /** What is kept of a token right now, without asking. */
  peek(mint: string): FourMemeToken | null | undefined {
    return this.kept.get(mint.toLowerCase())?.info;
  }

  image(mint: string): string | undefined {
    return this.peek(mint)?.image ?? undefined;
  }

  /** Asks in the background so the next read has it; nothing when already kept. */
  want(mint: string, now = Date.now()): void {
    const hit = this.kept.get(mint.toLowerCase());
    if (hit && now - hit.at < (hit.info ? INFO_MS : MISS_MS)) return;
    void this.get(mint, now);
  }

  async get(mint: string, now = Date.now()): Promise<FourMemeToken | null> {
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

  private async read(mint: string): Promise<FourMemeToken | null> {
    const r = await this.f(`${FOUR_API}?address=${mint}`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (zooaiagency.com x-ray)" }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return null;
    const body = (await r.json()) as { code?: number; data?: Record<string, unknown> };
    const d = body.data;
    const creator = typeof d?.userAddress === "string" ? d.userAddress.toLowerCase() : null;
    const createdAt = Number(d?.createDate ?? d?.launchTime);
    if (!d || !creator || !/^0x[0-9a-f]{40}$/.test(creator) || !Number.isFinite(createdAt) || createdAt <= 0) return null;
    const price = (d.tokenPrice ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const n = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    return {
      creator,
      createdAt,
      name: s(d.name),
      symbol: s(d.shortName) ?? s(d.name),
      image: s(d.image),
      quote: s(d.symbol),
      holders: n(price.holderCount),
      progress: n(price.progress),
      graduatesAt: n(d.raisedAmount),
      graduated: Number(price.progress ?? 0) >= 1 || d.status === "LISTED" || d.status === "DEX",
      links: { x: s(d.twitterUrl), telegram: s(d.telegramUrl), web: s(d.webUrl) },
    };
  }
}

/** The one BNB Chain tape per node process, next to the Solana one. */
export const bscTape = new PumpTape("BNB");
export const fourMeme = new FourMemeInfo();
/** Who paid for which four.meme creator, through BscScan when a key is set. */
export const bscLineage = new BscLineage(bscTape);
/** The X accounts and Telegram groups four.meme launches point to, and their record, like the Solana registry. */
export const bscSocials = new SocialsRegistry(bscTape);

/** four.meme's record of a launch into the socials registry: its accounts and picture. Once per token. */
const recorded = new Set<string>();
export async function recordFourMeme(mint: string): Promise<void> {
  const key = mint.toLowerCase();
  if (recorded.has(key)) return;
  const info = await fourMeme.get(key);
  if (!info) return;
  recorded.add(key);
  if (recorded.size > 50_000) recorded.clear();
  bscSocials.recordMeta(key, { twitter: info.links.x ?? undefined, telegram: info.links.telegram ?? undefined, image: info.image ?? undefined });
}
