/**
 * Eyes for tokens the stream did not see launch: anything already graduated to PumpSwap, or older than the tape.
 * From an RPC it reads the largest holders, sets aside accounts owned by programs (the liquidity pool, a lock),
 * and tells how much of the supply ten wallets hold and how much the creator still holds.
 */

const RPC = () => process.env.SOLANA_RPC_URL ?? (process.env.SHYFT_API_KEY ? `https://rpc.shyft.to?api_key=${process.env.SHYFT_API_KEY}` : "");
const PUMP_API = "https://frontend-api-v3.pump.fun";
const CACHE_MS = 5 * 60_000;
const SYSTEM = "11111111111111111111111111111111";

export interface HolderReport {
  /** Share of supply in the ten largest wallets, pools and program accounts left out, 0..1. */
  top10Share: number;
  /** Share in the single largest wallet. */
  topShare: number;
  /** Share the token sits in program accounts: the pool, locks, vaults. */
  programShare: number;
  /** The pump.fun creator, when pump.fun says. */
  creator: string | null;
  /** Share of supply the creator still holds; null when the creator is unknown. */
  creatorShare: number | null;
}

const cache = new Map<string, { at: number; report: HolderReport | null }>();

async function rpc<T>(method: string, params: unknown[], f: typeof fetch): Promise<T | null> {
  try {
    const r = await f(RPC(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8_000) });
    return ((await r.json()) as { result?: T }).result ?? null;
  } catch {
    return null;
  }
}

export const holdersEnabled = () => Boolean(RPC());

export async function holderReport(mint: string, f: typeof fetch = fetch, now = Date.now()): Promise<HolderReport | null> {
  if (!RPC()) return null;
  const hit = cache.get(mint);
  if (hit && now - hit.at < CACHE_MS) return hit.report;

  const [supply, largest, coin] = await Promise.all([
    rpc<{ value: { uiAmount: number | null } }>("getTokenSupply", [mint], f),
    rpc<{ value: Array<{ address: string; uiAmount: number | null }> }>("getTokenLargestAccounts", [mint], f),
    f(`${PUMP_API}/coins/${mint}`, { signal: AbortSignal.timeout(6_000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ creator?: string }>) : null))
      .catch(() => null),
  ]);
  const total = supply?.value.uiAmount ?? 0;
  const accounts = largest?.value ?? [];
  if (!total || !accounts.length) {
    cache.set(mint, { at: now, report: null });
    return null;
  }

  // Who owns each token account, and is that owner a wallet or a program's account (a pool, a lock)?
  type Parsed = { data?: { parsed?: { info?: { owner?: string } } } } | null;
  const tokenAccounts = await rpc<{ value: Parsed[] }>("getMultipleAccounts", [accounts.map((a) => a.address), { encoding: "jsonParsed" }], f);
  const owners = (tokenAccounts?.value ?? []).map((a) => a?.data?.parsed?.info?.owner ?? null);
  const uniq = [...new Set(owners.filter((o): o is string => Boolean(o)))];
  const ownerInfo = uniq.length ? await rpc<{ value: Array<{ owner: string } | null> }>("getMultipleAccounts", [uniq, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }], f) : null;
  // A plain wallet is owned by the system program, or does not exist as an account at all.
  const isWallet = new Map(uniq.map((o, i) => [o, !ownerInfo?.value[i] || ownerInfo.value[i]!.owner === SYSTEM]));

  let programAmount = 0;
  const byWallet = new Map<string, number>();
  accounts.forEach((a, i) => {
    const owner = owners[i];
    const amount = a.uiAmount ?? 0;
    if (!owner || !isWallet.get(owner)) programAmount += amount;
    else byWallet.set(owner, (byWallet.get(owner) ?? 0) + amount);
  });
  const ranked = [...byWallet.values()].sort((a, b) => b - a);
  const creator = coin?.creator ?? null;
  let creatorShare: number | null = null;
  if (creator) {
    const mine = await rpc<{ value: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }> }>(
      "getTokenAccountsByOwner",
      [creator, { mint }, { encoding: "jsonParsed" }],
      f,
    );
    if (mine) creatorShare = mine.value.reduce((n, a) => n + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0) / total;
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const report: HolderReport = {
    top10Share: round(ranked.slice(0, 10).reduce((a, b) => a + b, 0) / total),
    topShare: round((ranked[0] ?? 0) / total),
    programShare: round(programAmount / total),
    creator,
    creatorShare: creatorShare === null ? null : round(creatorShare),
  };
  cache.set(mint, { at: now, report });
  if (cache.size > 5_000) for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k);
  return report;
}
