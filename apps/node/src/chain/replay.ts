import { fundersEnabled } from "./funders.ts";
import type { HistoryStore } from "./history.ts";
import { parsePumpLogs, PumpTape } from "./pump.ts";

/**
 * A token the stream never saw, read from the chain after the fact: every transaction of its first hours, oldest
 * first, run through the same log parser the live stream uses, into a tape of its own, and the result written to the
 * long memory as if the stream had been there. From then on the X-Ray reads it like any other remembered launch.
 *
 * On demand only, behind the warden token: thousands of RPC calls for one token. Needs Helius (the RPC in SOLANA_RPC_URL).
 */

const RPC = process.env.SOLANA_RPC_URL ?? "";

export interface ReplayResult {
  mint: string;
  signatures: number;
  replayed: number;
  skipped: number;
  from: number | null;
  to: number | null;
  graduated: boolean;
  buyers: number;
  creator: string | null;
}

interface Sig {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

interface Tx {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown; logMessages?: string[] } | null;
}

async function call<T>(method: string, params: unknown[], f: typeof fetch, timeoutMs = 30_000): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await f(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 429) {
        await new Promise((res) => setTimeout(res, 1_500 * (attempt + 1)));
        continue;
      }
      const body = (await r.json()) as { result?: T };
      return body.result ?? null;
    } catch {
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
  return null;
}

/** Every signature of the address, newest first as the RPC gives them, up to `maxPages` thousand. */
async function signaturesOf(mint: string, f: typeof fetch, maxPages: number): Promise<Sig[]> {
  const all: Sig[] = [];
  let before: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const batch = await call<Sig[]>("getSignaturesForAddress", [mint, { limit: 1_000, ...(before ? { before } : {}) }], f);
    if (!batch?.length) break;
    all.push(...batch);
    before = batch[batch.length - 1]!.signature;
    if (batch.length < 1_000) break;
  }
  return all;
}

export interface ReplayOptions {
  /** How much of the token's life to read, from its launch. */
  hours?: number;
  /** Ceiling on transactions read. */
  maxTxs?: number;
  /** Pages of a thousand signatures to walk at most. */
  maxPages?: number;
  concurrency?: number;
  funderOf?: (creator: string) => string | null | undefined;
  log?: (m: string) => void;
}

export async function replayMint(mint: string, history: HistoryStore, opts: ReplayOptions = {}, f: typeof fetch = fetch): Promise<ReplayResult | { error: string }> {
  if (!fundersEnabled() || !RPC) return { error: "no Helius RPC on this node" };
  const { hours = 6, maxTxs = 8_000, maxPages = 60, concurrency = 8, funderOf, log = () => {} } = opts;

  const sigs = await signaturesOf(mint, f, maxPages);
  if (!sigs.length) return { error: "no transactions for this mint" };
  const ok = sigs.filter((s) => !s.err && s.blockTime).reverse();
  const first = ok[0]!.blockTime!;
  const window = ok.filter((s) => s.blockTime! - first <= hours * 3_600).slice(0, maxTxs);
  log(`replay ${mint}: ${sigs.length} signatures, ${window.length} in the first ${hours} h`);

  // Transactions in order, read a few at a time.
  const txs: Array<Tx | null> = new Array(window.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < window.length) {
      const i = next++;
      txs[i] = await call<Tx>("getTransaction", [window[i]!.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }], f);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const tape = new PumpTape();
  let replayed = 0, skipped = 0;
  for (let i = 0; i < window.length; i++) {
    const tx = txs[i];
    const logs = tx?.meta?.logMessages;
    if (!tx || tx.meta?.err || !logs) {
      skipped++;
      continue;
    }
    const at = (tx.blockTime ?? window[i]!.blockTime!) * 1000;
    const events = parsePumpLogs(logs);
    for (const ev of events) tape.apply(ev, at, window[i]!.signature, tx.slot);
    if (events.length) replayed++;
  }
  const last = window[window.length - 1]!.blockTime! * 1000;
  const rec = tape.historyOf(mint, last + 1_000);
  if (!rec) return { error: "the first transactions carry no launch the parser knows (not a pump.fun token?)" };
  history.write([{ ...rec, funder: funderOf?.(rec.creator) ?? null }]);
  log(`replay ${mint}: written, ${replayed} transactions with events, ${skipped} skipped, graduated ${rec.graduated}`);
  return {
    mint,
    signatures: sigs.length,
    replayed,
    skipped,
    from: first * 1000,
    to: last,
    graduated: rec.graduated,
    buyers: rec.facts.buyers,
    creator: rec.creator,
  };
}
