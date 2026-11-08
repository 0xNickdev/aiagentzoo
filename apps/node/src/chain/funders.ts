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

type Ix = { program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } } };
type Key = string | { pubkey: string; signer?: boolean };
interface ParsedTx {
  transaction: { message: { accountKeys?: Key[]; instructions: Ix[] } };
  meta?: { err?: unknown; preBalances?: number[]; postBalances?: number[]; innerInstructions?: Array<{ instructions: Ix[] }> };
}

/** An RPC call that tells a failure (rate limit, timeout) apart from an empty answer. */
async function call<T>(method: string, params: unknown[], fetchFn: typeof fetch): Promise<{ ok: true; result: T | null } | { ok: false }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchFn(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8_000) });
      if (r.status === 429 || r.status >= 500) throw new Error(String(r.status));
      const body = (await r.json()) as { result?: T; error?: { code?: number } };
      // -32429 and friends: the provider's own rate limit inside a 200.
      if (body.error && body.error.code !== -32602 && body.error.code !== -32601) throw new Error("rpc error");
      if (body.error) return { ok: true, result: null };
      return { ok: true, result: body.result ?? null };
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1) ** 2));
    }
  }
  return { ok: false };
}

const MIN_FUNDING = 10_000_000;
/** Who sent SOL into `wallet` in this transaction: a plain transfer, or failing that, whoever paid when its balance rose. */
export function fundingIn(tx: ParsedTx | null, wallet: string): string | null {
  if (!tx || tx.meta?.err) return null;
  const all = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions)];
  const transfer = all.find((i) => i.program === "system" && i.parsed?.type === "transfer" && i.parsed.info?.destination === wallet && (i.parsed.info.lamports ?? 0) >= MIN_FUNDING);
  if (transfer?.parsed?.info?.source) return transfer.parsed.info.source;
  // Money routed through a program (a distributor, a multisend): the wallet's balance rose and it did not sign.
  const keys = (tx.transaction.message.accountKeys ?? []).map((k) => (typeof k === "string" ? { pubkey: k, signer: false } : { pubkey: k.pubkey, signer: !!k.signer }));
  const i = keys.findIndex((k) => k.pubkey === wallet);
  const pre = tx.meta?.preBalances;
  const post = tx.meta?.postBalances;
  if (i < 0 || !pre || !post || keys[i]!.signer || (post[i] ?? 0) - (pre[i] ?? 0) < MIN_FUNDING) return null;
  // The signer whose balance fell the most paid for it.
  let payer: string | null = null;
  let fell = 0;
  keys.forEach((k, j) => {
    const d = (pre[j] ?? 0) - (post[j] ?? 0);
    if (k.signer && k.pubkey !== wallet && d > fell) (payer = k.pubkey), (fell = d);
  });
  return payer;
}

export type FunderRead = { funder: string | null; why: "found" | "none" | "rpc" | "long" };
/**
 * The wallet that first sent SOL into `wallet`, and why not when there is none: "none" is an answer (the history holds
 * no funding), "rpc" is a failed read worth asking again, "long" a history too deep to page back to its start.
 */
export async function readFunder(wallet: string, fetchFn: typeof fetch): Promise<FunderRead> {
  // The funding is the wallet's first transfer in, so read back to the very start of its history:
  // a serial launcher's latest pages are all launches, its funding sits under them.
  let sigs: Array<{ signature: string }> = [];
  // Helius answers oldest-first in one call; any other RPC falls back to paging back through the history.
  const first = await call<{ data?: Array<{ signature: string }> }>("getTransactionsForAddress", [wallet, { sortOrder: "asc", limit: 8, transactionDetails: "signatures" }], fetchFn);
  if (first.ok && first.result?.data?.length) sigs = first.result.data;
  else {
    let before: string | undefined;
    let done = false;
    for (let page = 0; page < 8; page++) {
      const got = await call<Array<{ signature: string }>>("getSignaturesForAddress", [wallet, { limit: 1000, ...(before ? { before } : {}) }], fetchFn);
      if (!got.ok) return { funder: null, why: "rpc" };
      const list = got.result ?? [];
      if (!list.length) {
        done = true;
        break;
      }
      sigs = list;
      before = list[list.length - 1]!.signature;
      if (list.length < 1000) {
        done = true;
        break;
      }
    }
    if (!done) return { funder: null, why: "long" };
    // Newest first from this call: the start of the history is at the end.
    sigs = [...sigs].reverse();
  }
  if (!sigs.length) return { funder: null, why: "none" };
  // Oldest first, read together: the funding usually comes just before the first buy.
  const txs = await Promise.all(sigs.slice(0, 6).map(({ signature }) => call<ParsedTx>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }], fetchFn)));
  let failed = false;
  for (const t of txs) {
    if (!t.ok) {
      failed = true;
      continue;
    }
    const from = fundingIn(t.result, wallet);
    if (from) return { funder: from, why: "found" };
  }
  return { funder: null, why: failed ? "rpc" : "none" };
}

/** The wallet that most recently sent SOL into `wallet` before it started trading, or null. */
export async function funderOf(wallet: string, fetchFn: typeof fetch): Promise<string | null> {
  return (await readFunder(wallet, fetchFn)).funder;
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
