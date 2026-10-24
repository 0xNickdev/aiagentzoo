/**
 * The pump.fun tape: every launch and trade on the bonding curve, read straight from Solana as it happens.
 *
 * A Yellowstone gRPC stream delivers every transaction that touches the pump.fun program or PumpSwap. Its logs
 * carry Anchor events (create, trade, complete; pool created, buy, sell); we decode the fields we need and keep a
 * rolling 48-hour picture per token: who launched it, how many bought and sold, whether the creator already dumped
 * their bag, and once it graduates, how its PumpSwap pool is doing.
 * Without a stream configured, nothing here runs and the agents fall back to the pump.fun HTTP API.
 */
import { DBC_PROGRAM, fromYellowstone, LAUNCHLAB_PROGRAM, parseLaunchpads, type YellowstoneTx } from "./launchpads.ts";
import { solUsd } from "./price.ts";
import { isOnCurve } from "./curve.ts";
import { curveCapOf, CURVE_ALIVE_SOL, CURVE_DEAD_SOL, POOL_ALIVE_SOL, POOL_DEAD_SOL } from "../agents/judgement.ts";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
/** PumpSwap, where a token's pool lives once it graduates from the curve. */
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const WSOL = "So11111111111111111111111111111111111111112";

const DISC = {
  create: Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]),
  trade: Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]),
  complete: Buffer.from([95, 114, 97, 156, 212, 46, 152, 8]),
  // PumpSwap events: a pool is created when a token graduates, then buys and sells on it.
  pool: Buffer.from([177, 49, 12, 210, 160, 118, 167, 116]),
  ammBuy: Buffer.from([103, 244, 82, 31, 44, 245, 119, 119]),
  ammSell: Buffer.from([62, 47, 55, 10, 165, 3, 220, 42]),
};

/** Where a token was launched, when not pump.fun. */
export type Venue = "launchlab" | "dbc";

/** A trade on a followed pool, as the buy bot reads it. */
export interface FollowedSwap {
  seq: number;
  mint: string;
  pool: string;
  isBuy: boolean;
  sol: number;
  tokens: number;
  user: string;
  ts: number;
  poolSol: number;
  tx: string | null;
}

export type PumpEvent =
  /** quote: the token it trades against when that is not SOL (pump.fun's CreateV2 can pair a launch with any token). */
  | {
      kind: "create";
      name: string;
      symbol: string;
      mint: string;
      creator: string;
      ts: number | null;
      quote?: string | null;
      mayhem?: boolean;
      /** Launched somewhere other than pump.fun: Raydium LaunchLab or Meteora's bonding curve. */
      venue?: Venue;
      /** The platform built on the launchpad, when it is one we know (StonkFun on LaunchLab). */
      platform?: string;
      /** The whole supply, when it is not pump.fun's billion. */
      supply?: number;
      /** Where the token's metadata lives (its X, Telegram, website). */
      uri?: string;
    }
  | { kind: "trade"; mint: string; sol: number; tokens: number; isBuy: boolean; user: string; ts: number; curveSol: number | null }
  | { kind: "complete"; mint: string }
  /** A PumpSwap pool against SOL was created for this token: it graduated. */
  | { kind: "pool"; mint: string; pool: string }
  /** A buy or sell on a PumpSwap pool. Its event names only the pool, so the tape maps it back to a token. */
  | { kind: "swap"; pool: string; isBuy: boolean; sol: number; tokens: number; user: string; ts: number; poolSol: number };

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function fromBase58(s: string): Buffer {
  let n = 0n;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("not base58");
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

const LAMPORTS = 1e9;
/** pump.fun tokens have 6 decimals. */
const TOKEN_UNITS = 1e6;

export class Reader {
  o = 0;
  private readonly b: Buffer;
  constructor(b: Buffer) {
    this.b = b;
  }
  left = () => this.b.length - this.o;
  str() {
    const len = this.b.readUInt32LE(this.o);
    this.o += 4;
    if (len > 200 || this.o + len > this.b.length) throw new Error("bad string");
    const s = this.b.toString("utf8", this.o, this.o + len);
    this.o += len;
    return s;
  }
  key() {
    const k = this.b.subarray(this.o, this.o + 32);
    if (k.length < 32) throw new Error("short key");
    this.o += 32;
    return k;
  }
  u64() {
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return v;
  }
  i64() {
    const v = this.b.readBigInt64LE(this.o);
    this.o += 8;
    return v;
  }
  skip(n: number) {
    if (this.o + n > this.b.length) throw new Error("short");
    this.o += n;
  }
  bool() {
    return this.b[this.o++] === 1;
  }
  b8() {
    if (this.o >= this.b.length) throw new Error("short");
    return this.b[this.o++]!;
  }
}

/**
 * Decodes the pump.fun events in a transaction's logs. Only the leading fields of each event are read,
 * so fields the program appends later do not break us. Malformed data is skipped, never thrown.
 */
export function parsePumpLogs(logs: readonly string[]): PumpEvent[] {
  const out: PumpEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    let b: Buffer;
    try {
      b = Buffer.from(line.slice(14), "base64");
    } catch {
      continue;
    }
    if (b.length < 8) continue;
    const head = b.subarray(0, 8);
    try {
      const r = new Reader(b.subarray(8));
      if (head.equals(DISC.create)) {
        const name = r.str();
        const symbol = r.str();
        const uri = r.str();
        const mint = r.key();
        r.key(); // bonding curve
        const user = r.key();
        // Newer versions add the creator and a timestamp; older ones stop at the user, who is the creator.
        const named = r.left() >= 32 ? r.key() : user;
        // A launch can name some other address as creator (a fee recipient, not a wallet anyone trades from); the
        // signer is the one who buys and sells, so an off-curve name gives way to the signer.
        const creator = !named.equals(user) && !isOnCurve(named) ? user : named;
        const ts = r.left() >= 8 ? Number(r.i64()) * 1000 : null;
        // CreateV2 goes on: four reserves, the token program, is_mayhem_mode, is_cashback_enabled, then the quote mint.
        let quote: string | null = null;
        let mayhem = false;
        if (r.left() >= 4 * 8 + 32 + 2 + 32) {
          for (let i = 0; i < 4; i++) r.u64();
          r.key(); // token program
          mayhem = r.bool();
          r.skip(1);
          const q = base58(r.key());
          if (q !== WSOL && !/^1+$/.test(q)) quote = q;
        }
        out.push({ kind: "create", name: name.slice(0, 64), symbol: symbol.slice(0, 32), mint: base58(mint), creator: base58(creator), ts, ...(quote ? { quote } : {}), ...(mayhem ? { mayhem } : {}), ...(uri ? { uri: uri.slice(0, 200) } : {}) });
      } else if (head.equals(DISC.trade)) {
        const mint = r.key();
        const sol = Number(r.u64()) / LAMPORTS;
        const tokens = Number(r.u64()) / TOKEN_UNITS;
        const isBuy = r.bool();
        const user = r.key();
        const ts = Number(r.i64()) * 1000;
        let curveSol: number | null = null;
        if (r.left() >= 24) {
          r.u64(); // virtual sol
          r.u64(); // virtual tokens
          curveSol = Number(r.u64()) / LAMPORTS; // real sol in the curve
        }
        out.push({ kind: "trade", mint: base58(mint), sol, tokens, isBuy, user: base58(user), ts, curveSol });
      } else if (head.equals(DISC.complete)) {
        r.key(); // user
        out.push({ kind: "complete", mint: base58(r.key()) });
      } else if (head.equals(DISC.pool)) {
        r.i64(); // timestamp
        r.skip(2); // index
        r.key(); // creator
        const mint = base58(r.key());
        const quote = base58(r.key());
        r.skip(2); // decimals
        for (let i = 0; i < 7; i++) r.u64(); // amounts in, reserves, liquidity
        r.skip(1); // bump
        const pool = base58(r.key());
        if (quote === WSOL) out.push({ kind: "pool", mint, pool });
      } else if (head.equals(DISC.ammBuy) || head.equals(DISC.ammSell)) {
        // timestamp, then 13 u64: base amount, quote limit, user and pool reserves, quote amount, fees, what the user paid or got.
        // The reserves are read before the swap; what moves the pool's SOL is the quote amount with the LP fee (f[11]).
        const ts = Number(r.i64()) * 1000;
        const f: bigint[] = [];
        for (let i = 0; i < 13; i++) f.push(r.u64());
        const pool = base58(r.key());
        const user = base58(r.key());
        const isBuy = head.equals(DISC.ammBuy);
        const [reserve, moved] = [f[5]!, f[11]!];
        const poolSol = Math.max(0, Number(isBuy ? reserve + moved : reserve - moved) / LAMPORTS);
        out.push({ kind: "swap", pool, isBuy, tokens: Number(f[0]) / TOKEN_UNITS, sol: Number(f[12]) / LAMPORTS, poolSol, user, ts });
      }
    } catch {
      // A truncated or unfamiliar event: skip it.
    }
  }
  return out;
}

/** What the chain says about a token, as of now. */
export interface ChainFacts {
  /** Minutes since launch. */
  ageMin: number;
  /** Launched in Mayhem Mode: pump.fun's bot trades it for its first 24 hours, so its volume and churn are partly that bot. */
  mayhem?: boolean;
  /** Launched on Raydium LaunchLab or Meteora's bonding curve; absent for pump.fun. */
  venue?: Venue;
  /** The platform on that launchpad, when known: StonkFun on LaunchLab. */
  platform?: string;
  /** The token it trades against when not SOL; then solIn, solOut and curveSol are not in SOL (curveSol stays null). */
  quote?: string | null;
  buys: number;
  sells: number;
  /** Distinct wallets that bought on the curve, counted up to 5,000 (then buyersMore is true). */
  buyers: number;
  /** True when there were more buyers than the tape counts. */
  buyersMore?: boolean;
  solIn: number;
  solOut: number;
  /** SOL sitting in the bonding curve right now. */
  curveSol: number | null;
  /** Share of the creator's own bought tokens they have sold, 0..1; null if the creator never bought. */
  creatorSold: number | null;
  /** Tokens this creator launched in the last 24 hours, this one included. */
  creatorLaunches24h: number;
  graduated: boolean;
  /** Share of all SOL bought in that came from the five biggest buyers, 0..1: a few wallets propping it up. */
  top5Share: number | null;
  /** Buyers who came back and bought again (among the first 100): real interest leaves repeat buyers. */
  repeatBuyers: number;
  /** Trades in the first 15 minutes after launch. */
  trades15m: number;
  /** Wallets other than the creator that bought in the launch block or the next: a bundle. Null when the stream gave no slots. */
  bundleWallets: number | null;
  /** Share of the whole supply those wallets took, 0..1. */
  bundleShare: number | null;
  /** Wallets that bought it in blocks of four or more buyers, at any point of its life; what they hold now and held at most, of the supply. */
  bundlers?: number;
  bundlersHeld?: number;
  bundlersPeak?: number;
  bundledSol?: number | null;
  /** Set when the token is older than the bundle reader: bundles are counted from this time only. */
  bundlesSince?: number | null;
  /** After graduation, on PumpSwap: SOL in the pool now, null before it has one. */
  poolSol: number | null;
  ammBuys: number;
  ammSells: number;
  ammSolIn: number;
  ammSolOut: number;
  /** Wallets other than the creator that bought in the first 5 seconds: snipers and the bundle together. */
  earlyWallets?: number;
  /** Share of the supply those wallets bought, 0..1. */
  earlyShare?: number;
  /** Share of the supply they still hold from the curve and pool trades the tape saw, 0..1 (tokens moved out by transfer still count). */
  earlyHeld?: number;
  /** Share of curve volume (SOL in and out) from wallets that bought and sold it back, three trades or more: churn, not holders. 0..1, a floor. */
  washShare?: number;
  /** Times a wallet bought and sold in the same transaction: a bump bot keeping the token on the front page. */
  bumps?: number;
  /** Early wallets that also bought in the first seconds of two or more of this creator's other launches: the creator's own crew. */
  creatorCrew?: number;
  /** Early wallets that sniped three or more other launches together with another early wallet here: a ring. */
  ringWallets?: number;
  /** Early wallets that sniped ten or more launches in two days: professional snipers waiting to sell. */
  serialSnipers?: number;
  /** Share of the supply the creator's crew and ring wallets still hold, 0..1, from the trades the tape saw. */
  crewHeld?: number;
  /** Its pool fell to a fifth of its best after graduation: the liquidity left. */
  drained?: boolean;
}

