import { fundersEnabled, rpc } from "./funders.ts";

/**
 * Where a token the stream never saw came from: its first transaction (the launch), who paid for it (the creator)
 * and what it calls itself. Three RPC calls, once per token: a launch never changes, so the answer is kept.
 * Needs Helius (oldest-first history and DAS); on another RPC it answers null and the X-Ray says it has no record.
 */

export interface Origin {
  creator: string;
  createdAt: number;
  name: string | null;
  symbol: string | null;
}

const kept = new Map<string, Origin>();
/** Tokens that had no answer, so a burst of lookups does not ask again for a while. */
const missed = new Map<string, number>();
const MISS_MS = 10 * 60_000;

type Key = string | { pubkey: string; signer?: boolean };

export async function originOf(mint: string, f: typeof fetch = fetch, now = Date.now()): Promise<Origin | null> {
  if (!fundersEnabled()) return null;
  const hit = kept.get(mint);
  if (hit) return hit;
  if (now - (missed.get(mint) ?? 0) < MISS_MS) return null;

  const [first, asset] = await Promise.all([
    rpc<{ data?: Array<{ signature: string; blockTime: number | null }> }>("getTransactionsForAddress", [mint, { sortOrder: "asc", limit: 1, transactionDetails: "signatures" }], f),
    rpc<{ content?: { metadata?: { name?: string; symbol?: string } } }>("getAsset", [mint], f),
  ]);
  const launch = first?.data?.[0];
  const tx = launch
    ? await rpc<{ blockTime: number | null; transaction: { message: { accountKeys: Key[] } } }>("getTransaction", [launch.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }], f)
    : null;
  // The fee payer of the launch transaction is the wallet that created the token.
  const payer = tx?.transaction.message.accountKeys[0];
  const creator = typeof payer === "string" ? payer : payer?.pubkey;
  const at = tx?.blockTime ?? launch?.blockTime ?? null;
  if (!creator || !at) {
    missed.set(mint, now);
    return null;
  }
  const meta = asset?.content?.metadata;
  const origin: Origin = { creator, createdAt: at * 1000, name: meta?.name?.trim() || null, symbol: meta?.symbol?.trim() || null };
  kept.set(mint, origin);
  if (kept.size > 20_000) kept.delete(kept.keys().next().value!);
  if (missed.size > 20_000) missed.clear();
  return origin;
}
