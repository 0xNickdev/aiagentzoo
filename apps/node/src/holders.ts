/**
 * Holder perks: a wallet holding enough $ZOOAGENCY gets more of the zoo (more questions to the beaver, more tokens
 * under watch). No contract, no staking: the balance is read from Solana and cached for a few minutes.
 */

export const TOKEN_MINT = process.env.ZOO_TOKEN_MINT ?? "2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B";
/** Whole tokens a wallet must hold to count as a holder. */
export const HOLDER_MIN = Number(process.env.ZOO_HOLDER_MIN ?? 500_000);
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const CACHE_MS = 10 * 60_000;

const cache = new Map<string, { at: number; balance: number }>();

/** Whole $ZOOAGENCY tokens in a wallet, or null when the chain could not be read. */
export async function balanceOf(owner: string, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<number | null> {
  const hit = cache.get(owner);
  if (hit && now - hit.at < CACHE_MS) return hit.balance;
  try {
    const r = await fetchFn(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [owner, { mint: TOKEN_MINT }, { encoding: "jsonParsed" }] }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await r.json()) as { result?: { value?: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }> } };
    if (!body.result) return null;
    const balance = (body.result.value ?? []).reduce((n, a) => n + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
    cache.set(owner, { at: now, balance });
    if (cache.size > 20_000) for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k);
    return balance;
  } catch {
    return null;
  }
}

export async function isHolder(owner: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  return ((await balanceOf(owner, fetchFn)) ?? 0) >= HOLDER_MIN;
}
