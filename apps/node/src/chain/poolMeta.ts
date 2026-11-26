import { createHash } from "node:crypto";
import { isOnCurve } from "./curve.ts";
import { base58, fromBase58 } from "./pumpParse.ts";

/**
 * A coin launched straight into a Raydium pool: the pool-opening transaction carries no name, symbol or supply. They are
 * read from the chain after the launch is on the tape: the mint account (supply, decimals and, on Token-2022, its own
 * metadata extension) and Metaplex's metadata account. One read at a time, spaced, and nothing waits on it.
 */
export const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export interface PoolMeta {
  name?: string;
  symbol?: string;
  /** Whole tokens, as the trades count them. */
  supply?: number;
}

type Rpc = <T>(method: string, params: unknown[]) => Promise<T | null>;

/** Solana's findProgramAddress: the first bump from 255 down whose hash is off the curve. */
export function programAddress(seeds: Buffer[], program: string): string {
  const pid = fromBase58(program);
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Buffer.from([bump]));
    h.update(pid);
    h.update("ProgramDerivedAddress");
    const d = h.digest();
    if (!isOnCurve(d)) return base58(d);
  }
  throw new Error("no program address");
}

export const metadataAddress = (mint: string) => programAddress([Buffer.from("metadata"), fromBase58(METADATA_PROGRAM), fromBase58(mint)], METADATA_PROGRAM);

const clean = (s: string) => s.replace(/\0/g, "").replace(/\s+/g, " ").trim();

/** Name and symbol from a Metaplex metadata account: key, update authority, mint, then two borsh strings. */
export function parseMetadata(data: Buffer): { name: string; symbol: string } | null {
  try {
    let o = 1 + 32 + 32;
    const str = () => {
      const n = data.readUInt32LE(o);
      if (n > 200) throw new Error("long");
      const s = data.subarray(o + 4, o + 4 + n).toString("utf8");
      o += 4 + n;
      return clean(s);
    };
    return { name: str().slice(0, 64), symbol: str().slice(0, 32) };
  } catch {
    return null;
  }
}

type ParsedMint = { value?: { data?: { parsed?: { info?: { supply?: string; decimals?: number; extensions?: Array<{ extension?: string; state?: { name?: string; symbol?: string } }> } } } } | null };

/** What the chain says of a mint; whatever could not be read is left out. Never throws. */
export async function readPoolMeta(mint: string, rpc: Rpc): Promise<PoolMeta> {
  const out: PoolMeta = {};
  try {
    const m = await rpc<ParsedMint>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
    const info = m?.value?.data?.parsed?.info;
    if (info?.supply && typeof info.decimals === "number") {
      const supply = Number(info.supply) / 10 ** info.decimals;
      if (supply > 0 && Number.isFinite(supply)) out.supply = supply;
    }
    const ext = info?.extensions?.find((e) => e.extension === "tokenMetadata")?.state;
    if (ext?.name) out.name = clean(ext.name).slice(0, 64);
    if (ext?.symbol) out.symbol = clean(ext.symbol).slice(0, 32);
  } catch {
    /* left out */
  }
  if (out.name && out.symbol) return out;
  try {
    const a = await rpc<{ value?: { data?: [string, string] } | null }>("getAccountInfo", [metadataAddress(mint), { encoding: "base64" }]);
    const b64 = a?.value?.data?.[0];
    const meta = b64 ? parseMetadata(Buffer.from(b64, "base64")) : null;
    if (meta?.name && !out.name) out.name = meta.name;
    if (meta?.symbol && !out.symbol) out.symbol = meta.symbol;
  } catch {
    /* left out */
  }
  return out;
}

/**
 * Mints waiting for their reads, one at a time with a gap between. A full queue drops new mints rather than grow:
 * a missing name is not worth falling behind for.
 */
export class PoolMetaQueue {
  private readonly queue: string[] = [];
  private running = false;
  private readonly rpc: Rpc;
  private readonly fill: (mint: string, meta: PoolMeta) => void;
  private readonly gapMs: number;
  private readonly max: number;
  constructor(rpc: Rpc, fill: (mint: string, meta: PoolMeta) => void, gapMs = 300, max = 500) {
    this.rpc = rpc;
    this.fill = fill;
    this.gapMs = gapMs;
    this.max = max;
  }

  add(mint: string): void {
    if (this.queue.length >= this.max || this.queue.includes(mint)) return;
    this.queue.push(mint);
    if (!this.running) void this.run();
  }

  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length) {
        const mint = this.queue.shift()!;
        try {
          const meta = await readPoolMeta(mint, this.rpc);
          if (meta.name || meta.symbol || meta.supply) this.fill(mint, meta);
        } catch {
          /* silent */
        }
        if (this.queue.length && this.gapMs) await new Promise((r) => setTimeout(r, this.gapMs));
      }
    } finally {
      this.running = false;
    }
  }
}
