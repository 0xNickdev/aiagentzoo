/**
 * The pump.fun tape: every launch and trade on the bonding curve, read straight from Solana as it happens.
 *
 * A Yellowstone gRPC stream delivers every transaction that touches the pump.fun program or PumpSwap. Its logs
 * carry Anchor events (create, trade, complete; pool created, buy, sell); we decode the fields we need and keep a
 * rolling 48-hour picture per token: who launched it, how many bought and sold, whether the creator already dumped
 * their bag, and once it graduates, how its PumpSwap pool is doing.
 * Without a stream configured, nothing here runs and the agents fall back to the pump.fun HTTP API.
 */

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
/** PumpSwap, where a token's pool lives once it graduates from the curve. */
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const WSOL = "So11111111111111111111111111111111111111112";

const DISC = {
  create: Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]),
  trade: Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]),
  complete: Buffer.from([95, 114, 97, 156, 212, 46, 152, 8]),
  // PumpSwap events: a pool is created when a token graduates, then buys and sells on it.
  pool: Buffer.from([177, 49, 12, 210, 160, 118, 167, 116]),
  ammBuy: Buffer.from([103, 244, 82, 31, 44, 245, 119, 119]),
  ammSell: Buffer.from([62, 47, 55, 10, 165, 3, 220, 42]),
};

export type PumpEvent =
  | { kind: "create"; name: string; symbol: string; mint: string; creator: string; ts: number | null }
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

class Reader {
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
        r.str(); // uri
        const mint = r.key();
        r.key(); // bonding curve
        const user = r.key();
        // Newer versions add the creator and a timestamp; older ones stop at the user, who is the creator.
        const creator = r.left() >= 32 ? r.key() : user;
        const ts = r.left() >= 8 ? Number(r.i64()) * 1000 : null;
        out.push({ kind: "create", name: name.slice(0, 64), symbol: symbol.slice(0, 32), mint: base58(mint), creator: base58(creator), ts });
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
        const ts = Number(r.i64()) * 1000;
        const f: bigint[] = [];
        for (let i = 0; i < 13; i++) f.push(r.u64());
        const pool = base58(r.key());
        const user = base58(r.key());
        out.push({ kind: "swap", pool, isBuy: head.equals(DISC.ammBuy), tokens: Number(f[0]) / TOKEN_UNITS, sol: Number(f[12]) / LAMPORTS, poolSol: Number(f[5]) / LAMPORTS, user, ts });
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
  buys: number;
  sells: number;
  /** Distinct wallets that bought, capped at 100 to bound memory across tens of thousands of tokens. */
  buyers: number;
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
  /** Buyers who came back and bought again: real interest leaves repeat buyers. */
  repeatBuyers: number;
  /** Trades in the first 15 minutes after launch. */
  trades15m: number;
  /** Wallets other than the creator that bought in the launch block or the next: a bundle. Null when the stream gave no slots. */
  bundleWallets: number | null;
  /** Share of the whole supply those wallets took, 0..1. */
  bundleShare: number | null;
  /** After graduation, on PumpSwap: SOL in the pool now, null before it has one. */
  poolSol: number | null;
  ammBuys: number;
  ammSells: number;
  ammSolIn: number;
  ammSolOut: number;
}

/** pump.fun mints a billion tokens. */
const SUPPLY = 1_000_000_000;
/** A buy this many slots after the create still counts as part of the launch bundle. */
const BUNDLE_SLOTS = 1;

interface Tracked {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  createdAt: number;
  buys: number;
  sells: number;
  buyers: Map<string, { sol: number; buys: number }>;
  trades15m: number;
  solIn: number;
  solOut: number;
  curveSol: number | null;
  devBought: number;
  devSold: number;
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
  ammBuys: number;
  ammSells: number;
  ammSolIn: number;
  ammSolOut: number;
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
  recent: Array<{ mint: string; symbol: string; createdAt: number; dumpedAfterMin: number | null; graduated: boolean }>;
}

/** A fresh token that passed the basic checks the tape can make; not a judgement of its worth. */
export interface CleanLaunch {
  mint: string;
  symbol: string;
  name: string;
  ageMin: number;
  buyers: number;
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
  kind: "launch" | "serial" | "dump" | "graduated" | "whale";
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
/** A single buy this big stands out on a fresh pump.fun token. */
const WHALE_SOL = 10;

const KEEP_MS = 48 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const MAX_TRACKED = 30_000;

export class PumpTape {
  private readonly tokens = new Map<string, Tracked>();
  private readonly launchesBy = new Map<string, number[]>();
  /** Newest launches first, mints only. */
  private recent: string[] = [];
  connected = false;
  lastEventAt = 0;
  seen = { launches: 0, trades: 0 };
  private pulse: PulseEvent[] = [];
  private pulseSeq = 0;
  /** Mints each creator launched, newest last, for as long as the tokens are kept. */
  private readonly byCreator = new Map<string, string[]>();
  /** PumpSwap pools of the tokens on the tape, pool to mint. */
  private readonly pools = new Map<string, string>();
  /** Every loud moment (not plain launches) of the last two days, oldest first. */
  private moments: PulseEvent[] = [];
  /** Per-second counts over the last minute, a ring indexed by second. */
  private readonly seconds = Array.from({ length: 60 }, () => ({ sec: -1, launches: 0, trades: 0 }));

