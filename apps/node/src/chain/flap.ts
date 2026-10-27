import type { PumpEvent, PumpTape } from "./pump.ts";
import { addr, type EvmLog, jsonRpc, num, type Rpc, str, topicAddr, TRANSFER_TOPIC, ZERO } from "./bsc.ts";
import type { PositionBook } from "./bscHolders.ts";

/**
 * Flap on BNB Chain, read into the same tape as four.meme. Flap's Portal writes a log for every launch, buy, sell and
 * move to PancakeSwap, and those become the tape's events.
 *
 * Two things the Portal's own logs do not say, and the chain does:
 * - who launched it. Most launches go through launcher bots, so the event's creator is a contract; the person is the
 *   wallet that signed the launch transaction.
 * - who traded. Most trades go through trading-bot routers, so the event's buyer is the router; the tokens move on
 *   from the router to the person in the same transaction. The token's own Transfers name them, and a buy split
 *   across several wallets (a bundle) becomes one trade per wallet.
 *
 * Live: the Portal and the Transfers of the tokens on the tape over a public WebSocket; a trade whose transfers did
 * not come with it gets them from its receipt. Backfill: 48.club serves the Portal's logs and the tokens' Transfers
 * for a thousand blocks at a time, many token addresses in one call.
 */

export const FLAP_PORTAL = "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0";

/** keccak256 of each event's signature. */
export const FLAP_TOPIC = {
  create: "0x504e7f360b2e5fe33cbaaae4c593bc55305328341bf79009e43e0e3b7f699603", // TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta)
  buy: "0xa800a2038683844fac66747f771bfdfae862eb28b16bcfa387afa9fbacce8ff7", // TokenBought(uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)
  sell: "0x03a4693e592f5e75dc7c136acb39b146d2b4966c0e509c34f362dee02b3b861a", // TokenSold(uint256 ts, address token, address seller, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)
  launched: "0x6e4f47630b8745b8cacbd44f42a8a33e7eea7cc08ef22fc7630f4f385784ff7d", // LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth)
  quote: "0x3ceb902d3c555c21c3415b6aa839104b18e4825b2f8324011ff979089a507a8c", // TokenQuoteSet(address token, address quoteToken)
  tax: "0x1546924f4680b1b2e093fd251c437c8781d81a21ed8ad1895e1f2c9b78db0cd0", // FlapTokenTaxSet(address token, uint256 tax)
  migrator: "0xcf2372b9357f0d392563d2cedb11e2b3bf0c14d2b8b75eb8bad073bbea9b0ff9", // TokenMigratorSet(address token, uint8 migratorType)
} as const;

/** Flap mints a billion of every token. */
export const FLAP_SUPPLY = 1_000_000_000;
export const DEFAULT_WS = "wss://bsc-rpc.publicnode.com,wss://bsc.publicnode.com";
export const DEFAULT_RPC = "https://bsc-rpc.publicnode.com";
/** Serves eth_getLogs two days back, a thousand blocks and many addresses a call. */
export const DEFAULT_LOGS = "https://rpc.48.club";
const BLOCK_MS = 750;
export const BACKFILL_BLOCKS = Math.round((48 * 3_600_000) / BLOCK_MS);
const LOGS_CHUNK = 999;
const STALL_MS = 5 * 60_000;
/** How long one transaction's logs wait for each other before its trades are read. */
const SETTLE_MS = 1_500;
/** The live Transfer subscription follows this many of the newest Flap tokens; older ones fall back to receipts. */
const FOLLOW_MAX = 4_000;
/** Receipts asked in one batch, and at most this many batches a second: 48.club answers 429 past that. */
const RECEIPTS_PER_BATCH = 20;
const RECEIPT_BATCHES_PER_SEC = 1;

