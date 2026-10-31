import { fundersEnabled, HISTORY_RPC } from "./funders.ts";
import type { HistoryStore } from "./history.ts";
import { parsePumpLogs, PumpTape } from "./pump.ts";

/**
 * A token the stream never saw, read from the chain after the fact: every transaction of its first hours, oldest
 * first, run through the same log parser the live stream uses, into a tape of its own, and the result written to the
 * long memory as if the stream had been there. From then on the X-Ray reads it like any other remembered launch.
 *
 * On demand only, behind the warden token: thousands of RPC calls for one token. Needs Helius (the RPC in SOLANA_RPC_URL).
 */

const RPC = HISTORY_RPC;

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

/**
 * The signatures of the address from its first transaction on, through Helius's oldest-first paging, stopping once
 * the window after the launch is covered. A token with a million transactions costs the same as a small one.
 */
async function signaturesFromLaunch(mint: string, f: typeof fetch, hours: number, maxTxs: number): Promise<Sig[]> {
  const all: Sig[] = [];
  let token: string | undefined;
  let first: number | null = null;
  for (let page = 0; page < 200; page++) {
    const r = await call<{ data?: Sig[]; paginationToken?: string }>(
      "getTransactionsForAddress",
      [mint, { sortOrder: "asc", limit: 1_000, transactionDetails: "signatures", ...(token ? { paginationToken: token } : {}) }],
      f,
    );
    const batch = r?.data ?? [];
    if (!batch.length) break;
    for (const s of batch) {
      if (s.err || !s.blockTime) continue;
      if (first === null) first = s.blockTime;
      if (s.blockTime - first > hours * 3_600) return all;
      all.push(s);
      if (all.length >= maxTxs) return all;
    }
    token = r?.paginationToken;
    if (!token) break;
  }
  return all;
}

export interface ReplayOptions {
  /** How much of the token's life to read, from its launch. */
  hours?: number;
  /** Ceiling on transactions read. */
  maxTxs?: number;
  concurrency?: number;
  funderOf?: (creator: string) => string | null | undefined;
  log?: (m: string) => void;
}

export async function replayMint(mint: string, history: HistoryStore, opts: ReplayOptions = {}, f: typeof fetch = fetch): Promise<ReplayResult | { error: string }> {
  if (!fundersEnabled() || !RPC) return { error: "no Helius RPC on this node" };
  const { hours = 6, maxTxs = 8_000, concurrency = 8, funderOf, log = () => {} } = opts;
  log(`replay ${mint}: reading signatures`);

  const window = await signaturesFromLaunch(mint, f, hours, maxTxs);
  if (!window.length) return { error: "no transactions for this mint" };
  const first = window[0]!.blockTime!;
  log(`replay ${mint}: ${window.length} transactions in the first ${hours} h, from ${new Date(first * 1000).toISOString()}`);

  // Transactions in order, read a few at a time.
  const txs: Array<Tx | null> = new Array(window.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < window.length) {
      const i = next++;
      txs[i] = await call<Tx>("getTransaction", [window[i]!.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }], f);
    }
  };
  const progress = setInterval(() => log(`replay ${mint}: ${next} of ${window.length} transactions read`), 60_000);
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    clearInterval(progress);
  }

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
  if (!rec) {
    log(`replay ${mint}: no launch the parser knows in the first transactions`);
    return { error: "the first transactions carry no launch the parser knows (not a pump.fun token?)" };
  }
  try {
    history.write([{ ...rec, funder: funderOf?.(rec.creator) ?? null }]);
  } catch (error) {
    log(`replay ${mint}: write failed: ${error instanceof Error ? error.message : String(error)}`);
    return { error: "the long memory refused the record" };
  }
  log(`replay ${mint}: written, ${replayed} transactions with events, ${skipped} skipped, graduated ${rec.graduated}`);
  return {
    mint,
    signatures: window.length,
    replayed,
    skipped,
    from: first * 1000,
    to: last,
    graduated: rec.graduated,
    buyers: rec.facts.buyers,
    creator: rec.creator,
  };
}