  private emit(at: number, kind: PulseEvent["kind"], t: { mint: string; symbol: string; creator: string }, text: string, tx?: string): void {
    const symbol = t.symbol.replace(/\s+/g, " ").trim().slice(0, 16) || "?";
    const e: PulseEvent = { seq: ++this.pulseSeq, at, kind, mint: t.mint, symbol, text, creator: t.creator, ...(tx ? { tx } : {}) };
    this.pulse.push(e);
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
        graduated: false,
        dumped: false,
        dumpedAt: null,
        createSlot: slot ?? null,
        launchBuys: new Map(),
        pool: null,
        poolSol: null,
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
      if (this.recent.length > 500) this.recent.length = 500;
      this.seen.launches += 1;
      this.count(now, "launches");
      if (times.length >= 5) this.emit(now, "serial", ev, `wallet's ${ordinal(times.length)} launch today`, tx);
      else this.emit(now, "launch", ev, "new launch", tx);
      if (this.tokens.size > MAX_TRACKED) this.prune(now);
      return;
    }
    if (ev.kind === "swap") return this.swap(ev, now, tx);
    const t = this.tokens.get(ev.mint);
    // Trades on tokens launched before we started listening are not ours to judge.
    if (!t) return;
    if (ev.kind === "complete" || ev.kind === "pool") {
      if (!t.graduated) this.emit(now, "graduated", t, "graduated", tx);
      t.graduated = true;
      if (ev.kind === "pool") {
        t.pool = ev.pool;
        this.pools.set(ev.pool, t.mint);
      }
      return;
    }
    this.seen.trades += 1;
    this.count(now, "trades");
    if (ev.ts - t.createdAt <= 15 * 60_000) t.trades15m += 1;
    if (ev.isBuy) {
      t.buys += 1;
      t.solIn += ev.sol;
      const b = t.buyers.get(ev.user);
      if (b) {
        b.sol += ev.sol;
        b.buys += 1;
      } else if (t.buyers.size < 100) t.buyers.set(ev.user, { sol: ev.sol, buys: 1 });
      if (ev.user === t.creator) t.devBought += ev.tokens;
      else if (t.createSlot !== null && slot !== undefined && slot - t.createSlot <= BUNDLE_SLOTS) {
        t.launchBuys.set(ev.user, (t.launchBuys.get(ev.user) ?? 0) + ev.tokens);
      }
      if (ev.sol >= WHALE_SOL) this.emit(now, "whale", t, `+${ev.sol.toFixed(1)} SOL buy`, tx);
    } else {
      t.sells += 1;
      t.solOut += ev.sol;
      if (ev.user === t.creator) this.creatorSold(t, ev.tokens, ev.ts, now, tx);
    }
    if (ev.curveSol !== null) t.curveSol = ev.curveSol;
  }

  private creatorSold(t: Tracked, tokens: number, ts: number, now: number, tx?: string): void {
    t.devSold += tokens;
    if (!t.dumped && t.devBought > 0 && t.devSold / t.devBought >= 0.5) {
      t.dumped = true;
      t.dumpedAt = ts;
      const pct = Math.round(Math.min(1, t.devSold / t.devBought) * 100);
      const min = Math.max(0, Math.round((ts - t.createdAt) / 60_000));
      this.emit(now, "dump", t, `creator sold ${pct}% after ${min} min`, tx);
    }
  }

  /** Life after the curve: trades on the PumpSwap pools of tokens we watched launch. */
  private swap(ev: Extract<PumpEvent, { kind: "swap" }>, now: number, tx?: string): void {
    const mint = this.pools.get(ev.pool);
    const t = mint ? this.tokens.get(mint) : undefined;
    if (!t) return;
    this.seen.trades += 1;
    this.count(now, "trades");
    t.poolSol = ev.poolSol;
    if (ev.isBuy) {
      t.ammBuys += 1;
      t.ammSolIn += ev.sol;
      if (ev.sol >= WHALE_SOL) this.emit(now, "whale", t, `+${ev.sol.toFixed(1)} SOL buy after graduation`, tx);
    } else {
      t.ammSells += 1;
      t.ammSolOut += ev.sol;
      if (ev.user === t.creator) this.creatorSold(t, ev.tokens, ev.ts, now, tx);
    }
  }

