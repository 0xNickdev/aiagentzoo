import { createHash } from "node:crypto";
import { base58 } from "./pumpParse.ts";

/**
 * A launch's tool print: how the transaction that created the token was built, not who signed it.
 *
 * Launch bots and bundlers are configured once and then fire hundreds of launches from fresh wallets. Every one of
 * those transactions carries the same build: the same compute unit limit and price, the same tip to the same block
 * engine for the same lamports, the same programs in the same order, the same number of signers, the same metadata
 * host. A wallet is free to replace; a tool's configuration is not. Two launches with one print were not necessarily
 * made by one person (pump.fun's own site gives thousands of people the same print), so the zoo never says "same
 * operator": it says what the other launches made this way did, and how many wallets made them.
 */

export interface ToolPrint {
  /** Short stable id of the exact build, e.g. "a3f91c". */
  key: string;
  /**
   * The build without its fee amounts, prefixed "s": many bots price compute and tips per transaction, so the exact
   * key changes every launch while the shape (programs, limit, tip service, signers, tables, host) stays.
   */
  shape: string;
  cuLimit: number | null;
  /** Micro-lamports per compute unit. */
  cuPrice: number | null;
  /** A top-level SOL transfer to a block engine or relay: Jito's tip accounts by name, any other by address. */
  tip: { to: string; lamports: number } | null;
  /** Top-level programs in order, known ones by name. */
  programs: string[];
  signers: number;
  /** Uses address lookup tables: a versioned transaction built by a tool, never by pump.fun's site. */
  lut: boolean;
  /** Where the token's metadata is hosted. */
  host: string | null;
}

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";

const KNOWN: Record<string, string> = {
  [COMPUTE_BUDGET]: "budget",
  [SYSTEM]: "system",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "pump",
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: "pumpswap",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "ata",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "token2022",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "memo",
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: "launchlab",
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: "dbc",
};

/** Jito's eight tip accounts: a transfer to any of them is a Jito tip, whichever one the tool picked. */
const JITO_TIPS = new Set([
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
]);

type Ix = { programIdIndex: number; accounts: Uint8Array | number[]; data: Uint8Array };
/** The parts of a Yellowstone transaction update the print reads. */
export interface PrintableTx {
  transaction?: {
    message?: {
      header?: { numRequiredSignatures?: number };
      accountKeys?: Uint8Array[];
      instructions?: Ix[];
      addressTableLookups?: unknown[];
    };
  };
  meta?: { loadedWritableAddresses?: Uint8Array[]; loadedReadonlyAddresses?: Uint8Array[] };
}

const u32 = (d: Uint8Array, at: number) => (d.length >= at + 4 ? Buffer.from(d.buffer, d.byteOffset, d.byteLength).readUInt32LE(at) : null);
const u64 = (d: Uint8Array, at: number) => (d.length >= at + 8 ? Number(Buffer.from(d.buffer, d.byteOffset, d.byteLength).readBigUInt64LE(at)) : null);

export function hostOf(uri: string | undefined | null): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The print of a launch transaction, or null when the update does not carry the message. */
export function toolPrintOf(tx: PrintableTx, uri?: string | null): ToolPrint | null {
  const m = tx.transaction?.message;
  if (!m?.accountKeys || !m.instructions) return null;
  const keys = [...m.accountKeys, ...(tx.meta?.loadedWritableAddresses ?? []), ...(tx.meta?.loadedReadonlyAddresses ?? [])].map((k) => base58(k));
  const signers = m.header?.numRequiredSignatures ?? 1;
  let cuLimit: number | null = null;
  let cuPrice: number | null = null;
  let tip: ToolPrint["tip"] = null;
  const programs: string[] = [];
  for (const ix of m.instructions) {
    const program = keys[ix.programIdIndex] ?? "?";
    const name = KNOWN[program] ?? program.slice(0, 6);
    // Repeats collapse: "ata, ata" and "ata" are the same build with a different number of accounts.
    if (programs[programs.length - 1] !== name) programs.push(name);
    const d = ix.data;
    if (program === COMPUTE_BUDGET) {
      if (d[0] === 2) cuLimit = u32(d, 1);
      else if (d[0] === 3) cuPrice = u64(d, 1);
    } else if (program === SYSTEM && !tip && u32(d, 0) === 2) {
      // A transfer to an account that does not sign: a tip, or the tool's own fee wallet.
      const to = keys[ix.accounts[1] ?? -1];
      const toIndex = ix.accounts[1] ?? 0;
      const lamports = u64(d, 4);
      if (to && lamports !== null && toIndex >= signers) tip = { to: JITO_TIPS.has(to) ? "jito" : to, lamports };
    }
  }
  const lut = (m.addressTableLookups?.length ?? 0) > 0;
  const host = hostOf(uri);
  const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 6);
  const key = hash([programs, cuLimit, cuPrice, tip?.to ?? null, tip?.lamports ?? null, signers, lut, host]);
  const shape = `s${hash([programs, cuLimit, tip?.to ?? null, signers, lut, host])}`;
  return { key, shape, cuLimit, cuPrice, tip, programs, signers, lut, host };
}

/** What the zoo says about a print, from the launches on the tape made with it. */
export interface PrintRecord {
  key: string;
  print: ToolPrint;
  launches: number;
  wallets: number;
  /** Launches old enough to judge (ten minutes or more) and how many of those the creator dumped. */
  settled: number;
  dumped: number;
  /** Shared by so many wallets that it is a public launcher's default, not one operator's setup. */
  common: boolean;
}

/** Beyond this many wallets a print is a launcher everyone uses: it says nothing about one launch. */
export const COMMON_WALLETS = 150;

/**
 * The plain sentence the check adds when a fresh wallet launches with a print whose other launches mostly dumped.
 * Null when the print is common, too thin to say anything, or not bad.
 */
export function printWarning(r: PrintRecord | null, creatorOwnLaunches: number, similar = false): string | null {
  if (!r || r.common) return null;
  const others = r.wallets - 1;
  if (others < 3 || r.settled < 10) return null;
  const rate = r.dumped / r.settled;
  if (rate < 0.9) return null;
  const fresh = creatorOwnLaunches <= 1 ? "a fresh wallet, but " : "";
  return `${fresh}launched with ${similar ? "a tool setup built like that of" : "the same tool setup as"} ${others} other wallets in two days; their creators dumped ${r.dumped} of ${r.settled} of those launches`;
}
