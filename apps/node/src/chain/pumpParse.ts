/**
 * The pump.fun log parser: the Anchor events a transaction's logs carry (create, trade, complete; pool created, buy,
 * sell), decoded to the fields the tape reads, and the base58 the chain spells its addresses in.
 */
import { isOnCurve } from "./curve.ts";
import type { ToolPrint } from "./fingerprint.ts";

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

/** Where a token was launched, when not pump.fun: Raydium LaunchLab, Meteora's curve, four.meme on BNB Chain, or Clanker on Base. */
export type Venue = "launchlab" | "dbc" | "fourmeme" | "flap" | "clanker";

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
      /** How the launch transaction was built; read from the whole transaction by the stream. */
      print?: ToolPrint;
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