  /**
   * The whole tape, so a restart (a deploy) does not forget two days of launches, creators and pools.
   * Maps become arrays; what can be rebuilt (creators' mints, pools) is rebuilt on load.
   */
  snapshot(): string {
    const tokens = [...this.tokens.values()].map((t) => ({ ...t, buyers: [...t.buyers], launchBuys: [...t.launchBuys] }));
    return JSON.stringify({ v: 1, tokens, launchesBy: [...this.launchesBy], recent: this.recent, seen: this.seen });
  }

  load(json: string, now = Date.now()): number {
    try {
      const saved = JSON.parse(json) as {
        v?: number;
        tokens?: Array<Omit<Tracked, "buyers" | "launchBuys" | "pool" | "poolSol" | "ammBuys" | "ammSells" | "ammSolIn" | "ammSolOut"> & Partial<Tracked> & { buyers: [string, { sol: number; buys: number }][]; launchBuys: [string, number][] }>;
        launchesBy?: [string, number[]][];
        recent?: string[];
        seen?: { launches: number; trades: number };
      };
      if (saved.v !== 1) return 0;
      for (const s of saved.tokens ?? []) {
        if (!s?.mint || now - s.createdAt > KEEP_MS || this.tokens.has(s.mint)) continue;
        // Fields added after a snapshot was written start empty.
        const t: Tracked = {
          ...s,
          pool: s.pool ?? null,
          poolSol: s.poolSol ?? null,
          ammBuys: s.ammBuys ?? 0,
          ammSells: s.ammSells ?? 0,
          ammSolIn: s.ammSolIn ?? 0,
          ammSolOut: s.ammSolOut ?? 0,
          buyers: new Map(s.buyers ?? []),
          launchBuys: new Map(s.launchBuys ?? []),
        };
        this.tokens.set(t.mint, t);
        const mine = this.byCreator.get(t.creator) ?? [];
        mine.push(t.mint);
        this.byCreator.set(t.creator, mine);
        if (t.pool) this.pools.set(t.pool, t.mint);
      }
      for (const mints of this.byCreator.values()) mints.sort((a, b) => this.tokens.get(a)!.createdAt - this.tokens.get(b)!.createdAt);
      for (const [creator, times] of saved.launchesBy ?? []) {
        const kept = times.filter((x) => now - x < DAY_MS);
        if (kept.length) this.launchesBy.set(creator, kept);
      }
      this.recent = [...(saved.recent ?? []).filter((m) => this.tokens.has(m)), ...this.recent.filter((m) => !(saved.recent ?? []).includes(m))].slice(0, 500);
      if (saved.seen) this.seen = { launches: this.seen.launches + saved.seen.launches, trades: this.seen.trades + saved.seen.trades };
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

  facts(mint: string, now = Date.now()): ChainFacts | null {
    const t = this.tokens.get(mint);
    if (!t) return null;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return {
      ageMin: Math.max(0, Math.round((now - t.createdAt) / 60_000)),
      buys: t.buys,
      sells: t.sells,
      buyers: t.buyers.size,
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
      bundleShare: t.createSlot === null ? null : round([...t.launchBuys.values()].reduce((a, b) => a + b, 0) / SUPPLY),
      poolSol: t.poolSol === null ? null : round(t.poolSol),
      ammBuys: t.ammBuys,
      ammSells: t.ammSells,
      ammSolIn: round(t.ammSolIn),
      ammSolOut: round(t.ammSolOut),
    };
  }

  /** A creator wallet's last two days: how often it launches, how often it dumps, and how fast. */
  creator(wallet: string, now = Date.now()): CreatorRecord | null {
    const tokens = (this.byCreator.get(wallet) ?? []).map((m) => this.tokens.get(m)).filter((t): t is Tracked => Boolean(t));
    if (!tokens.length) return null;
    const minutes = tokens.filter((t) => t.dumpedAt !== null).map((t) => Math.max(0, Math.round((t.dumpedAt! - t.createdAt) / 60_000))).sort((a, b) => a - b);
    return {
      wallet,
      launches24h: tokens.filter((t) => now - t.createdAt < DAY_MS).length,
      launches48h: tokens.length,
      dumped: minutes.length,
      medianDumpMin: minutes.length ? minutes[Math.floor(minutes.length / 2)]! : null,
      graduated: tokens.filter((t) => t.graduated).length,
      recent: tokens
        .slice(-12)
        .reverse()
        .map((t) => ({
          mint: t.mint,
          symbol: t.symbol,
          createdAt: t.createdAt,
          dumpedAfterMin: t.dumpedAt === null ? null : Math.max(0, Math.round((t.dumpedAt - t.createdAt) / 60_000)),
          graduated: t.graduated,
        })),
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
      r.recent = r.recent.slice(0, 5);
    }
    return top;
  }

  /**
   * Fresh launches that pass the checks the tape can make: the creator has not sold, the wallet is not a serial
   * launcher, the buying is spread across many wallets and some came back for more. It says nothing about whether
   * a token is worth anything, only that the usual rug signs are absent so far.
   */
  clean(limit = 20, now = Date.now()): CleanLaunch[] {
    const out: CleanLaunch[] = [];
    for (const mint of this.recent) {
      if (out.length >= limit) break;
      const t = this.tokens.get(mint);
      if (!t) continue;
      const age = (now - t.createdAt) / 60_000;
      if (age < 10 || age > 180) continue;
      const f = this.facts(mint, now)!;
      if (f.creatorSold !== null && f.creatorSold > 0.1) continue;
      if (f.creatorLaunches24h > 2) continue;
      if (f.buyers < 25 || f.repeatBuyers < 3) continue;
      if (f.top5Share === null || f.top5Share > 0.5) continue;
      if (f.buys <= f.sells) continue;
      out.push({ mint, symbol: t.symbol.slice(0, 16), name: t.name.slice(0, 40), ageMin: Math.round(age), buyers: f.buyers, repeatBuyers: f.repeatBuyers, top5Share: f.top5Share, creatorSold: f.creatorSold, curveSol: f.curveSol, graduated: f.graduated });
    }
    return out;
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
      bundle: [...t.launchBuys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([wallet, tokens]) => ({ wallet, share: Math.round((tokens / SUPPLY) * 10_000) / 10_000 })),
    };
  }

  /** The newest launches, as the sentinels expect them, each with its chain facts attached. */
  launches(limit: number, now = Date.now()) {
    return this.recent.slice(0, limit).flatMap((mint) => {
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
}

/** Keeps a Yellowstone subscription to the pump.fun program open, reconnecting with backoff, feeding the tape. */
export async function startPumpStream(t: PumpTape, { url, token, log = console.log }: StreamOptions): Promise<() => void> {
  type Yellowstone = typeof import("@triton-one/yellowstone-grpc");
  const mod = (await import("@triton-one/yellowstone-grpc")) as unknown as Yellowstone & { default: Yellowstone["default"] | { default: Yellowstone["default"] } };
  // A CommonJS package seen from ESM: the class is the default export, possibly wrapped once more.
  const Client = ("default" in mod.default ? mod.default.default : mod.default) as Yellowstone["default"];
  const CommitmentLevel = mod.CommitmentLevel ?? (mod.default as unknown as Yellowstone).CommitmentLevel;
  let stopped = false;
  let current: { end(): void } | null = null;
  let delay = 1_000;

  const run = async () => {
    while (!stopped) {
      try {
        const client = new Client(url, token, undefined);
        await client.connect();
        const stream = await client.subscribe();
        current = stream;
        await new Promise<void>((resolve, reject) => {
          stream.on("data", (update: { transaction?: { slot?: string | number; transaction?: { signature?: Uint8Array; meta?: { logMessages?: string[] } } }; ping?: unknown }) => {
            const logs = update.transaction?.transaction?.meta?.logMessages;
            if (!logs) return;
            if (!t.connected) {
              t.connected = true;
              delay = 1_000;
              log("[chain] pump.fun stream live");
            }
            const sig = update.transaction?.transaction?.signature;
            const tx = sig && sig.length ? base58(sig) : undefined;
            const slot = update.transaction?.slot !== undefined ? Number(update.transaction.slot) : undefined;
            for (const ev of parsePumpLogs(logs)) t.apply(ev, Date.now(), tx, Number.isFinite(slot) ? slot : undefined);
          });
          stream.on("error", reject);
          stream.on("end", resolve);
          stream.on("close", resolve);
          stream.write(
            {
              accounts: {},
              slots: {},
              transactions: {
                pump: { vote: false, failed: false, accountInclude: [PUMP_PROGRAM], accountExclude: [], accountRequired: [] },
                amm: { vote: false, failed: false, accountInclude: [PUMP_AMM_PROGRAM], accountExclude: [], accountRequired: [] },
              },
              transactionsStatus: {},
              blocks: {},
              blocksMeta: {},
              entry: {},
              accountsDataSlice: [],
              commitment: CommitmentLevel.CONFIRMED,
            },
            (error: unknown) => error && reject(error),
          );
        });
      } catch (error) {
        log(`[chain] stream error: ${(error as Error).message?.slice(0, 200)}`);
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
    current?.end();
  };
}