/** pump.fun mints a billion tokens. */
const SUPPLY = 1_000_000_000;
/** In Mayhem Mode pump.fun's own bot mints a second billion to trade with for the first 24 hours. */
const supplyOf = (t: { mayhem?: boolean; supply?: number }) => t.supply ?? (t.mayhem ? 2 * SUPPLY : SUPPLY);
/** A token's caps in dollars at today's SOL price, and how it moved after the dev's dump. */
export function capsFrom(c: { capFirst?: number | null; capPeak?: number | null; capPeakAt?: number | null; capDump?: number | null; capLow?: number | null; capHigh?: number | null; devFirstSellAt?: number | null; createdAt: number }) {
  const usd = solUsd();
  const $ = (sol: number | null | undefined) => (usd && sol ? Math.round(sol * usd) : null);
  const sec = (at: number | null | undefined) => (at === null || at === undefined ? null : Math.max(0, Math.round((at - c.createdAt) / 1000)));
  return {
    firstCapUsd: $(c.capFirst),
    peakCapUsd: $(c.capPeak),
    peakAfterSec: c.capPeak ? sec(c.capPeakAt) : null,
    dumpCapUsd: $(c.capDump),
    afterDumpLowPct: c.capDump && c.capLow ? Math.round((c.capLow / c.capDump - 1) * 100) / 100 : null,
    afterDumpHighX: c.capDump && c.capHigh ? Math.round((c.capHigh / c.capDump) * 100) / 100 : null,
    devFirstSellSec: sec(c.devFirstSellAt),
  };
}
const capsOf = (t: Tracked) => capsFrom(t);

/** How long after a dump the price is still watched: what buyers who stayed went through. */
const AFTER_DUMP_MS = 30 * 60_000;
/** A buy this many slots after the create still counts as part of the launch bundle. */
const BUNDLE_SLOTS = 1;
/** Four or more wallets buying in one block is a bundle, whenever it happens. */
const BUNDLE_MIN = 4;
/** ...and together take at least half a percent of the supply in that block. */
const BUNDLE_MIN_SHARE = 0.005;
const BUNDLERS_MAX = 3_000;

type Crew = { creatorCrew: number; ringWallets: number; serialSnipers: number };
type CrewMembers = { crew: Set<string>; ring: Set<string>; serial: Set<string> };

/** One of a token's first 100 buyers, as the tape saw them trade it. */
interface Buyer {
  sol: number;
  buys: number;
  /** Tokens bought, tokens sold back, SOL taken out, trades in all, and when they first bought (ms). Older snapshots lack them. */
  tok?: number;
  sold?: number;
  out?: number;
  trades?: number;
  at?: number;
  /** When they had sold back nine tenths of what they bought. */
  exitAt?: number;
  /** The most they held at once. A bot that buys and sells it back over and over buys more than the supply in all; this is what it actually took. */
  peak?: number;
}

const notePeak = (b: Buyer) => {
  const pos = (b.tok ?? 0) - (b.sold ?? 0);
  if (pos > (b.peak ?? 0)) b.peak = pos;
};
/** What a first buyer took: the most they held at once (older snapshots only have the total bought). */
const tookOf = (b: Buyer, supply: number) => Math.min(b.peak ?? b.tok ?? 0, supply);

interface Tracked {
  mint: string;
  /** The token it trades against when not SOL; its amounts below are then in that token, not SOL. */
  quote?: string | null;
  /** Launched in Mayhem Mode: two billion supply, and pump.fun's bot trades it for a day. */
  mayhem?: boolean;
  /** Launched on Raydium LaunchLab or Meteora's bonding curve instead of pump.fun. */
  venue?: Venue;
  platform?: string;
  /** The whole supply, when it is not pump.fun's billion. */
  supply?: number;
  /** Where its metadata lives. */
  uri?: string;
  name: string;
  symbol: string;
  creator: string;
  createdAt: number;
  buys: number;
  sells: number;
  buyers: Map<string, Buyer>;
  /** Buyers past the first 100, kept only as 32-bit hashes so a busy token still gets a true count. */
  moreBuyers?: Set<number>;
  trades15m: number;
  solIn: number;
  solOut: number;
  curveSol: number | null;
  devBought: number;
  devSold: number;
  /** SOL the creator put in and took out, curve and pool; absent on tokens first seen before it was counted. */
  devIn?: number;
  devOut?: number;
  /** Wallets other than the creator still holding when the creator dumped: the people left with the bag. */
  heldAtDump?: number;
  /** When the creator first sold anything. */
  devFirstSellAt?: number;
  /**
   * Market cap in SOL, from each trade's price: the most in the first second, the peak and when, at the creator's
   * dump, and the lowest and highest in the 30 minutes after it. Absent on tokens first seen before caps were kept.
   */
  capFirst?: number;
  capPeak?: number;
  capPeakAt?: number;
  capDump?: number;
  capLow?: number;
  capHigh?: number;
  graduated: boolean;
  /** The creator has sold half of what they bought; announced once. */
  dumped: boolean;
  /** When that happened. */
  dumpedAt: number | null;
  /** The slot the token was created in, when the stream says. */
  createSlot: number | null;
  /** Tokens each non-creator wallet bought in the launch block or the next. */
  launchBuys: Map<string, number>;
  /** Its PumpSwap pool, once graduated. */
  pool: string | null;
  poolSol: number | null;
  /** The most SOL its pool has held; a pool that falls far below it was drained. */
  poolPeak: number | null;
  drained: boolean;
  ammBuys: number;
  ammSells: number;
  ammSolIn: number;
  ammSolOut: number;
  /** Same-transaction buy and sell by one wallet, counted. */
  bumps?: number;
  /** The last curve trade, to spot a buy and a sell in one transaction. Not saved. */
  last?: { tx: string; user: string; isBuy: boolean };
  /** The early and churn numbers as they stood five minutes in, for the check's own record. */
  at5?: { earlyHeld: number; earlyWallets: number; washShare: number; bumps: number; creatorCrew?: number; ringWallets?: number; at?: number };
  /** Crew and ring counts, worked out at most once a minute. Not saved. */
  crew?: { at: number; counts: Crew; members: CrewMembers };
  /**
   * Bundlers: wallets that bought it in a block where four or more wallets bought at once, at any point of its life,
   * on the curve or in the pool. What each bought and sold since, the SOL they put in, and the most they held together.
   */
  bundlers?: Map<string, { tok: number; sold: number }>;
  bundledSol?: number;
  bundleHeld?: number;
  bundlePeak?: number;
  /** The block being read and who bought in it. Not saved. */
  bslot?: number;
  bpend?: Map<string, { tok: number; sol: number }>;
}

/** What the tape knows about one creator wallet over the last two days. */
export interface CreatorRecord {
  wallet: string;
  launches24h: number;
  launches48h: number;
  /** Of those, how many the creator sold half or more of their own bag in. */
  dumped: number;
  /** Median minutes from launch to that sale. */
  medianDumpMin: number | null;
  graduated: number;
  recent: LaunchOutcome[];
  /** What this dev's launches usually do, from as many as are known; null with too few to say. */
  pattern?: DevPattern | null;
  /** Tickers launched more than once: a dev relaunching PAW again and again. */
  repeats?: Array<{ symbol: string; n: number }>;
  /** Launches a day while active, and days since the last one. */
  tempo?: { perDay: number; idleDays: number };
}

/** A dev's habits, medians over their launches with the number each rests on. Describes, never recommends. */
export interface DevPattern {
  /** Launches with a known peak: the ones the medians rest on. */
  launches: number;
  /** Market caps in dollars at today's SOL price. */
  firstCapUsd: number | null;
  peakCapUsd: number | null;
  /** Peak over first-second cap. */
  upsideX: number | null;
  peakAfterSec: number | null;
  /** Share of launches whose peak reached $20K, over those with a known peak. */
  reached20k: number | null;
  firstSellSec: number | null;
  /** Of launches with a dev dump: cap where they dumped, how far it fell in the next 30 minutes, how often it doubled. */
  dumpCapUsd: number | null;
  afterDumpLowPct: number | null;
  afterDumpDoubled: number | null;
  dumps: number;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Medians over a dev's launches; needs at least two with prices to say anything. */
export function devPattern(list: LaunchOutcome[]): DevPattern | null {
  const priced = list.filter((x) => x.peakCapUsd !== null && x.peakCapUsd !== undefined);
  if (priced.length < 2) return null;
  const dumped = list.filter((x) => x.dumpCapUsd !== null && x.dumpCapUsd !== undefined && x.afterDumpLowPct !== null && x.afterDumpLowPct !== undefined);
  const ups = priced.filter((x) => x.firstCapUsd).map((x) => x.peakCapUsd! / x.firstCapUsd!);
  const round = (v: number | null, k = 1) => (v === null ? null : Math.round(v * k) / k);
  return {
    launches: priced.length,
    firstCapUsd: round(median(priced.filter((x) => x.firstCapUsd).map((x) => x.firstCapUsd!))),
    peakCapUsd: round(median(priced.map((x) => x.peakCapUsd!))),
    upsideX: round(median(ups), 10),
    peakAfterSec: median(priced.filter((x) => x.peakAfterSec !== null && x.peakAfterSec !== undefined).map((x) => x.peakAfterSec!)),
    reached20k: round(priced.filter((x) => x.peakCapUsd! >= 20_000).length / priced.length, 100),
    firstSellSec: median(list.filter((x) => x.devFirstSellSec !== null && x.devFirstSellSec !== undefined).map((x) => x.devFirstSellSec!)),
    dumpCapUsd: round(median(dumped.map((x) => x.dumpCapUsd!))),
    afterDumpLowPct: round(median(dumped.map((x) => x.afterDumpLowPct!)), 100),
    afterDumpDoubled: dumped.length ? round(dumped.filter((x) => (x.afterDumpHighX ?? 0) >= 2).length / dumped.length, 100) : null,
    dumps: dumped.length,
  };
}

/** Tickers a dev used more than once, the most repeated first. */
export function repeatsOf(list: Array<{ symbol: string }>): Array<{ symbol: string; n: number }> {
  const n = new Map<string, number>();
  for (const x of list) {
    const k = x.symbol.replace(/^\$/, "").trim().toUpperCase();
    if (k) n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([symbol, c]) => ({ symbol, n: c }));
}

/** Launches a day over the days they were active, and days since the last launch. */
export function tempoOf(list: Array<{ createdAt: number }>, now = Date.now()): { perDay: number; idleDays: number } | undefined {
  if (!list.length) return undefined;
  const ts = list.map((x) => x.createdAt).sort((a, b) => a - b);
  const days = new Set(ts.map((t) => Math.floor(t / DAY_MS))).size;
  return { perDay: Math.round((ts.length / days) * 10) / 10, idleDays: Math.round(((now - ts[ts.length - 1]!) / DAY_MS) * 10) / 10 };
}

/** One of a creator's launches and how it went. Older records (from before these were counted) lack the optional ones. */
export interface LaunchOutcome {
  mint: string;
  symbol: string;
  createdAt: number;
  dumpedAfterMin: number | null;
  dumpedAfterSec?: number | null;
  /** SOL the dev took out beyond what they put in; negative when they sold at a loss. */
  devTookSol?: number | null;
  /** Buyers still holding when the dev sold. */
  leftHolding?: number | null;
  /** Alive now (or when last recorded): a pool with enough SOL, or a curve near graduation. */
  alive?: boolean | null;
  graduated: boolean;
  /** Market caps in dollars at today's SOL price: first second, peak, and where the dev dumped. */
  firstCapUsd?: number | null;
  peakCapUsd?: number | null;
  peakAfterSec?: number | null;
  dumpCapUsd?: number | null;
  /** In the 30 minutes after the dump: the lowest it went (as a fraction, -0.34) and the most it rose (as a multiple). */
  afterDumpLowPct?: number | null;
  afterDumpHighX?: number | null;
  devFirstSellSec?: number | null;
}

/** A fresh token that passed the basic checks the tape can make; not a judgement of its worth. */
export interface CleanLaunch {
  mint: string;
  symbol: string;
  name: string;
  ageMin: number;
  buyers: number;
  buyersMore?: boolean;
  repeatBuyers: number;
  top5Share: number | null;
  creatorSold: number | null;
  curveSol: number | null;
  graduated: boolean;
}

/** A moment on the tape worth showing as it happens: the live map flashes on these. */
export interface PulseEvent {
  seq: number;
  at: number;
  kind: "launch" | "serial" | "dump" | "graduated" | "whale" | "drained";
  mint: string;
  symbol: string;
  text: string;
  /** The Solana transaction that shows it: the creator's sell, the big buy, the launch. Check it on any explorer. */
  tx?: string;
  /** Who launched the token. */
  creator?: string;
}

const PULSE_KEEP = 300;
/** Loud moments are kept two days, so a post that names one can still be checked. */
const MOMENTS_KEEP_MS = 48 * 3_600_000;
const MOMENTS_MAX = 50_000;

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
};
/** A pool that held at least this much SOL and fell below this share of it was drained. */
const DRAIN_MIN_PEAK = 20;
const DRAIN_SHARE = 0.2;
/** A single buy this big stands out on a fresh pump.fun token. */
const WHALE_SOL = 10;