/** A Flap launch, put together from the Portal's logs in its transaction. */
export interface FlapLaunch {
  mint: string;
  /** The Portal's creator field: often a launcher bot. */
  launcher: string;
  /** The wallet that signed the launch: the person. Null until read. */
  signer: string | null;
  name: string;
  symbol: string;
  meta: string;
  /** The token it is sold for; null for BNB. */
  quote: string | null;
  /** Tax in basis points, 0 for a plain token. */
  taxBps: number;
  /** 0: PancakeSwap V3, 1: V2 (every tax token), 2: Uniswap v4, 3: PancakeSwap Infinity. */
  migrator: number;
  ts: number | null;
  block: number;
  tx: string;
  logIndex: number;
}

export interface FlapTrade {
  mint: string;
  isBuy: boolean;
  /** The Portal's buyer or seller: often a router. */
  actor: string;
  tokens: number;
  /** Whole units of the quote. */
  quote: number;
  ts: number | null;
  block: number;
  tx: string;
  logIndex: number;
}

const word = (d: string, i: number) => d.slice(2 + i * 64, 66 + i * 64);
const big = (d: string, i: number) => BigInt(`0x${word(d, i)}`);

/** One Portal log, as the part of a launch or a trade it is; null for logs the zoo does not read. */
export function parseFlapLog(log: EvmLog): { kind: "create"; launch: FlapLaunch } | { kind: "trade"; trade: FlapTrade } | { kind: "quote" | "tax" | "migrator"; mint: string; value: string | number } | { kind: "launched"; mint: string; pool: string; ts: number | null; block: number; tx: string } | null {
  if (log.removed || log.address.toLowerCase() !== FLAP_PORTAL) return null;
  const d = log.data;
  const block = Number(log.blockNumber);
  const ts = log.blockTimestamp ? Number(log.blockTimestamp) * 1000 : null;
  try {
    switch (log.topics[0]) {
      case FLAP_TOPIC.create:
        return {
          kind: "create",
          launch: { mint: addr(d, 3), launcher: addr(d, 1), signer: null, name: str(d, 4).trim().slice(0, 64), symbol: str(d, 5).trim().slice(0, 32), meta: str(d, 6).trim().slice(0, 120), quote: null, taxBps: 0, migrator: 0, ts: ts ?? Number(big(d, 0)) * 1000, block, tx: log.transactionHash, logIndex: Number(log.logIndex) },
        };
      case FLAP_TOPIC.buy:
      case FLAP_TOPIC.sell:
        return { kind: "trade", trade: { mint: addr(d, 1), isBuy: log.topics[0] === FLAP_TOPIC.buy, actor: addr(d, 2), tokens: num(d, 3), quote: num(d, 4), ts: ts ?? Number(big(d, 0)) * 1000, block, tx: log.transactionHash, logIndex: Number(log.logIndex) } };
      case FLAP_TOPIC.quote: {
        const q = addr(d, 1);
        return { kind: "quote", mint: addr(d, 0), value: q === ZERO ? "" : q };
      }
      case FLAP_TOPIC.tax:
        return { kind: "tax", mint: addr(d, 0), value: Number(big(d, 1)) };
      case FLAP_TOPIC.migrator:
        return { kind: "migrator", mint: addr(d, 0), value: Number(big(d, 1)) };
      case FLAP_TOPIC.launched:
        return { kind: "launched", mint: addr(d, 0), pool: addr(d, 1), ts, block, tx: log.transactionHash };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

interface Transfer {
  token: string;
  from: string;
  to: string;
  amount: number;
}

/**
 * Who a Portal trade was really for: the wallets the token netted to (a buy) or from (a sell) in its transaction,
 * with the share of the trade each one took. The Portal, the token itself and the zero address are legs; a router that
 * passes the tokens on nets to nothing. Empty when the transaction moved none of the token.
 */
export function tradersOf(t: FlapTrade, transfers: Transfer[]): Array<{ wallet: string; share: number }> {
  const legs = new Set([FLAP_PORTAL, ZERO, t.mint]);
  const net = new Map<string, number>();
  for (const x of transfers) {
    if (x.token !== t.mint) continue;
    if (!legs.has(x.from)) net.set(x.from, (net.get(x.from) ?? 0) - x.amount);
    if (!legs.has(x.to)) net.set(x.to, (net.get(x.to) ?? 0) + x.amount);
  }
  const side = [...net].map(([w, n]) => [w, t.isBuy ? n : -n] as const).filter(([, n]) => n > 0);
  const total = side.reduce((a, [, n]) => a + n, 0);
  if (!total) return [];
  return side.sort((a, b) => b[1] - a[1]).map(([wallet, n]) => ({ wallet, share: n / total }));
}

interface Bucket {
  tx: string;
  block: number;
  at: number;
  launches: FlapLaunch[];
  trades: FlapTrade[];
  transfers: Transfer[];
  launched: Array<{ mint: string; pool: string; ts: number | null; block: number }>;
  /** The settings logs of a launch arrive after its create, in the same transaction. */
  settings: Array<{ kind: "quote" | "tax" | "migrator"; mint: string; value: string | number }>;
}

export interface FlapFeedOptions {
  wsUrl?: string;
  rpcUrl?: string;
  logsUrl?: string;
  cursor?: number | null;
  log?: (message: string) => void;
  rpc?: Rpc;
  /** Batches of JSON-RPC calls; replaceable in tests. */
  batch?: (url: string, calls: Array<{ method: string; params: unknown[] }>) => Promise<unknown[]>;
  book?: PositionBook;
  /** A graduation to a PancakeSwap V2 pair: the four.meme feed already follows those pairs. */
  onPair?: (mint: string, pool: string, quote: string | null, ts: number, tx: string, block: number) => void;
  onLaunch?: (launch: FlapLaunch) => void;
  WebSocketImpl?: typeof WebSocket;
}

export const jsonBatch = async (url: string, calls: Array<{ method: string; params: unknown[] }>): Promise<unknown[]> => {
  if (!calls.length) return [];
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c }))), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`batch: ${r.status}`);
  const body = (await r.json()) as Array<{ id: number; result?: unknown }>;
  if (!Array.isArray(body)) throw new Error("batch: not a batch answer");
  const byId = new Map(body.map((x) => [x.id, x.result ?? null]));
  return calls.map((_, i) => byId.get(i + 1) ?? null);
};

