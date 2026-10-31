/**
 * Who paid for a launch bundle. Wallets that bought in the launch block look like strangers; if several of them got
 * their SOL from the same wallet shortly before, they are one person. For each bundle wallet we read its earliest
 * recent transactions and take the account that sent it SOL. Needs an RPC with room to breathe: Shyft's, through
 * SHYFT_API_KEY, or any SOLANA_RPC_URL.
 */

// Reading a wallet's past needs an RPC that keeps every signature: Helius when its key is set (Shyft's lists come back short).
export const HISTORY_RPC = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : (process.env.SOLANA_RPC_URL ?? (process.env.SHYFT_API_KEY ? `https://rpc.shyft.to?api_key=${process.env.SHYFT_API_KEY}` : ""));
const RPC = HISTORY_RPC;
const CACHE_MS = 10 * 60_000;

export interface FundingReport {
  checked: number;
  /** Funders that paid two or more of the bundle wallets, biggest group first. */
  groups: Array<{ funder: string; wallets: string[] }>;
  /** Bundle wallets traced back to some shared funder. */
  linked: number;
}

const cache = new Map<string, { at: number; report: FundingReport }>();

export const fundersEnabled = () => Boolean(RPC);

export async function rpc<T>(method: string, params: unknown[], fetchFn: typeof fetch): Promise<T | null> {
  try {
    const r = await fetchFn(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await r.json()) as { result?: T };
    return body.result ?? null;
  } catch {
    return null;
  }
}

interface ParsedTx {
  transaction: { message: { instructions: Array<{ program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } } }> } };
  meta?: { innerInstructions?: Array<{ instructions: Array<{ program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } } }> }> };
}

/** The wallet that most recently sent SOL into `wallet` before it started trading, or null. */
export async function funderOf(wallet: string, fetchFn: typeof fetch): Promise<string | null> {
  // The funding is the wallet's first transfer in, so read back to the very start of its history:
  // a serial launcher's latest pages are all launches, its funding sits under them.
  let sigs: Array<{ signature: string }> = [];
  // Helius answers oldest-first in one call; any other RPC falls back to paging back through the history.
  const first = await rpc<{ data?: Array<{ signature: string }> }>("getTransactionsForAddress", [wallet, { sortOrder: "asc", limit: 8, transactionDetails: "signatures" }], fetchFn);
  if (first?.data?.length) {
    sigs = [...first.data].reverse();
  }
  let before: string | undefined;
  for (let page = 0; page < 8 && !sigs.length; page++) {
    const got = await rpc<Array<{ signature: string }>>("getSignaturesForAddress", [wallet, { limit: 1000, ...(before ? { before } : {}) }], fetchFn);
    if (!got?.length) break;
    if (got.length < 1000 || page === 7) sigs = got;
    before = got[got.length - 1]!.signature;
    if (got.length < 1000) break;
  }
  if (!sigs.length) return null;
  // Oldest first: the funding usually comes just before the first buy.
  for (const { signature } of [...sigs].reverse().slice(0, 6)) {
    const tx = await rpc<ParsedTx>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }], fetchFn);
    if (!tx) continue;
    const all = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions)];
    const transfer = all.find(
      (i) => i.program === "system" && i.parsed?.type === "transfer" && i.parsed.info?.destination === wallet && (i.parsed.info.lamports ?? 0) >= 10_000_000,
    );
    if (transfer?.parsed?.info?.source) return transfer.parsed.info.source;
  }
  return null;
}

/** Traces who funded a bundle's wallets; null when no RPC is configured. */
export async function traceFunders(mint: string, wallets: string[], fetchFn: typeof fetch = fetch, now = Date.now()): Promise<FundingReport | null> {
  if (!RPC) return null;
  const hit = cache.get(mint);
  if (hit && now - hit.at < CACHE_MS) return hit.report;
  const sample = wallets.slice(0, 10);
  const funders = await Promise.all(sample.map((w) => funderOf(w, fetchFn)));
  const byFunder = new Map<string, string[]>();
  sample.forEach((w, i) => {
    const f = funders[i];
    if (f) byFunder.set(f, [...(byFunder.get(f) ?? []), w]);
  });
  const groups = [...byFunder.entries()].filter(([, ws]) => ws.length >= 2).map(([funder, ws]) => ({ funder, wallets: ws })).sort((a, b) => b.wallets.length - a.wallets.length);
  const report: FundingReport = { checked: sample.length, groups, linked: groups.reduce((n, g) => n + g.wallets.length, 0) };
  cache.set(mint, { at: now, report });
  if (cache.size > 2_000) for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k);
  return report;
}