const KEEP_MS = 48 * 3_600_000;
/**
 * Newest launches kept in order: six hours and more even at a busy 50 a minute. It was 500 (about 20 minutes),
 * which left the clean list and the koi looking at nothing older than that.
 */
const RECENT_KEEP = 20_000;
const DAY_MS = 24 * 3_600_000;
/**
 * A ceiling for the tape, well above two days of launches (about 100,000). It was 30,000, under what two days hold, so
 * every launch ran a full prune over the whole tape that removed nothing: north fell minutes behind the chain.
 */
const MAX_TRACKED = 250_000;
/** The first buyers are kept whole (amounts, repeat buys); past that only a hash, to count them. */
const BUYERS_FULL = 100;
const BUYERS_MAX = 5_000;
/** A buy this soon after the create is a sniper's or the creator's friends': nobody else could have seen it yet. */
const EARLY_MS = 5_000;
/** The latest trade that may stand for the five-minute reading of a token. */
const AT5_LATEST = 10 * 60_000;
/** First-second buys remembered per wallet. */
const EARLY_KEEP = 300;
/** Sniping this many launches together makes two wallets a ring. */
const RING_TOGETHER = 3;
/** Sniping this many launches in two days makes a wallet a serial sniper. */
const SERIAL_SNIPES = 10;

/** FNV-1a: a wallet as a 32-bit number. At 5,000 wallets two colliding is a few in a thousand. */
const hash32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

export class PumpTape {
  private readonly tokens = new Map<string, Tracked>();
  /** Launches each wallet bought in the first seconds of, oldest first: rebuilt from the tokens on load, never saved. */
  private readonly earlyBy = new Map<string, string[]>();
  private earlyPrunedAt = 0;
  /** When this tape began reading bundles; a token launched before it has only part of its life counted. */
  bundleSince = Date.now();
  private prunedAt = 0;
  private readonly launchesBy = new Map<string, number[]>();
  /** Newest launches first, mints only. */
  private recent: string[] = [];
  connected = false;
  lastEventAt = 0;
  seen: { launches: number; trades: number; launchlab?: number; dbc?: number } = { launches: 0, trades: 0 };
  private pulse: PulseEvent[] = [];
  private pulseSeq = 0;
  /** Pools followed whether or not the tape tracks the token: the zoo's own, for the buy bot. */
  private readonly followed = new Map<string, { mint: string; swaps: FollowedSwap[]; txs: Set<string> }>();
  private followSeq = 0;
  /** Mints each creator launched, newest last, for as long as the tokens are kept. */
  private readonly byCreator = new Map<string, string[]>();
  /** PumpSwap pools of the tokens on the tape, pool to mint. */
  private readonly pools = new Map<string, string>();
  /** Every loud moment (not plain launches) of the last two days, oldest first. */
  private moments: PulseEvent[] = [];
  /** Per-second counts over the last minute, a ring indexed by second. */
  private readonly seconds = Array.from({ length: 60 }, () => ({ sec: -1, launches: 0, trades: 0 }));

  /** Called on every moment, launches included: the long-memory store listens here. Must stay cheap. */
  onMoment?: (e: PulseEvent) => void;

  private emit(at: number, kind: PulseEvent["kind"], t: { mint: string; symbol: string; creator: string }, text: string, tx?: string): void {
    const symbol = t.symbol.replace(/\s+/g, " ").trim().slice(0, 16) || "?";
    const e: PulseEvent = { seq: ++this.pulseSeq, at, kind, mint: t.mint, symbol, text, creator: t.creator, ...(tx ? { tx } : {}) };
    this.pulse.push(e);
    this.onMoment?.(e);
    if (this.pulse.length > PULSE_KEEP) this.pulse.splice(0, this.pulse.length - PULSE_KEEP);
    if (kind !== "launch") {
      this.moments.push(e);
      if (this.moments.length > MOMENTS_MAX) this.moments.splice(0, this.moments.length - MOMENTS_MAX);
    }
  }

  /** Loud moments of the last two days, newest first, optionally by ticker, mint or kind. */
  momentsMatching(q: { symbol?: string; mint?: string; kind?: string; limit?: number }, now = Date.now()): PulseEvent[] {
    const sym = q.symbol?.replace(/^\$/, "").toLowerCase();
    const out: PulseEvent[] = [];
    for (let i = this.moments.length - 1; i >= 0 && out.length < (q.limit ?? 200); i--) {
      const e = this.moments[i]!;
      if (now - e.at > MOMENTS_KEEP_MS) break;
      if (sym && e.symbol.replace(/^\$/, "").toLowerCase() !== sym) continue;
      if (q.mint && e.mint !== q.mint) continue;
      if (q.kind && e.kind !== q.kind) continue;
      out.push(e);
    }
    return out;
  }

  /** What survives a restart: the loud moments and the sequence they were numbered in. */
  dump(now = Date.now()): string {
    return JSON.stringify({ pulseSeq: this.pulseSeq, moments: this.moments.filter((e) => now - e.at <= MOMENTS_KEEP_MS) });
  }

  restore(json: string, now = Date.now()): void {
    try {
      const saved = JSON.parse(json) as { pulseSeq?: number; moments?: PulseEvent[] };
      this.pulseSeq = Math.max(this.pulseSeq, Number(saved.pulseSeq) || 0);
      this.moments = (saved.moments ?? []).filter((e) => e && now - e.at <= MOMENTS_KEEP_MS);
    } catch {
      /* a broken file starts the record afresh */
    }
  }

  private count(now: number, field: "launches" | "trades"): void {
    const sec = Math.floor(now / 1000);
    const b = this.seconds[sec % 60]!;
    if (b.sec !== sec) {
      b.sec = sec;
      b.launches = 0;
      b.trades = 0;
    }
    b[field] += 1;
  }

  /** Launches and trades seen in the last 60 seconds. */
  perMinute(now = Date.now()) {
    const sec = Math.floor(now / 1000);
    let launches = 0;
    let trades = 0;
    for (const b of this.seconds) {
      if (sec - b.sec < 60) {
        launches += b.launches;
        trades += b.trades;
      }
    }
    return { launches, trades };
  }

  /** Tape moments after a sequence number, oldest first. */
  pulseAfter(after: number, limit = 80): PulseEvent[] {
    const out = this.pulse.filter((e) => e.seq > after);
    return out.slice(-limit);
  }

  /** Keep every trade on this pool, whatever the tape knows of the token. */
  follow(mint: string, pool: string): void {
    if (!this.followed.has(pool)) this.followed.set(pool, { mint, swaps: [], txs: new Set() });
  }

  /** Trades on a followed token's pools after a sequence number, oldest first. */
  followedAfter(mint: string, after: number, limit = 50): FollowedSwap[] {
    const out: FollowedSwap[] = [];
    for (const f of this.followed.values()) if (f.mint === mint) out.push(...f.swaps.filter((s) => s.seq > after));
    return out.sort((a, b) => a.seq - b.seq).slice(-limit);
  }

  private noteFollowed(ev: Extract<PumpEvent, { kind: "swap" }>, now: number, tx?: string): void {
    const f = this.followed.get(ev.pool);
    if (!f) return;
    // The relay hands a restarted reader the last minute again: one trade, one entry.
    if (tx) {
      if (f.txs.has(tx)) return;
      f.txs.add(tx);
      if (f.txs.size > 2_000) f.txs = new Set([...f.txs].slice(-1_000));
    }
    // Sequence numbers are clock based, so a reader's cursor still holds after a restart.
    this.followSeq = Math.max(this.followSeq + 1, now);
    f.swaps.push({ seq: this.followSeq, mint: f.mint, pool: ev.pool, isBuy: ev.isBuy, sol: ev.sol, tokens: ev.tokens, user: ev.user, ts: ev.ts || now, poolSol: ev.poolSol, tx: tx ?? null });
    if (f.swaps.length > 600) f.swaps = f.swaps.slice(-300);
  }

  /** True while the stream is delivering; the agents only trust the tape then. */
  live(now = Date.now()): boolean {
    return this.connected && now - this.lastEventAt < 120_000;
  }