export class FlapFeed {
  cursor: number | null;
  connected = false;
  backfilled = false;
  /** Trades whose transfers named no wallet: the router stands in. */
  unnamed = 0;
  private stopped = false;
  private ws: WebSocket | null = null;
  private sessions = 0;
  private readonly seen = new Set<string>();
  private readonly buckets = new Map<string, Bucket>();
  /** Flap's tokens on the tape, with what their launch said; newest last. */
  readonly tokens = new Map<string, { quote: string | null; taxBps: number; migrator: number; at: number; launcher?: string; signer?: string | null }>();
  private transferSub: { ws: WebSocket; id: string | null; wanted: string } | null = null;
  /** When the next receipts batch may go, and how long to hold off after a 429. */
  private receiptsAt = 0;
  private busy = false;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private readonly opts: Required<Pick<FlapFeedOptions, "wsUrl" | "rpcUrl" | "logsUrl" | "log" | "rpc" | "batch">> & Pick<FlapFeedOptions, "book" | "onPair" | "onLaunch" | "WebSocketImpl">;
  private readonly tape: PumpTape;

  constructor(tape: PumpTape, o: FlapFeedOptions = {}) {
    this.tape = tape;
    this.cursor = o.cursor ?? null;
    this.opts = { wsUrl: o.wsUrl ?? DEFAULT_WS, rpcUrl: o.rpcUrl ?? DEFAULT_RPC, logsUrl: o.logsUrl ?? DEFAULT_LOGS, log: o.log ?? console.log, rpc: o.rpc ?? jsonRpc, batch: o.batch ?? jsonBatch, book: o.book, onPair: o.onPair, onLaunch: o.onLaunch, WebSocketImpl: o.WebSocketImpl };
    // Flap's tokens the tape kept across a restart are followed again.
    for (const m of tape.mints()) if (tape.venueOf(m) === "flap") this.tokens.set(m, { quote: tape.token(m)?.facts.quote ?? null, taxBps: 0, migrator: 1, at: 0 });
  }

