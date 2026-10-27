import { PumpTape, type PumpEvent } from "./pump.ts";
import { bscBook, type PositionBook } from "./bscHolders.ts";

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
}

const word = (data: string, i: number): bigint => BigInt(`0x${data.slice(2 + i * 64, 66 + i * 64)}`);
const addr = (data: string, i: number): string => `0x${data.slice(2 + i * 64 + 24, 66 + i * 64)}`.toLowerCase();
const num = (data: string, i: number): number => Number(word(data, i)) / WEI;
/** An ABI string: its offset word points at a length word, then the bytes. */
const str = (data: string, i: number): string => {
  const at = Number(word(data, i)) * 2;
  const len = Number(BigInt(`0x${data.slice(2 + at, 66 + at)}`));
  return Buffer.from(data.slice(66 + at, 66 + at + len * 2), "hex").toString("utf8");
};

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
      case TOPIC.liquidity:
        return { ...base, ev: { kind: "complete", mint: addr(d, 0) } };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export type Rpc = <T>(url: string, method: string, params: unknown[]) => Promise<T>;

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
  private readonly book: PositionBook;
  private pruner: ReturnType<typeof setInterval> | null = null;

  private readonly tape: PumpTape;

  constructor(tape: PumpTape, o: FeedOptions = {}) {
    this.tape = tape;
    this.cursor = o.cursor ?? null;
    this.opts = { wsUrl: o.wsUrl ?? DEFAULT_WS, rpcUrl: o.rpcUrl ?? DEFAULT_RPC, logsUrl: o.logsUrl ?? DEFAULT_LOGS, log: o.log ?? console.log, rpc: o.rpc ?? jsonRpc, WebSocketImpl: o.WebSocketImpl };
    this.quote = o.quoteOf ?? ((token) => quoteOf(token, this.opts.rpc, this.opts.rpcUrl));
    this.book = o.book ?? bscBook;
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
        if (msg.id === 1) {
          if (msg.error) return done(new Error(`subscribe: ${msg.error.message}`));
          subscribed = true;
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