  apply(ev: PumpEvent, now = Date.now(), tx?: string, slot?: number): void {
    this.lastEventAt = now;
    if (ev.kind === "create") {
      if (this.tokens.has(ev.mint)) return;
      const createdAt = ev.ts ?? now;
      this.tokens.set(ev.mint, {
        mint: ev.mint,
        quote: ev.quote ?? null,
        ...(ev.mayhem ? { mayhem: true } : {}),
        ...(ev.venue ? { venue: ev.venue } : {}),
        ...(ev.platform ? { platform: ev.platform } : {}),
        ...(ev.supply ? { supply: ev.supply } : {}),
        ...(ev.uri ? { uri: ev.uri } : {}),
        name: ev.name,
        symbol: ev.symbol,
        creator: ev.creator,
        createdAt,
        buys: 0,
        sells: 0,
        buyers: new Map(),
        trades15m: 0,
        solIn: 0,
        solOut: 0,
        curveSol: null,
        devBought: 0,
        devSold: 0,
        devIn: 0,
        devOut: 0,
        capPeak: 0,
        graduated: false,
        dumped: false,
        dumpedAt: null,
        createSlot: slot ?? null,
        launchBuys: new Map(),
        pool: null,
        poolSol: null,
        poolPeak: null,
        drained: false,
        ammBuys: 0,
        ammSells: 0,
        ammSolIn: 0,
        ammSolOut: 0,
      });
      const mine = this.byCreator.get(ev.creator) ?? [];
      mine.push(ev.mint);
      this.byCreator.set(ev.creator, mine);
      const times = (this.launchesBy.get(ev.creator) ?? []).filter((t) => now - t < DAY_MS);
      times.push(createdAt);
      this.launchesBy.set(ev.creator, times);
      this.recent.unshift(ev.mint);
      if (this.recent.length > RECENT_KEEP) this.recent.length = RECENT_KEEP;
      this.seen.launches += 1;
      if (ev.venue) this.seen[ev.venue] = (this.seen[ev.venue] ?? 0) + 1;
      this.count(now, "launches");
      if (times.length >= 5) this.emit(now, "serial", ev, `wallet's ${ordinal(times.length)} launch today`, tx);
      else this.emit(now, "launch", ev, "new launch", tx);
      if (this.tokens.size > MAX_TRACKED && now - this.prunedAt > 60_000) {
        this.prunedAt = now;
        this.prune(now);
      }
      return;
    }
    if (ev.kind === "swap") {
      this.noteFollowed(ev, now, tx);
      return this.swap(ev, now, tx, slot);
    }
    const t = this.tokens.get(ev.mint);
    // Trades on tokens launched before we started listening are not ours to judge.
    if (!t) return;
    if (ev.kind === "complete" || ev.kind === "pool") {
      if (!t.graduated) this.emit(now, "graduated", t, "graduated", tx);
      t.graduated = true;
      if (ev.kind === "pool") {
        // Anyone can open another SOL pool for a token; the first one, from the migration, is the one we follow.
        t.pool ??= ev.pool;
        this.pools.set(ev.pool, t.mint);
      }
      return;
    }
    this.seen.trades += 1;
    this.count(now, "trades");
    this.noteBundle(t, ev.user, ev.tokens, ev.sol, ev.isBuy, slot);
    if (!t.quote) this.noteCap(t, ev.sol, ev.tokens, ev.ts);
    if (ev.ts - t.createdAt <= 15 * 60_000) t.trades15m += 1;
    // Five minutes in, the early and churn numbers are written down once, for the check's record.
    // Only a trade between 5 and 10 minutes in can stand for "five minutes in": a token first traded later (or one
    // launched before the tape knew these numbers) has no five-minute reading, and the record leaves it out.
    if (!t.at5 && ev.ts - t.createdAt >= 5 * 60_000 && ev.ts - t.createdAt < AT5_LATEST) {
      const { creatorCrew, ringWallets } = this.crewOf(t, now);
      t.at5 = { ...this.early(t), creatorCrew, ringWallets, at: ev.ts };
    }
    // A buy and a sell by one wallet in one transaction is a bump bot, not a trader.
    if (tx) {
      if (t.last && t.last.tx === tx && t.last.user === ev.user && t.last.isBuy !== ev.isBuy) t.bumps = (t.bumps ?? 0) + 1;
      t.last = { tx, user: ev.user, isBuy: ev.isBuy };
    }
    const b = t.buyers.get(ev.user);
    if (b) b.trades = (b.trades ?? b.buys) + 1;
    if (ev.isBuy) {
      t.buys += 1;
      t.solIn += ev.sol;
      if (b) {
        b.sol += ev.sol;
        b.buys += 1;
        b.tok = (b.tok ?? 0) + ev.tokens;
        notePeak(b);
      } else if (t.buyers.size < BUYERS_FULL) {
        t.buyers.set(ev.user, { sol: ev.sol, buys: 1, tok: ev.tokens, sold: 0, out: 0, trades: 1, at: ev.ts, peak: ev.tokens });
        if (ev.user !== t.creator && ev.ts - t.createdAt <= EARLY_MS) this.noteEarly(ev.user, t.mint, now);
      }
      else if ((t.moreBuyers?.size ?? 0) < BUYERS_MAX - BUYERS_FULL) (t.moreBuyers ??= new Set()).add(hash32(ev.user));
      if (ev.user === t.creator) {
        t.devBought += ev.tokens;
        if (t.devIn !== undefined) t.devIn += ev.sol;
      } else if (t.createSlot !== null && slot !== undefined && slot - t.createSlot <= BUNDLE_SLOTS) {
        t.launchBuys.set(ev.user, (t.launchBuys.get(ev.user) ?? 0) + ev.tokens);
      }
      // Paired with another token, the amount is in that token, not SOL: no whale call on it.
      if (!t.quote && ev.sol >= WHALE_SOL) this.emit(now, "whale", t, `+${ev.sol.toFixed(1)} SOL buy`, tx);
    } else {
      t.sells += 1;
      t.solOut += ev.sol;
      if (b) {
        b.sold = (b.sold ?? 0) + ev.tokens;
        b.out = (b.out ?? 0) + ev.sol;
        if (b.exitAt === undefined && (b.tok ?? 0) > 0 && b.sold >= (b.tok ?? 0) * 0.9) b.exitAt = ev.ts;
      }
      if (ev.user === t.creator) this.creatorSold(t, ev.tokens, ev.sol, ev.ts, now, tx);
    }
    // The curve lines the zoo grades by are pump.fun's; another launchpad's curve is not read against them.
    if (ev.curveSol !== null && !t.quote && !t.venue) t.curveSol = ev.curveSol;
  }

  /** The market cap this trade's price puts on the token, in SOL; dust trades say nothing about the price. */
  private noteCap(t: Tracked, sol: number, tokens: number, ts: number): void {
    if (t.capPeak === undefined || sol < 0.001 || tokens < 1) return;
    const cap = (sol / tokens) * supplyOf(t);
    if (!Number.isFinite(cap)) return;
    if (ts - t.createdAt <= 1_000) t.capFirst = Math.max(t.capFirst ?? 0, cap);
    if (cap > t.capPeak) {
      t.capPeak = cap;
      t.capPeakAt = ts;
    }
    if (t.dumpedAt !== null && t.capDump !== undefined && ts > t.dumpedAt && ts - t.dumpedAt <= AFTER_DUMP_MS) {
      t.capLow = Math.min(t.capLow ?? cap, cap);
      t.capHigh = Math.max(t.capHigh ?? cap, cap);
    }
  }