  /** One log in: the Portal's or a followed token's Transfer, into its transaction's bucket. */
  onLog(log: EvmLog, now = Date.now()): void {
    if (log.removed) return;
    const key = `${log.transactionHash}:${Number(log.logIndex)}`;
    if (this.seen.has(key)) return;
    const address = log.address.toLowerCase();
    if (address === FLAP_PORTAL) {
      const p = parseFlapLog(log);
      if (!p) return;
      this.mark(key);
      const b = this.bucketOf(log.transactionHash, Number(log.blockNumber), now);
      if (p.kind === "create") b.launches.push(p.launch);
      else if (p.kind === "trade") b.trades.push(p.trade);
      else if (p.kind === "launched") b.launched.push({ mint: p.mint, pool: p.pool, ts: p.ts, block: p.block });
      else b.settings.push(p);
      return;
    }
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3 || log.data.length < 66) return;
    this.mark(key);
    const amount = num(log.data, 0);
    if (amount > 0) this.bucketOf(log.transactionHash, Number(log.blockNumber), now).transfers.push({ token: address, from: topicAddr(log.topics[1]!), to: topicAddr(log.topics[2]!), amount });
  }

  private mark(key: string): void {
    this.seen.add(key);
    if (this.seen.size > 60_000) for (const k of [...this.seen].slice(0, 30_000)) this.seen.delete(k);
  }

  private bucketOf(tx: string, block: number, now: number): Bucket {
    let b = this.buckets.get(tx);
    if (!b) {
      b = { tx, block, at: now, launches: [], trades: [], transfers: [], launched: [], settings: [] };
      this.buckets.set(tx, b);
    }
    return b;
  }

  /**
   * Reads every bucket old enough (all of them with `all`), oldest first. Launches need their signer, and trades
   * through a router whose transfers did not come with them need the receipt: both are asked in batches first.
   */
  async settle(now = Date.now(), all = false): Promise<void> {
    const due = [...this.buckets.values()].filter((b) => all || now - b.at >= SETTLE_MS).sort((a, b) => a.block - b.block);
    if (!due.length) return;
    for (const b of due) this.buckets.delete(b.tx);
    const signers = due.filter((b) => b.launches.length).map((b) => b.tx);
    // A launch's own buy names a token created in the same transaction: it counts as known.
    const bare = this.backfilled || !all ? due.filter((b) => b.trades.some((t) => !b.transfers.some((x) => x.token === t.mint) && (this.knows(t.mint) || b.launches.some((l) => l.mint === t.mint)))).map((b) => b.tx) : [];
    const [from, receipts] = await Promise.all([this.signersOf(signers), this.receiptsOf(bare)]);
    for (const b of due) {
      const r = receipts.get(b.tx);
      if (r) for (const log of r) if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3 && log.data.length >= 66) b.transfers.push({ token: log.address.toLowerCase(), from: topicAddr(log.topics[1]!), to: topicAddr(log.topics[2]!), amount: num(log.data, 0) });
      this.resolve(b, from.get(b.tx) ?? null, now);
    }
  }

  private knows(mint: string): boolean {
    return this.tokens.has(mint) || Boolean(this.tape.token(mint));
  }

  private async signersOf(txs: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < txs.length; i += RECEIPTS_PER_BATCH) {
      const part = txs.slice(i, i + RECEIPTS_PER_BATCH);
      try {
        // 48.club answers transaction and receipt lookups in batches; publicnode serves no receipts on BNB Chain.
        const got = (await this.opts.batch(this.opts.logsUrl, part.map((tx) => ({ method: "eth_getTransactionByHash", params: [tx] })))) as Array<{ from?: string } | null>;
        got.forEach((t, k) => t?.from && out.set(part[k]!, t.from.toLowerCase()));
      } catch (error) {
        this.opts.log(`[flap] signers not read: ${(error as Error).message?.slice(0, 80)}`);
      }
    }
    return out;
  }

  private async receiptsOf(txs: string[]): Promise<Map<string, EvmLog[]>> {
    const out = new Map<string, EvmLog[]>();
    for (let i = 0; i < txs.length; i += RECEIPTS_PER_BATCH) {
      // Paced: a burst past the endpoint's limit loses the batch anyway. Trades left over are read under their router.
      const wait = this.receiptsAt - Date.now();
      if (wait > 2_000) break;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.receiptsAt = Date.now() + 1_000 / RECEIPT_BATCHES_PER_SEC;
      const part = txs.slice(i, i + RECEIPTS_PER_BATCH);
      try {
        const got = (await this.opts.batch(this.opts.logsUrl, part.map((tx) => ({ method: "eth_getTransactionReceipt", params: [tx] })))) as Array<{ logs?: EvmLog[] } | null>;
        got.forEach((r, k) => r?.logs && out.set(part[k]!, r.logs));
      } catch (error) {
        const msg = (error as Error).message ?? "";
        if (/429/.test(msg)) this.receiptsAt = Date.now() + 10_000;
        else this.opts.log(`[flap] receipts not read: ${msg.slice(0, 80)}`);
      }
    }
    return out;
  }

  /** One transaction: its launches onto the tape, then its trades by the wallets the transfers name, then any graduation. */
  private resolve(b: Bucket, signer: string | null, now: number): void {
    for (const l of b.launches) {
      for (const s of b.settings) {
        if (s.mint !== l.mint) continue;
        if (s.kind === "quote") l.quote = (s.value as string) || null;
        else if (s.kind === "tax") l.taxBps = s.value as number;
        else l.migrator = s.value as number;
      }
      l.signer = signer;
      if (this.tape.token(l.mint)) continue;
      const ev: Extract<PumpEvent, { kind: "create" }> = { kind: "create", creator: signer ?? l.launcher, mint: l.mint, name: l.name, symbol: l.symbol, ts: l.ts, venue: "flap", quote: l.quote, supply: FLAP_SUPPLY, ...(l.meta ? { uri: `https://flap.mypinata.cloud/ipfs/${l.meta}` } : {}), ...(l.taxBps ? { platform: `tax ${l.taxBps / 100}%` } : {}) };
      this.tape.apply(ev, l.ts ?? now, l.tx, l.block);
      this.tokens.set(l.mint, { quote: l.quote, taxBps: l.taxBps, migrator: l.migrator, at: l.ts ?? now, launcher: l.launcher, signer });
      this.opts.onLaunch?.(l);
    }
    for (const t of b.trades.sort((x, y) => x.logIndex - y.logIndex)) {
      if (!this.tape.token(t.mint)) continue;
      const who = tradersOf(t, b.transfers);
      if (!who.length) this.unnamed += 1;
      const ts = t.ts ?? now;
      // A launcher bot that keeps the launch's first buy holds it for the dev who signed the launch: it is the dev's.
      const info = this.tokens.get(t.mint);
      const own = (w: string) => (info?.signer && info.launcher && w === info.launcher && info.launcher !== info.signer ? info.signer : w);
      for (const { wallet: w, share } of who.length ? who : [{ wallet: t.actor, share: 1 }]) {
        const wallet = own(w);
        this.tape.apply({ kind: "trade", mint: t.mint, user: wallet, isBuy: t.isBuy, tokens: t.tokens * share, sol: t.quote * share, ts, curveSol: null }, ts, t.tx, t.block);
        this.opts.book?.note(t.mint, wallet, t.tokens * share, t.isBuy, ts);
      }
    }
    // Transfers of a Flap token outside any trade: a plain move between wallets.
    const traded = new Set(b.trades.map((t) => t.mint));
    for (const x of b.transfers) {
      if (traded.has(x.token) || !this.tokens.has(x.token)) continue;
      if (x.from === FLAP_PORTAL || x.to === FLAP_PORTAL || x.from === ZERO || x.to === ZERO || x.from === x.token || x.to === x.token || x.from === x.to) continue;
      this.opts.book?.move(x.token, x.from, x.to, x.amount, now);
    }
    for (const g of b.launched) {
      if (!this.tape.token(g.mint)) continue;
      const info = this.tokens.get(g.mint);
      const ts = g.ts ?? now;
      this.tape.apply({ kind: "complete", mint: g.mint }, ts, b.tx, g.block);
      // A V2 pair is followed for its swaps; a V3 or Infinity pool is only marked as graduated for now.
      if ((info?.migrator ?? 1) === 1 && g.pool !== ZERO) this.opts.onPair?.(g.mint, g.pool, info?.quote ?? null, ts, b.tx, g.block);
    }
  }

  /** The newest Flap tokens on the tape, for the live Transfer subscription. */
  private followed(): string[] {
    return [...this.tokens].filter(([m]) => this.tape.token(m)).sort((a, b) => b[1].at - a[1].at).slice(0, FOLLOW_MAX).map(([m]) => m);
  }

  private followTransfers(): void {
    const sub = this.transferSub;
    if (!sub || sub.ws.readyState !== 1) return;
    const mints = this.followed();
    const wanted = `${mints.length}:${mints[0] ?? ""}`;
    if (wanted === sub.wanted) return;
    sub.wanted = wanted;
    if (sub.id) sub.ws.send(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "eth_unsubscribe", params: [sub.id] }));
    sub.id = null;
    if (!mints.length) return;
    sub.ws.send(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "eth_subscribe", params: ["logs", { address: mints, topics: [TRANSFER_TOPIC] }] }));
  }

  private async getLogs(filter: Record<string, unknown>): Promise<EvmLog[]> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.opts.rpc<EvmLog[]>(this.opts.logsUrl, "eth_getLogs", [filter]);
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
      }
    }
  }

  /** The Portal's logs for a range, then the Transfers of every Flap token traded in it, then all of it read in order. */
  private async fill(from: number, to: number, session: number): Promise<void> {
    let chunks = 0;
    for (let next = from; next <= to && !this.stopped && session === this.sessions; ) {
      const start = next;
      const end = Math.min(to, start + LOGS_CHUNK);
      next = end + 1;
      const range = { fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` };
      const portal = await this.getLogs({ ...range, address: FLAP_PORTAL });
      if (session !== this.sessions) return;
      const traded = new Set<string>();
      for (const log of portal) {
        this.onLog(log);
        if (log.topics[0] === FLAP_TOPIC.buy || log.topics[0] === FLAP_TOPIC.sell || log.topics[0] === FLAP_TOPIC.create) traded.add(addr(log.data, log.topics[0] === FLAP_TOPIC.create ? 3 : 1));
      }
      const mints = [...traded];
      for (let i = 0; i < mints.length; i += 400) {
        try {
          const transfers = await this.getLogs({ ...range, address: mints.slice(i, i + 400), topics: [TRANSFER_TOPIC] });
          if (session !== this.sessions) return;
          for (const log of transfers) this.onLog(log);
        } catch (error) {
          this.opts.log(`[flap] transfers ${start}..${end} not read: ${(error as Error).message?.slice(0, 80)}`);
        }
      }
      await this.settle(Date.now(), true);
      if (this.cursor === null || end > this.cursor) this.cursor = end;
      if (++chunks % 25 === 0) this.opts.log(`[flap] backfill ${Math.round(((end - from) / Math.max(1, to - from)) * 100)}%: ${this.tokens.size} Flap tokens`);
    }
  }

  start(): () => void {
    void this.run();
    // Live only: during the backfill each chunk settles its own transactions once their transfers are in.
    const settle = setInterval(() => {
      if (!this.backfilled || this.busy) return;
      this.busy = true;
      void this.settle()
        .catch(() => {})
        .finally(() => (this.busy = false));
    }, 500);
    settle.unref?.();
    // The tape's own pruner (run by the four.meme feed) lets old tokens go; their entries here go with them.
    const prune = setInterval(() => {
      for (const m of this.tokens.keys()) if (!this.tape.token(m)) this.tokens.delete(m);
    }, 10 * 60_000);
    prune.unref?.();
    this.timers.push(settle, prune);
    return () => {
      this.stopped = true;
      for (const t of this.timers) clearInterval(t);
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
        if (!this.stopped) this.opts.log(`[flap] feed error: ${(error as Error).message?.slice(0, 200)}`);
      }
      this.connected = false;
      if (this.stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  }

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
      let follow: ReturnType<typeof setInterval> | null = null;
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
        if (follow) clearInterval(follow);
        if (this.ws === ws) this.ws = null;
        if (this.transferSub?.ws === ws) this.transferSub = null;
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        error ? reject(new Error(`${url}: ${error.message}`)) : resolve();
      };
      ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["logs", { address: FLAP_PORTAL }] }));
      ws.onmessage = (m) => {
        heard = Date.now();
        let msg: { id?: number; result?: unknown; error?: { message?: string }; params?: { result?: EvmLog } };
        try {
          msg = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (msg.id === 5) return;
        if (msg.id === 4) {
          if (!msg.error && this.transferSub?.ws === ws) this.transferSub.id = String(msg.result);
          else if (msg.error) this.opts.log(`[flap] transfers not followed: ${msg.error.message}`);
          return;
        }
        if (msg.id === 1) {
          if (msg.error) return done(new Error(`subscribe: ${msg.error.message}`));
          subscribed = true;
          this.transferSub = { ws, id: null, wanted: "" };
          this.followTransfers();
          follow = setInterval(() => this.followTransfers(), 60_000);
          follow.unref?.();
          void this.catchUp(session).then(() => {
            if (session !== this.sessions) return;
            const held = buffer ?? [];
            buffer = null;
            for (const log of held) this.onLog(log);
            this.backfilled = true;
            this.followTransfers();
            if (!this.connected) {
              this.connected = true;
              this.opts.log(`[flap] Flap stream live: ${this.tokens.size} Flap tokens on the tape`);
            }
          }, done);
          return;
        }
        const log = msg.params?.result;
        if (!log || !subscribed) return;
        if (buffer) buffer.push(log);
        else {
          this.onLog(log);
          const block = Number(log.blockNumber);
          if (log.address.toLowerCase() === FLAP_PORTAL && block > (this.cursor ?? 0)) this.cursor = block;
        }
      };
      ws.onerror = () => done(new Error("socket error"));
      ws.onclose = () => done(this.stopped ? undefined : new Error("socket closed"));
    });
  }

  private async catchUp(session: number): Promise<void> {
    const head = Number(await this.opts.rpc<string>(this.opts.rpcUrl, "eth_blockNumber", []));
    if (!Number.isFinite(head) || head <= 0) throw new Error("no block height");
    const from = Math.max(this.cursor === null ? 0 : this.cursor + 1, head - BACKFILL_BLOCKS);
    if (from > head) return;
    if (head - from > 3_000) this.opts.log(`[flap] reading ${head - from} blocks of Flap logs (${Math.round(((head - from) * BLOCK_MS) / 3_600_000)} h)`);
    await this.fill(from, head, session);
  }
}

/** Flap's metadata of a launch: its X, Telegram and website, and the picture as a URL a browser loads. */
export async function flapMeta(uri: string, f: typeof fetch = fetch): Promise<{ twitter?: string; telegram?: string; image?: string } | null> {
  const r = await f(uri, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!r.ok) return null;
  const m = (await r.json()) as { twitter?: unknown; telegram?: unknown; image?: unknown };
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const image = s(m.image);
  return { twitter: s(m.twitter), telegram: s(m.telegram), image: image ? (/^https?:\/\//.test(image) ? image : `https://flap.mypinata.cloud/ipfs/${image.replace(/^ipfs:\/\//, "")}`) : undefined };
}
