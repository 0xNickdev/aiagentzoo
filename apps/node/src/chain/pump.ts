/**
 * The pump.fun tape: every launch and trade on the bonding curve, read straight from Solana as it happens.
 *
 * A Yellowstone gRPC stream delivers every transaction that touches the pump.fun program. Its logs carry
 * Anchor events (create, trade, complete); we decode the fields we need and keep a rolling 48-hour picture
 * per token: who launched it, how many bought and sold, and whether the creator already dumped their bag.
 * Without a stream configured, nothing here runs and the agents fall back to the pump.fun HTTP API.
 */

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const DISC = {
  create: Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]),
  trade: Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]),
  complete: Buffer.from([95, 114, 97, 156, 212, 46, 152, 8]),
};

export type PumpEvent =
  | { kind: "create"; name: string; symbol: string; mint: string; creator: string; ts: number | null }
  | { kind: "trade"; mint: string; sol: number; tokens: number; isBuy: boolean; user: string; ts: number; curveSol: number | null }
  | { kind: "complete"; mint: string };

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
}

interface Tracked {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  createdAt: number;
  buys: number;
  sells: number;
  buyers: Set<string>;
  solIn: number;
  solOut: number;
  curveSol: number | null;
  devBought: number;
  devSold: number;
  graduated: boolean;
}

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

  /** True while the stream is delivering; the agents only trust the tape then. */
  live(now = Date.now()): boolean {
    return this.connected && now - this.lastEventAt < 120_000;
  }

  apply(ev: PumpEvent, now = Date.now()): void {
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
        buyers: new Set(),
        solIn: 0,
        solOut: 0,
        curveSol: null,
        devBought: 0,
        devSold: 0,
        graduated: false,
      });
      const times = (this.launchesBy.get(ev.creator) ?? []).filter((t) => now - t < DAY_MS);
      times.push(createdAt);
      this.launchesBy.set(ev.creator, times);
      this.recent.unshift(ev.mint);
      if (this.recent.length > 500) this.recent.length = 500;
      this.seen.launches += 1;
      if (this.tokens.size > MAX_TRACKED) this.prune(now);
      return;
    }
    const t = this.tokens.get(ev.mint);
    // Trades on tokens launched before we started listening are not ours to judge.
    if (!t) return;
    if (ev.kind === "complete") {
      t.graduated = true;
      return;
    }
    this.seen.trades += 1;
    if (ev.isBuy) {
      t.buys += 1;
      t.solIn += ev.sol;
      if (t.buyers.size < 100) t.buyers.add(ev.user);
      if (ev.user === t.creator) t.devBought += ev.tokens;
    } else {
      t.sells += 1;
      t.solOut += ev.sol;
      if (ev.user === t.creator) t.devSold += ev.tokens;
    }
    if (ev.curveSol !== null) t.curveSol = ev.curveSol;
  }

  prune(now = Date.now()): void {
    for (const [mint, t] of this.tokens) if (now - t.createdAt > KEEP_MS) this.tokens.delete(mint);
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
    return { live: this.live(now), connected: this.connected, lastEventAt: this.lastEventAt || null, tracked: this.tokens.size, seen: this.seen };
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
          stream.on("data", (update: { transaction?: { transaction?: { meta?: { logMessages?: string[] } } }; ping?: unknown }) => {
            const logs = update.transaction?.transaction?.meta?.logMessages;
            if (!logs) return;
            if (!t.connected) {
              t.connected = true;
              delay = 1_000;
              log("[chain] pump.fun stream live");
            }
            for (const ev of parsePumpLogs(logs)) t.apply(ev);
          });
          stream.on("error", reject);
          stream.on("end", resolve);
          stream.on("close", resolve);
          stream.write(
            {
              accounts: {},
              slots: {},
              transactions: { pump: { vote: false, failed: false, accountInclude: [PUMP_PROGRAM], accountExclude: [], accountRequired: [] } },
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