  private creatorSold(t: Tracked, tokens: number, sol: number, ts: number, now: number, tx?: string): void {
    t.devFirstSellAt ??= ts;
    t.devSold += tokens;
    if (t.devOut !== undefined) t.devOut += sol;
    if (!t.dumped && t.devBought > 0 && t.devSold / t.devBought >= 0.5) {
      t.dumped = true;
      t.dumpedAt = ts;
      if (t.capPeak !== undefined && sol >= 0.001 && tokens >= 1) t.capDump = (sol / tokens) * supplyOf(t);
      let held = 0;
      for (const [w, b] of t.buyers) if (w !== t.creator && b.tok !== undefined && b.tok - (b.sold ?? 0) > 0) held += 1;
      t.heldAtDump = held;
      const pct = Math.round(Math.min(1, t.devSold / t.devBought) * 100);
      const sec = Math.max(0, Math.round((ts - t.createdAt) / 1000));
      const after = sec < 120 ? `${sec}s` : sec < 2 * 3600 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)} h`;
      this.emit(now, "dump", t, `creator sold ${pct}% after ${after}`, tx);
    }
  }

  /**
   * Bundles over a token's whole life: buys are gathered per block, and a block where four or more wallets bought
   * marks them all. From then on every trade of theirs moves what the bundlers hold, and the peak is kept.
   */
  private noteBundle(t: Tracked, user: string, tokens: number, sol: number, isBuy: boolean, slot?: number): void {
    if (user === t.creator) return;
    if (slot !== undefined && slot !== t.bslot) {
      this.closeBundleSlot(t);
      t.bslot = slot;
      t.bpend = undefined;
    }
    const bag = t.bundlers?.get(user);
    if (bag) {
      const before = Math.max(0, bag.tok - bag.sold);
      if (isBuy) {
        bag.tok += tokens;
        t.bundledSol = (t.bundledSol ?? 0) + sol;
      } else bag.sold += tokens;
      t.bundleHeld = Math.max(0, (t.bundleHeld ?? 0) + Math.max(0, bag.tok - bag.sold) - before);
      t.bundlePeak = Math.max(t.bundlePeak ?? 0, t.bundleHeld);
    }
    if (!isBuy || slot === undefined) return;
    const p = (t.bpend ??= new Map()).get(user) ?? { tok: 0, sol: 0 };
    // A wallet already marked has its buy counted above; here it only counts toward the block's crowd.
    if (!bag) ((p.tok += tokens), (p.sol += sol));
    t.bpend.set(user, p);
  }

  private closeBundleSlot(t: Tracked): void {
    const pend = t.bpend;
    if (!pend || pend.size < BUNDLE_MIN) return;
    // Bots churning dust through a busy pool also land four to a block; a bundle has to move real supply.
    let took = 0;
    for (const p of pend.values()) took += p.tok;
    if (took < supplyOf(t) * BUNDLE_MIN_SHARE) return;
    const bundlers = (t.bundlers ??= new Map());
    for (const [user, p] of pend) {
      if (bundlers.has(user) || bundlers.size >= BUNDLERS_MAX) continue;
      bundlers.set(user, { tok: p.tok, sold: 0 });
      t.bundleHeld = (t.bundleHeld ?? 0) + p.tok;
      t.bundledSol = (t.bundledSol ?? 0) + p.sol;
    }
    t.bundlePeak = Math.max(t.bundlePeak ?? 0, t.bundleHeld ?? 0);
  }

  /** A token's main pool, to read its balance from the chain. */
  poolOf(mint: string): string | null {
    return this.tokens.get(mint)?.pool ?? null;
  }

  /** What the pool holds, read from the chain: replaces the last trade's reading, and a drain shows up at once. */
  notePoolSol(mint: string, sol: number, now = Date.now()): void {
    const t = this.tokens.get(mint);
    if (!t) return;
    t.poolSol = sol;
    t.poolPeak = Math.max(t.poolPeak ?? 0, sol);
    if (!t.drained && t.poolPeak >= DRAIN_MIN_PEAK && sol < t.poolPeak * DRAIN_SHARE) {
      t.drained = true;
      this.emit(now, "drained", t, `pool drained to ${sol.toFixed(1)} SOL after graduation`);
    }
  }

  /** The PumpSwap pools the tape follows, for the stream's pool filter. Sorted, so an unchanged set reads the same. */
  poolAddresses(): string[] {
    return [...this.pools.keys()].sort();
  }

  /** Life after the curve: trades on the PumpSwap pools of tokens we watched launch. */
  private swap(ev: Extract<PumpEvent, { kind: "swap" }>, now: number, tx?: string, slot?: number): void {
    const mint = this.pools.get(ev.pool);
    const t = mint ? this.tokens.get(mint) : undefined;
    if (!t) return;
    this.seen.trades += 1;
    this.count(now, "trades");
    this.noteBundle(t, ev.user, ev.tokens, ev.sol, ev.isBuy, slot);
    this.noteCap(t, ev.sol, ev.tokens, ev.ts);
    // Trades on a side pool still count, but only the main pool says how much SOL is left.
    if (ev.pool === t.pool) {
      t.poolSol = ev.poolSol;
      t.poolPeak = Math.max(t.poolPeak ?? 0, ev.poolSol);
    }
    // A graduated pool opens with about 85 SOL. Down to a fifth of its best, the liquidity has left: announced once.
    if (ev.pool === t.pool && !t.drained && t.poolPeak !== null && t.poolPeak >= DRAIN_MIN_PEAK && ev.poolSol < t.poolPeak * DRAIN_SHARE) {
      t.drained = true;
      this.emit(now, "drained", t, `pool drained to ${ev.poolSol.toFixed(1)} SOL after graduation`, tx);
    }
    // A first buyer still trading it in the pool: what they hold moves, the curve's churn numbers do not.
    const b = t.buyers.get(ev.user);
    if (ev.isBuy) {
      t.ammBuys += 1;
      t.ammSolIn += ev.sol;
      if (b) {
        b.tok = (b.tok ?? 0) + ev.tokens;
        notePeak(b);
      }
      if (ev.user === t.creator && t.devIn !== undefined) t.devIn += ev.sol;
      if (ev.sol >= WHALE_SOL) this.emit(now, "whale", t, `+${ev.sol.toFixed(1)} SOL buy after graduation`, tx);
    } else {
      t.ammSells += 1;
      t.ammSolOut += ev.sol;
      if (b) {
        b.sold = (b.sold ?? 0) + ev.tokens;
        if (b.exitAt === undefined && (b.tok ?? 0) > 0 && b.sold >= (b.tok ?? 0) * 0.9) b.exitAt = ev.ts;
      }
      if (ev.user === t.creator) this.creatorSold(t, ev.tokens, ev.sol, ev.ts, now, tx);
    }
  }

  /**
   * The whole tape, so a restart (a deploy) does not forget two days of launches, creators and pools.
   * Maps become arrays; what can be rebuilt (creators' mints, pools) is rebuilt on load.
   */
  snapshot(): string {
    // Amounts trimmed so two days of tokens stay a file the volume can write every five minutes.
    // Zeros and the obvious are left out: a trade count equal to the buys, nothing sold, nothing taken out.
    const slim = (b: Buyer): Buyer => ({
      sol: Math.round(b.sol * 1e6) / 1e6,
      buys: b.buys,
      ...(b.tok ? { tok: Math.round(b.tok) } : {}),
      ...(b.sold ? { sold: Math.round(b.sold) } : {}),
      ...(b.out ? { out: Math.round(b.out * 1e6) / 1e6 } : {}),
      ...(b.trades !== undefined && b.trades !== b.buys ? { trades: b.trades } : {}),
      ...(b.at !== undefined ? { at: b.at } : {}),
      ...(b.exitAt !== undefined ? { exitAt: b.exitAt } : {}),
      ...(b.peak ? { peak: Math.round(b.peak) } : {}),
    });
    const tokens = [...this.tokens.values()].map((t) => ({ ...t, last: undefined, crew: undefined, buyers: [...t.buyers].map(([w, b]) => [w, slim(b)]), moreBuyers: t.moreBuyers ? [...t.moreBuyers] : undefined, launchBuys: [...t.launchBuys], bundlers: t.bundlers ? [...t.bundlers] : undefined, bpend: undefined, bslot: undefined }));
    return JSON.stringify({ v: 1, tokens, launchesBy: [...this.launchesBy], recent: this.recent, seen: this.seen, bundleSince: this.bundleSince });
  }

  load(json: string, now = Date.now()): number {
    try {
      const saved = JSON.parse(json) as {
        v?: number;
        tokens?: Array<Omit<Tracked, "buyers" | "moreBuyers" | "launchBuys" | "pool" | "poolSol" | "poolPeak" | "drained" | "ammBuys" | "ammSells" | "ammSolIn" | "ammSolOut"> & Partial<Tracked> & { buyers: [string, Buyer][]; moreBuyers?: number[]; launchBuys: [string, number][] }>;
        launchesBy?: [string, number[]][];
        recent?: string[];
        seen?: { launches: number; trades: number; launchlab?: number; dbc?: number };
        bundleSince?: number;
      };
      if (saved.v !== 1) return 0;
      // A snapshot from before bundles were read: they are read from now on.
      this.bundleSince = saved.bundleSince ?? now;
      for (const s of saved.tokens ?? []) {
        if (!s?.mint || now - s.createdAt > KEEP_MS || this.tokens.has(s.mint)) continue;
        // Fields added after a snapshot was written start empty.
        const t: Tracked = {
          ...s,
          pool: s.pool ?? null,
          poolSol: s.poolSol ?? null,
          poolPeak: s.poolPeak ?? null,
          drained: s.drained ?? false,
          ammBuys: s.ammBuys ?? 0,
          ammSells: s.ammSells ?? 0,
          ammSolIn: s.ammSolIn ?? 0,
          ammSolOut: s.ammSolOut ?? 0,
          buyers: new Map(s.buyers ?? []),
          moreBuyers: s.moreBuyers?.length ? new Set(s.moreBuyers) : undefined,
          launchBuys: new Map(s.launchBuys ?? []),
          bundlers: s.bundlers ? new Map(s.bundlers as unknown as [string, { tok: number; sold: number }][]) : undefined,
        };
        this.tokens.set(t.mint, t);
        const mine = this.byCreator.get(t.creator) ?? [];
        mine.push(t.mint);
        this.byCreator.set(t.creator, mine);
        if (t.pool) this.pools.set(t.pool, t.mint);
      }
      for (const mints of this.byCreator.values()) mints.sort((a, b) => this.tokens.get(a)!.createdAt - this.tokens.get(b)!.createdAt);
      // Who sniped what is in the buyers already: the per-wallet lists are rebuilt in launch order.
      this.earlyBy.clear();
      for (const t of [...this.tokens.values()].sort((a, b) => a.createdAt - b.createdAt)) {
        for (const w of this.earlyWalletsOf(t)) {
          const list = this.earlyBy.get(w) ?? [];
          list.push(t.mint);
          if (list.length > EARLY_KEEP) list.shift();
          this.earlyBy.set(w, list);
        }
      }
      for (const [creator, times] of saved.launchesBy ?? []) {
        const kept = times.filter((x) => now - x < DAY_MS);
        if (kept.length) this.launchesBy.set(creator, kept);
      }
      this.recent = [...(saved.recent ?? []).filter((m) => this.tokens.has(m)), ...this.recent.filter((m) => !(saved.recent ?? []).includes(m))].slice(0, RECENT_KEEP);
      if (saved.seen) {
        const add = (k: "launchlab" | "dbc") => (this.seen[k] ?? 0) + (saved.seen![k] ?? 0);
        this.seen = { launches: this.seen.launches + saved.seen.launches, trades: this.seen.trades + saved.seen.trades, launchlab: add("launchlab"), dbc: add("dbc") };
      }
      return this.tokens.size;
    } catch {
      return 0;
    }
  }

  prune(now = Date.now()): void {
    for (const [mint, t] of this.tokens) if (now - t.createdAt > KEEP_MS) this.tokens.delete(mint);
    for (const [pool, mint] of this.pools) if (!this.tokens.has(mint)) this.pools.delete(pool);
    for (const [creator, mints] of this.byCreator) {
      const kept = mints.filter((m) => this.tokens.has(m));
      if (kept.length) this.byCreator.set(creator, kept);
      else this.byCreator.delete(creator);
    }
    for (const [creator, times] of this.launchesBy) {
      const kept = times.filter((x) => now - x < DAY_MS);
      if (kept.length) this.launchesBy.set(creator, kept);
      else this.launchesBy.delete(creator);
    }
    this.recent = this.recent.filter((m) => this.tokens.has(m));
  }

  private noteEarly(wallet: string, mint: string, now: number): void {
    const list = this.earlyBy.get(wallet) ?? [];
    if (list[list.length - 1] !== mint) list.push(mint);
    if (list.length > EARLY_KEEP) list.splice(0, list.length - EARLY_KEEP);
    this.earlyBy.set(wallet, list);
    // Launches older than the tape fall out of the lists every ten minutes, not on every buy.
    if (now - this.earlyPrunedAt > 10 * 60_000) {
      this.earlyPrunedAt = now;
      for (const [w, mints] of this.earlyBy) {
        const kept = mints.filter((m) => this.tokens.has(m));
        if (kept.length) this.earlyBy.set(w, kept);
        else this.earlyBy.delete(w);
      }
    }
  }

  /** The wallets in a token's first seconds, the creator left out. */
  private earlyWalletsOf(t: Tracked): string[] {
    const out: string[] = [];
    for (const [w, b] of t.buyers) if (w !== t.creator && b.at !== undefined && b.at - t.createdAt <= EARLY_MS) out.push(w);
    return out;
  }

  /**
   * Who the first-second buyers are across launches. Wallets that keep sniping one creator's launches are that
   * creator's (funded through an exchange or not, the pattern gives them away); wallets that keep sniping together
   * are one operator; wallets that snipe everything are bots waiting to sell into the first real buyers.
   */
  /** What the creator's crew and ring wallets (read by crewOf just before) still hold of the supply. */
  private crewHeldOf(t: Tracked): number {
    const m = t.crew?.members;
    if (!m) return 0;
    let held = 0;
    for (const w of new Set([...m.crew, ...m.ring])) {
      const b = t.buyers.get(w);
      if (b) held += Math.max(0, (b.tok ?? 0) - (b.sold ?? 0));
    }
    return Math.round(Math.min(1, held / supplyOf(t)) * 1000) / 1000;
  }

  private crewOf(t: Tracked, now: number): Crew {
    if (t.crew && now - t.crew.at < 60_000) return t.crew.counts;
    const early = this.earlyWalletsOf(t);
    const theirs = new Set((this.byCreator.get(t.creator) ?? []).filter((m) => m !== t.mint));
    const others = new Map(early.map((w) => [w, new Set((this.earlyBy.get(w) ?? []).filter((m) => m !== t.mint))]));
    const crewSet = new Set<string>();
    const serialSet = new Set<string>();
    const inRing = new Set<string>();
    for (const w of early) {
      const mints = others.get(w)!;
      let mine = 0;
      for (const m of mints) if (theirs.has(m)) mine += 1;
      // A bot that snipes everything lands on a busy creator's launches by chance; a crew wallet snipes mostly theirs.
      if (mine >= 2 && mine / mints.size >= 0.5) crewSet.add(w);
      if (mints.size >= SERIAL_SNIPES) serialSet.add(w);
    }
    // Pairs only among the first 30, to keep this cheap on a crowded launch.
    const head = early.slice(0, 30);
    for (let i = 0; i < head.length; i++) {
      const a = others.get(head[i]!)!;
      if (a.size < RING_TOGETHER) continue;
      for (let j = i + 1; j < head.length; j++) {
        const b = others.get(head[j]!)!;
        if (b.size < RING_TOGETHER) continue;
        const [small, big] = a.size < b.size ? [a, b] : [b, a];
        let together = 0;
        for (const m of small) if (big.has(m)) together += 1;
        // Two bots that snipe everything meet all the time; a ring is two wallets that mostly snipe together.
        if (together >= RING_TOGETHER && together / big.size >= 0.5) {
          inRing.add(head[i]!);
          inRing.add(head[j]!);
        }
      }
    }
    t.crew = { at: now, counts: { creatorCrew: crewSet.size, ringWallets: inRing.size, serialSnipers: serialSet.size }, members: { crew: crewSet, ring: inRing, serial: serialSet } };
    return t.crew.counts;
  }

  /** Every first-second wallet of a token: what it took, what it still holds, how often it snipes and whose launches. */
  earlyOf(mint: string, now = Date.now()) {
    const t = this.tokens.get(mint);
    if (!t) return null;
    this.crewOf(t, now);
    const m = t.crew!.members;
    const supply = supplyOf(t);
    const r = (n: number) => Math.round(n * 10_000) / 10_000;
    return this.earlyWalletsOf(t)
      .map((wallet) => {
        const b = t.buyers.get(wallet)!;
        const tok = b.tok ?? 0;
        const sold = Math.min(tok, b.sold ?? 0);
        return {
          wallet,
          bought: r(tookOf(b, supply) / supply),
          held: r(Math.min(tok - sold, supply) / supply),
          afterSec: Math.max(0, Math.round(((b.at ?? t.createdAt) - t.createdAt) / 1000)),
          exitSec: b.exitAt !== undefined && b.at !== undefined ? Math.max(0, Math.round((b.exitAt - b.at) / 1000)) : null,
          bundle: t.launchBuys.has(wallet),
          snipes48h: (this.earlyBy.get(wallet) ?? []).length,
          crew: m.crew.has(wallet),
          ring: m.ring.has(wallet),
          serial: m.serial.has(wallet),
        };
      })
      .sort((a, b) => b.bought - a.bought)
      .slice(0, 30);
  }

  /** The newest launches with a metadata address, newest first, for the socials reader. */
  withMetadata(limit: number): Array<{ mint: string; uri: string }> {
    const out: Array<{ mint: string; uri: string }> = [];
    for (const mint of this.recent) {
      const t = this.tokens.get(mint);
      if (t?.uri) out.push({ mint, uri: t.uri });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Which launchpad a launch the tape keeps came from; pump.fun when the event named none. */
  venueOf(mint: string): Venue | "pump.fun" | undefined {
    const t = this.tokens.get(mint);
    return t ? (t.venue ?? "pump.fun") : undefined;
  }

  /** The devs of the newest launches, newest first, each once. */
  recentCreators(limit: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const mint of this.recent) {
      const c = this.tokens.get(mint)?.creator;
      if (c && !seen.has(c)) {
        seen.add(c);
        out.push(c);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** One launch's metadata address, when its create event carried one. */
  metadataOf(mint: string): string | undefined {
    return this.tokens.get(mint)?.uri;
  }

  /** What the socials registry needs about one token: who made it, and whether they sold within five minutes. */
  outline(mint: string) {
    const t = this.tokens.get(mint);
    if (!t) return null;
    const dumpedAfterMin = t.dumpedAt === null ? null : Math.max(0, Math.round((t.dumpedAt - t.createdAt) / 60_000));
    return { mint, symbol: t.symbol, creator: t.creator, createdAt: t.createdAt, dumpedAfterMin, fastDump: dumpedAfterMin !== null && dumpedAfterMin <= 5 };
  }

  /** One wallet's first-second buys over two days, and how fast it sold out of them. */
  sniper(wallet: string, now = Date.now()) {
    const mints = (this.earlyBy.get(wallet) ?? []).filter((m) => this.tokens.has(m));
    if (!mints.length) return null;
    let soldOut = 0;
    const exits: number[] = [];
    const creators = new Map<string, number>();
    for (const m of mints) {
      const t = this.tokens.get(m)!;
      creators.set(t.creator, (creators.get(t.creator) ?? 0) + 1);
      const b = t.buyers.get(wallet);
      if (b && (b.tok ?? 0) > 0 && (b.sold ?? 0) >= (b.tok ?? 0) * 0.9) {
        soldOut += 1;
        if (b.exitAt !== undefined && b.at !== undefined) exits.push(Math.max(0, Math.round((b.exitAt - b.at) / 1000)));
      }
    }
    exits.sort((a, b) => a - b);
    const top = [...creators.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      wallet,
      snipes48h: mints.length,
      soldOut,
      medianExitSec: exits.length ? exits[Math.floor(exits.length / 2)]! : null,
      // A wallet that snipes the same few creators again and again is theirs.
      topCreators: top.map(([creator, n]) => ({ creator, launches: n })),
      recent: mints.slice(-10).reverse().map((m) => ({ mint: m, symbol: this.tokens.get(m)!.symbol, createdAt: this.tokens.get(m)!.createdAt })),
      checkedAt: now,
    };
  }

  /**
   * The first seconds and the churn, from the first 100 buyers: who got in before anyone could see the token and
   * still holds it, and how much of the trading is wallets selling back what they just bought.
   */
  private early(t: Tracked): { earlyWallets: number; earlyShare: number; earlyHeld: number; washShare: number; bumps: number } {
    let earlyWallets = 0;
    let bought = 0;
    let held = 0;
    let churn = 0;
    for (const [wallet, b] of t.buyers) {
      if (wallet === t.creator) continue;
      const tok = b.tok ?? 0;
      const sold = Math.min(tok, b.sold ?? 0);
      if (b.at !== undefined && b.at - t.createdAt <= EARLY_MS) {
        earlyWallets += 1;
        bought += tookOf(b, supplyOf(t));
        held += tok - sold;
      }
      if ((b.trades ?? b.buys) >= 3 && tok > 0 && sold >= tok * 0.9) churn += b.sol + (b.out ?? 0);
    }
    const volume = t.solIn + t.solOut;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return { earlyWallets, earlyShare: r(Math.min(1, bought / supplyOf(t))), earlyHeld: r(Math.min(1, held / supplyOf(t))), washShare: volume > 0 ? r(Math.min(1, churn / volume)) : 0, bumps: t.bumps ?? 0 };
  }

  /** `light` leaves out the crew and ring counts, for scans over thousands of tokens. */
  /**
   * The early numbers as facts. After another launchpad's token graduates, its trading moves to a Raydium or Meteora
   * pool the tape does not follow, so what the first wallets still hold is no longer known and is left out.
   */
  private earlyFacts(t: Tracked) {
    const e = this.early(t);
    if (t.venue && t.graduated) {
      const { earlyHeld: _held, ...rest } = e;
      return rest;
    }
    return e;
  }

  facts(mint: string, now = Date.now(), light = false): ChainFacts | null {
    const t = this.tokens.get(mint);
    if (!t) return null;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return {
      ageMin: Math.max(0, Math.round((now - t.createdAt) / 60_000)),
      ...(t.quote ? { quote: t.quote } : {}),
      ...(t.mayhem ? { mayhem: true } : {}),
      ...(t.venue ? { venue: t.venue } : {}),
      ...(t.platform ? { platform: t.platform } : {}),
      buys: t.buys,
      sells: t.sells,
      buyers: t.buyers.size + (t.moreBuyers?.size ?? 0),
      ...(t.buyers.size + (t.moreBuyers?.size ?? 0) >= BUYERS_MAX ? { buyersMore: true } : {}),
      solIn: round(t.solIn),
      solOut: round(t.solOut),
      curveSol: t.curveSol === null ? null : round(t.curveSol),
      creatorSold: t.devBought > 0 ? Math.min(1, round(t.devSold / t.devBought)) : null,
      creatorLaunches24h: (this.launchesBy.get(t.creator) ?? []).filter((x) => now - x < DAY_MS).length,
      graduated: t.graduated,
      top5Share:
        t.solIn > 0
          ? round(
              [...t.buyers.values()]
                .map((b) => b.sol)
                .sort((a, b) => b - a)
                .slice(0, 5)
                .reduce((a, b) => a + b, 0) / t.solIn,
            )
          : null,
      repeatBuyers: [...t.buyers.values()].filter((b) => b.buys >= 2).length,
      trades15m: t.trades15m,
      bundleWallets: t.createSlot === null ? null : t.launchBuys.size,
      bundleShare: t.createSlot === null ? null : round([...t.launchBuys.values()].reduce((a, b) => a + b, 0) / supplyOf(t)),
      bundlers: t.bundlers?.size ?? 0,
      bundlersHeld: round(Math.min(1, (t.bundleHeld ?? 0) / supplyOf(t))),
      bundlersPeak: round(Math.min(1, (t.bundlePeak ?? 0) / supplyOf(t))),
      bundledSol: t.quote ? null : round(t.bundledSol ?? 0),
      bundlesSince: t.createdAt >= this.bundleSince ? null : this.bundleSince,
      poolSol: t.poolSol === null ? null : round(t.poolSol),
      ammBuys: t.ammBuys,
      ammSells: t.ammSells,
      ammSolIn: round(t.ammSolIn),
      ammSolOut: round(t.ammSolOut),
      ...(t.drained ? { drained: true } : {}),
      ...this.earlyFacts(t),
      ...(light ? {} : { ...this.crewOf(t, now), crewHeld: this.crewHeldOf(t) }),
    };
  }

  /** A creator wallet's last two days: how often it launches, how often it dumps, and how fast. */
  creator(wallet: string, now = Date.now()): CreatorRecord | null {
    const tokens = (this.byCreator.get(wallet) ?? []).map((m) => this.tokens.get(m)).filter((t): t is Tracked => Boolean(t));
    if (!tokens.length) return null;
    const all = tokens.map((t) => ({ mint: t.mint, symbol: t.symbol, createdAt: t.createdAt, ...this.outcomeOf(t) }));
    const minutes = tokens.filter((t) => t.dumpedAt !== null).map((t) => Math.max(0, Math.round((t.dumpedAt! - t.createdAt) / 60_000))).sort((a, b) => a - b);
    return {
      wallet,
      launches24h: tokens.filter((t) => now - t.createdAt < DAY_MS).length,
      launches48h: tokens.length,
      dumped: minutes.length,
      medianDumpMin: minutes.length ? minutes[Math.floor(minutes.length / 2)]! : null,
      graduated: tokens.filter((t) => t.graduated).length,
      recent: all.slice(-12).reverse(),
      pattern: devPattern(all),
      repeats: repeatsOf(all),
      tempo: tempoOf(all, now),
    };
  }

  /** How a launch went for the people who bought it: how fast the dev sold, what they took, who was left holding. */
  private outcomeOf(t: Tracked) {
    return {
      dumpedAfterMin: t.dumpedAt === null ? null : Math.max(0, Math.round((t.dumpedAt - t.createdAt) / 60_000)),
      dumpedAfterSec: t.dumpedAt === null ? null : Math.max(0, Math.round((t.dumpedAt - t.createdAt) / 1000)),
      devTookSol: t.devIn !== undefined && t.devOut !== undefined && t.devOut > 0 ? Math.round((t.devOut - t.devIn) * 100) / 100 : null,
      leftHolding: t.heldAtDump ?? null,
      alive: this.aliveNow(t),
      graduated: t.graduated,
      ...capsOf(t),
    };
  }

  /** A token still alive now: a graduated pool holding enough SOL, or a curve near graduation. */
  private aliveNow(t: Tracked): boolean {
    if (t.graduated) return t.poolSol !== null && t.poolSol >= POOL_ALIVE_SOL;
    const real = t.curveSol ?? (t.buys === 0 ? 0 : null);
    return real !== null && curveCapOf(real) >= CURVE_ALIVE_SOL;
  }

  /**
   * A dev's track record of building, not dumping: how many of its launches grew and are still alive, how many
   * graduated, how many it dumped. A builder has at least one launch that grew and still lives, and dumps few.
   */
  builderScore(wallet: string, now = Date.now()) {
    const tokens = (this.byCreator.get(wallet) ?? []).map((m) => this.tokens.get(m)).filter((t): t is Tracked => Boolean(t));
    if (!tokens.length) return null;
    const grew = tokens.filter((t) => this.aliveNow(t) && t.dumpedAt === null).length;
    const graduated = tokens.filter((t) => t.graduated).length;
    const aliveGraduated = tokens.filter((t) => t.graduated && t.poolSol !== null && t.poolSol >= POOL_ALIVE_SOL).length;
    const dumped = tokens.filter((t) => t.dumpedAt !== null).length;
    return { launches: tokens.length, grew, graduated, aliveGraduated, dumped, isBuilder: grew >= 1 && dumped / tokens.length < 0.5 };
  }

  /**
   * The other side of the wall of rugs: dev wallets whose launches actually grew and stayed alive, and who did not
   * dump them. Ranked by how many of their launches are still alive, the proven hands first.
   */
  builders(limit = 20, now = Date.now()) {
    const out: Array<{ wallet: string; launches48h: number; grew: number; graduated: number; dumped: number; recent: Array<{ mint: string; symbol: string; createdAt: number; alive: boolean; graduated: boolean }> }> = [];
    for (const wallet of this.byCreator.keys()) {
      const sc = this.builderScore(wallet, now);
      if (!sc || !sc.isBuilder) continue;
      const tokens = (this.byCreator.get(wallet) ?? []).map((m) => this.tokens.get(m)).filter((t): t is Tracked => Boolean(t));
      out.push({
        wallet,
        launches48h: sc.launches,
        grew: sc.grew,
        graduated: sc.graduated,
        dumped: sc.dumped,
        recent: tokens.slice(-6).reverse().map((t) => ({ mint: t.mint, symbol: t.symbol.slice(0, 16), createdAt: t.createdAt, alive: this.aliveNow(t), graduated: t.graduated })),
      });
    }
    out.sort((a, b) => b.grew - a.grew || b.graduated - a.graduated || a.dumped - b.dumped);
    return out.slice(0, limit);
  }

  /**
   * A dev's whole page: every launch of the last two days and how it went, and the wallets that keep buying them in
   * their first seconds. A wallet on most of one dev's launches, seconds after each one opens, is that dev's.
   */
  creatorProfile(wallet: string, now = Date.now()) {
    const record = this.creator(wallet, now);
    if (!record) return null;
    const tokens = (this.byCreator.get(wallet) ?? []).map((m) => this.tokens.get(m)).filter((t): t is Tracked => Boolean(t));
    const snipes = new Map<string, number>();
    for (const t of tokens) for (const w of this.earlyWalletsOf(t)) snipes.set(w, (snipes.get(w) ?? 0) + 1);
    const launches = tokens
      .slice()
      .reverse()
      .slice(0, 40)
      .map((t) => ({
        mint: t.mint,
        symbol: t.symbol,
        createdAt: t.createdAt,
        venue: t.platform ?? t.venue ?? "pump.fun",
        buyers: t.buyers.size + (t.moreBuyers?.size ?? 0),
        early: this.earlyWalletsOf(t).length,
        ...this.outcomeOf(t),
      }));
    return {
      ...record,
      builder: this.builderScore(wallet, now),
      launches,
      // Wallets in the first seconds of two or more of this dev's launches, the most regular first.
      regulars: [...snipes.entries()]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([w, n]) => ({ wallet: w, launches: n, snipes48h: (this.earlyBy.get(w) ?? []).length })),
    };
  }

  /**
   * The wall of rugs: creator wallets that dumped the most of their own launches in the last two days, worst first,
   * each with the transaction of its latest dump so anyone can check it.
   */
  ruggers(limit = 20, now = Date.now()) {
    const out: Array<CreatorRecord & { lastDump: PulseEvent | null }> = [];
    for (const wallet of this.byCreator.keys()) {
      const r = this.creator(wallet, now);
      if (!r || r.dumped < 3) continue;
      out.push({ ...r, lastDump: null });
    }
    out.sort((a, b) => b.dumped - a.dumped || b.launches48h - a.launches48h);
    const top = out.slice(0, limit);
    for (const r of top) {
      for (let i = this.moments.length - 1; i >= 0; i--) {
        const e = this.moments[i]!;
        if (e.kind === "dump" && e.creator === r.wallet) {
          r.lastDump = e;
          break;
        }
      }
      // A serial dev's latest dump can be older than the moments the node keeps: their newest dumped launch then.
      const d = r.recent.find((x) => x.dumpedAfterMin !== null);
      if (!r.lastDump && d) r.lastDump = { seq: 0, at: d.createdAt + d.dumpedAfterMin! * 60_000, kind: "dump", mint: d.mint, symbol: d.symbol.slice(0, 16), text: `dumped ${d.dumpedAfterMin} min after launch`, creator: r.wallet };
      r.recent = r.recent.slice(0, 5);
    }
    return top;
  }

  /**
   * Fresh launches that pass the checks the tape can make: the creator has not sold, the wallet is not a serial
   * launcher, the buying is spread across many wallets and some came back for more. It says nothing about whether
   * a token is worth anything, only that the usual rug signs are absent so far.
   */
  /**
   * Launches that passed the basic checks. `wide` is the koi's net: up to six hours old and a smaller crowd, because
   * the koi's own judgement does the strict part; the default is the stricter list people see.
   */
  clean(limit = 20, now = Date.now(), wide = false): CleanLaunch[] {
    const out: CleanLaunch[] = [];
    for (const mint of this.recent) {
      if (out.length >= limit) break;
      const t = this.tokens.get(mint);
      if (!t || t.venue) continue;
      const age = (now - t.createdAt) / 60_000;
      if (age < (wide ? 15 : 10) || age > (wide ? 360 : 180)) continue;
      const f = this.facts(mint, now, true)!;
      if (f.creatorSold !== null && f.creatorSold > (wide ? 0.2 : 0.1)) continue;
      if (f.creatorLaunches24h > (wide ? 3 : 2)) continue;
      if (f.buyers < (wide ? 15 : 25) || f.repeatBuyers < (wide ? 2 : 3)) continue;
      if (f.top5Share === null || f.top5Share > 0.5) continue;
      if (f.buys <= f.sells) continue;
      // A few wallets taking the supply in the launch block, or a creator who dumps most of what they launch.
      if (f.bundleWallets !== null && f.bundleShare !== null && f.bundleWallets >= 3 && f.bundleShare >= 0.15) continue;
      // Bundles later in its life that took half the supply or more: the buyers are mostly one hand.
      if ((f.bundlersPeak ?? 0) >= 0.5) continue;
      const rec = this.creator(t.creator, now);
      if (rec && rec.dumped >= 3 && rec.dumped / Math.max(1, rec.launches48h) >= 0.5) continue;
      // The creator's own crew in the first seconds, or snipers still sitting on half the supply.
      if (this.crewOf(t, now).creatorCrew >= 2) continue;
      if ((f.earlyWallets ?? 0) >= 3 && (f.earlyHeld ?? 0) >= 0.5 && !f.mayhem) continue;
      out.push({ mint, symbol: t.symbol.slice(0, 16), name: t.name.slice(0, 40), ageMin: Math.round(age), buyers: f.buyers, ...(f.buyersMore ? { buyersMore: true } : {}), repeatBuyers: f.repeatBuyers, top5Share: f.top5Share, creatorSold: f.creatorSold, curveSol: f.curveSol, graduated: f.graduated });
    }
    return out;
  }

  /**
   * The creator check's own track record: for every SOL-paired launch 24 to 48 hours old, what the check would have
   * said five minutes after launch (from the creator's dumps and launches up to then, and the launch-block bundle),
   * against where the token stands now (its curve or its pool, the same lines the zoo grades by).
   */
  checkRecord(now = Date.now(), atMin = 5) {
    // between: read, but between the dead and alive lines (not dead, not a runner); unread: no curve or pool reading.
    // unknown stays as their sum for older clients.
    type Side = { n: number; dead: number; alive: number; unknown: number; between: number; unread: number };
    const side = (): Side => ({ n: 0, dead: 0, alive: 0, unknown: 0, between: 0, unread: 0 });
    const flagged = side();
    const clear = side();
    const why = { dumped: 0, serial: 0, bundle: 0 };
    // The newer signals, each on its own, as they stood five minutes in, for tokens still trading by then.
    const signals = { stillTrading: side(), insidersHold25: side(), churn30: side(), bumped3: side(), creatorCrew2: side(), ring3: side() };
    for (const t of this.tokens.values()) {
      const age = now - t.createdAt;
      // The record is pump.fun's: its dead and alive lines are pump.fun's curve and PumpSwap pool.
      if (age < DAY_MS || age > KEEP_MS || t.quote || t.venue) continue;
      const at = t.createdAt + atMin * 60_000;
      const dumpedEarly = t.dumped && t.dumpedAt !== null && t.dumpedAt <= at;
      const before = (this.byCreator.get(t.creator) ?? [])
        .map((m) => this.tokens.get(m))
        .filter((o): o is Tracked => Boolean(o) && o!.mint !== t.mint && o!.createdAt < at && at - o!.createdAt <= KEEP_MS);
      const dumpedBefore = before.filter((o) => o.dumped && o.dumpedAt !== null && o.dumpedAt <= at).length;
      const serial = dumpedBefore >= 3 && dumpedBefore / (before.length + 1) >= 0.5;
      const bundle = t.createSlot !== null && t.launchBuys.size >= 3 && [...t.launchBuys.values()].reduce((a, b) => a + b, 0) / supplyOf(t) >= 0.15;
      let outcome: "dead" | "alive" | "between" | "unread" = "unread";
      if (t.graduated) {
        if (t.poolSol !== null) outcome = t.poolSol >= POOL_ALIVE_SOL ? "alive" : t.poolSol < POOL_DEAD_SOL ? "dead" : "between";
      } else {
        const real = t.curveSol ?? (t.buys === 0 ? 0 : null);
        if (real !== null) {
          const cap = curveCapOf(real);
          outcome = cap >= CURVE_ALIVE_SOL ? "alive" : cap < CURVE_DEAD_SOL ? "dead" : "between";
        }
      }
      const count = (x: Side) => {
        x.n += 1;
        x[outcome] += 1;
        if (outcome === "between" || outcome === "unread") x.unknown += 1;
      };
      const s = dumpedEarly || serial || bundle ? flagged : clear;
      count(s);
      // Readings taken late (before this rule, a first trade a day in counted as "five minutes in") are not used.
      if (t.at5 && t.at5.at !== undefined && t.at5.at - t.createdAt < AT5_LATEST) {
        const add = count;
        add(signals.stillTrading);
        if (t.at5.earlyWallets >= 2 && t.at5.earlyHeld >= 0.25) add(signals.insidersHold25);
        if (t.at5.washShare >= 0.3) add(signals.churn30);
        if (t.at5.bumps >= 3) add(signals.bumped3);
        if ((t.at5.creatorCrew ?? 0) >= 2) add(signals.creatorCrew2);
        if ((t.at5.ringWallets ?? 0) >= 3) add(signals.ring3);
      }
      if (dumpedEarly) why.dumped += 1;
      if (serial) why.serial += 1;
      if (bundle) why.bundle += 1;
    }
    return { window: "launched 24 to 48 hours ago", checkedAtMin: atMin, flaggedAvoid: flagged, notFlagged: clear, avoidBecause: why, signals, computedAt: now };
  }

  /** One token as the tape knows it, for questions about a single mint. */
  token(mint: string, now = Date.now()) {
    const t = this.tokens.get(mint);
    if (!t) return null;
    return {
      mint,
      symbol: t.symbol,
      name: t.name,
      creator: t.creator,
      createdAt: t.createdAt,
      facts: this.facts(mint, now)!,
      creatorRecord: this.creator(t.creator, now),
      // The biggest launch-block buyers, for anyone checking who funded them.
      bundle: [...t.launchBuys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([wallet, tokens]) => ({ wallet, share: Math.round((tokens / supplyOf(t)) * 10_000) / 10_000 })),
    };
  }

  /** Every mint the tape holds now, for walking it a slice at a time. */
  mints(): string[] {
    return [...this.tokens.keys()];
  }

  /**
   * What the long-memory store keeps of a token: its facts, first-second wallets and launch bundle as they stand now.
   * Crew sets worked out only for this are dropped again, so walking the whole tape does not grow it.
   */
  historyOf(mint: string, now = Date.now()) {
    const t = this.tokens.get(mint);
    if (!t) return null;
    const had = t.crew;
    const facts = this.facts(mint, now)!;
    const early = this.earlyOf(mint, now) ?? [];
    if (!had) t.crew = undefined;
    return {
      mint,
      symbol: t.symbol,
      name: t.name,
      creator: t.creator,
      venue: t.venue ?? null,
      createdAt: t.createdAt,
      graduated: t.graduated,
      drained: t.drained,
      dumpedAt: t.dumpedAt,
      devSoldPct: t.devBought > 0 ? Math.round(Math.min(1, t.devSold / t.devBought) * 100) : null,
      curveSol: t.curveSol,
      devTookSol: this.outcomeOf(t).devTookSol,
      leftHolding: t.heldAtDump ?? null,
      alive: this.aliveNow(t),
      caps: { capFirst: t.capFirst ?? null, capPeak: t.capPeak || null, capPeakAt: t.capPeakAt ?? null, capDump: t.capDump ?? null, capLow: t.capLow ?? null, capHigh: t.capHigh ?? null, devFirstSellAt: t.devFirstSellAt ?? null },
      facts,
      early,
      bundle: [...t.launchBuys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([wallet, tokens]) => ({ wallet, share: Math.round((tokens / supplyOf(t)) * 10_000) / 10_000 })),
    };
  }

  /** The newest launches, as the sentinels expect them, each with its chain facts attached. */
  launches(limit: number, now = Date.now()) {
    // The night's judges are graded by pump.fun's curve lines, so they see pump.fun launches only.
    const pump = this.recent.filter((m) => !this.tokens.get(m)?.venue);
    return pump.slice(0, limit).flatMap((mint) => {
      const t = this.tokens.get(mint);
      if (!t) return [];
      return [
        {
          mint,
          name: t.name,
          symbol: t.symbol,
          createdAt: t.createdAt,
          creator: t.creator,
          marketCapUsd: null,
          complete: t.graduated,
          // The create event carries no socials; null means unknown, not "none".
          hasSocials: null,
          chain: this.facts(mint, now)!,
        },
      ];
    });
  }

  status(now = Date.now()) {
    return {
      live: this.live(now),
      connected: this.connected,
      lastEventAt: this.lastEventAt || null,
      tracked: this.tokens.size,
      seen: this.seen,
      perMinute: this.perMinute(now),
    };
  }
}

/** The one tape per node process, shared by the tools that read it. */
export const tape = new PumpTape();

export interface StreamOptions {
  url: string;
  token: string;
  log?: (message: string) => void;
  /** Every PumpSwap transaction instead of the tape's pools: for the relay, which has no tape to ask. */
  allPools?: boolean;
}

/** Where the stream's events go: the tape, or the relay's buffer. */
export type StreamSink = Pick<PumpTape, "apply" | "poolAddresses" | "prune"> & { connected: boolean };

const STREAM_STALL_MS = 90_000;
// North runs in California and the stream comes from Europe: with the default HTTP/2 window a connection carries only
// what fits in one window per round trip, far less than pump.fun writes. Big windows that grow with the link fix that.
const CHANNEL = { grpcHttp2AdaptiveWindow: true, grpcInitialStreamWindowSize: 16 << 20, grpcInitialConnectionWindowSize: 32 << 20, grpcMaxDecodingMessageSize: 64 << 20 };

type StreamUpdate = { filters?: string[]; transaction?: { slot?: string | number; transaction?: YellowstoneTx & { signature?: Uint8Array; meta?: { logMessages?: string[] } } }; ping?: unknown };

/**
 * Keeps Yellowstone subscriptions open, reconnecting with backoff, feeding the tape. Two connections: launches and the
 * curves (pump.fun, LaunchLab, Meteora) on one, PumpSwap on the other, and that one only for the pools of tokens on the
 * tape. All of PumpSwap on one connection was more than the stream could carry: it fell minutes behind the chain and
 * took the launches down with it.
 */
export async function startPumpStream(t: StreamSink, { url, token, log = console.log, allPools = false }: StreamOptions): Promise<() => void> {
  type Yellowstone = typeof import("@triton-one/yellowstone-grpc");
  const mod = (await import("@triton-one/yellowstone-grpc")) as unknown as Yellowstone & { default: Yellowstone["default"] | { default: Yellowstone["default"] } };
  // A CommonJS package seen from ESM: the class is the default export, possibly wrapped once more.
  const Client = ("default" in mod.default ? mod.default.default : mod.default) as Yellowstone["default"];
  const CommitmentLevel = mod.CommitmentLevel ?? (mod.default as unknown as Yellowstone).CommitmentLevel;
  let stopped = false;
  const open = new Set<{ end(): void }>();
  const filter = (accounts: string[]) => ({ vote: false, failed: false, accountInclude: accounts, accountExclude: [], accountRequired: [] });
  const request = (transactions: Record<string, ReturnType<typeof filter>>) => ({ accounts: {}, slots: {}, transactions, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [], commitment: CommitmentLevel.CONFIRMED });

  const onData = (update: StreamUpdate) => {
    const logs = update.transaction?.transaction?.meta?.logMessages;
    if (!logs) return;
    const sig = update.transaction?.transaction?.signature;
    const tx = sig && sig.length ? base58(sig) : undefined;
    const slot = update.transaction?.slot !== undefined ? Number(update.transaction.slot) : undefined;
    const at = Number.isFinite(slot) ? slot : undefined;
    for (const ev of parsePumpLogs(logs)) t.apply(ev, Date.now(), tx, at);
    // LaunchLab and Meteora's curve write their events into inner instructions: read the whole transaction.
    if (update.filters?.some((f) => f === "launchlab" || f === "dbc")) {
      const raw = fromYellowstone(update.transaction!.transaction!);
      if (raw) for (const ev of parseLaunchpads(raw, Date.now())) t.apply(ev, Date.now(), tx, at);
    }
  };

  /**
   * One connection, reopened whenever it ends, errors or goes quiet for `stallMs`. `filters` is read again on every
   * open and every `refreshMs`; when it changes the new request goes down the same stream. No filters, no connection.
   */
  const lane = async (name: string, filters: () => Record<string, ReturnType<typeof filter>> | null, opts: { stallMs: number; refreshMs?: number; core?: boolean }) => {
    let delay = 1_000;
    while (!stopped) {
      let wanted = filters();
      if (!wanted) {
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      try {
        const client = new Client(url, token, CHANNEL);
        await client.connect();
        const stream = await client.subscribe();
        open.add(stream);
        let heard = Date.now();
        let timer: ReturnType<typeof setInterval> | undefined;
        let sentAt = Date.now();
        let pings = 0;
        await new Promise<void>((resolve, reject) => {
          timer = setInterval(() => {
            // A stream can go quiet without ending: silence on a busy program means reconnect.
            if (Date.now() - heard >= opts.stallMs) {
              reject(new Error(`no transactions for ${Math.round((Date.now() - heard) / 1000)} s, reconnecting`));
              try {
                stream.end();
              } catch {
                /* already closed */
              }
              return;
            }
            if (opts.refreshMs && Date.now() - sentAt >= opts.refreshMs) {
              sentAt = Date.now();
              const next = filters();
              if (next && JSON.stringify(next) !== JSON.stringify(wanted)) {
                wanted = next;
                stream.write(request(next), (error: unknown) => error && reject(error));
              }
            }
          }, 15_000);
          stream.on("data", (update: StreamUpdate) => {
            // The server asks if we are still here; a request with only a ping answers it and leaves the filters alone.
            if (update.ping) {
              pings += 1;
              stream.write({ ...request({}), transactions: {}, ping: { id: pings } }, () => {});
              return;
            }
            if (!update.transaction?.transaction?.meta?.logMessages) return;
            heard = Date.now();
            if (opts.core && !t.connected) {
              t.connected = true;
              delay = 1_000;
              log("[chain] pump.fun, LaunchLab and Meteora stream live");
            } else if (!opts.core && delay > 1_000) delay = 1_000;
            onData(update);
          });
          stream.on("error", reject);
          stream.on("end", resolve);
          stream.on("close", resolve);
          stream.write(request(wanted!), (error: unknown) => error && reject(error));
        }).finally(() => {
          clearInterval(timer);
          open.delete(stream);
        });
      } catch (error) {
        log(`[chain] ${name} stream error: ${(error as Error).message?.slice(0, 200)}`);
      }
      if (opts.core) t.connected = false;
      if (stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  };

  void lane("launches", () => ({ pump: filter([PUMP_PROGRAM]), launchlab: filter([LAUNCHLAB_PROGRAM]), dbc: filter([DBC_PROGRAM]) }), { stallMs: STREAM_STALL_MS, core: true });
  // Only the pools we follow: an empty list would mean every PumpSwap transaction, so no pools means no connection.
  void lane(
    "pools",
    () => {
      if (allPools) return { amm: filter([PUMP_AMM_PROGRAM]) };
      const pools = t.poolAddresses();
      return pools.length ? { amm: filter(pools) } : null;
    },
    { stallMs: 15 * 60_000, refreshMs: 60_000 },
  );
  const pruner = setInterval(() => t.prune(), 10 * 60_000);
  return () => {
    stopped = true;
    clearInterval(pruner);
    for (const s of open) s.end();
  };
}

/**
 * The same events, read from a relay instead of the stream: a small reader on a server the stream reaches at full
 * speed (it gave Railway a tenth of pump.fun), sending north the parsed events as lines of JSON. Picks up after the
 * last event it applied when the connection drops; a relay that restarted says so and is read from its start.
 */
export function startRelayFeed(t: PumpTape, { url, token, log = console.log }: Omit<StreamOptions, "allPools">): () => void {
  let stopped = false;
  let ctl: AbortController | null = null;
  let after = 0;
  let epoch = "";
  const run = async () => {
    let delay = 1_000;
    while (!stopped) {
      ctl = new AbortController();
      const c = ctl;
      let heard = Date.now();
      const stall = setInterval(() => Date.now() - heard > STREAM_STALL_MS && c.abort(new Error("relay quiet")), 15_000);
      try {
        const res = await fetch(`${url}/events?after=${after}`, { headers: { authorization: `Bearer ${token}` }, signal: c.signal });
        if (!res.ok || !res.body) throw new Error(`relay responded ${res.status}`);
        const dec = new TextDecoder();
        let buf = "";
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          heard = Date.now();
          buf += dec.decode(chunk, { stream: true });
          for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!line) continue;
            const msg = JSON.parse(line) as [number, PumpEvent, string | null, number | null] | { hello: string };
            if (!Array.isArray(msg)) {
              if (msg.hello !== epoch) ((epoch = msg.hello), (after = 0));
              continue;
            }
            const [seq, ev, tx, slot] = msg;
            if (seq <= after) continue;
            after = seq;
            if (!t.connected) {
              t.connected = true;
              delay = 1_000;
              log("[chain] relay live: pump.fun, LaunchLab and Meteora");
            }
            t.apply(ev, Date.now(), tx ?? undefined, slot ?? undefined);
          }
        }
      } catch (error) {
        if (!stopped) log(`[chain] relay error: ${(error as Error).message?.slice(0, 200)}`);
      } finally {
        clearInterval(stall);
      }
      t.connected = false;
      if (stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  };
  void run();
  const pruner = setInterval(() => t.prune(), 10 * 60_000);
  return () => {
    stopped = true;
    clearInterval(pruner);
    ctl?.abort();
  };
}
