import { defineTool } from "@aiagentzoo/sdk";

/** A token launch as reported by pump.fun. */
export interface Launch {
  mint: string;
  name: string;
  symbol: string;
  createdAt: number;
  creator: string;
  marketCapUsd: number | null;
  complete: boolean;
  hasSocials: boolean;
}

/** Market data from DexScreener for one token. */
export interface Market {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24h: number | null;
  buys24h: number;
  sells24h: number;
  dex: string | null;
  url: string | null;
}

const PUMP_API = "https://frontend-api-v3.pump.fun";
const DEX_API = "https://api.dexscreener.com";

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: "application/json", "user-agent": "aiagentzoo-node/0.1" } });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}

interface PumpCoin {
  mint: string;
  name: string;
  symbol: string;
  created_timestamp: number;
  creator: string;
  usd_market_cap?: number;
  complete?: boolean;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
}

/** Newest pump.fun launches, newest first. */
export const pumpLatest = defineTool<{ limit?: number }, Launch[]>({
  name: "pump.latest",
  capability: "sources:read",
  description: "Latest token launches on pump.fun",
  async run(input, { signal }) {
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 50);
    const coins = await getJson<PumpCoin[]>(
      `${PUMP_API}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`,
      signal,
    );
    return coins.map(toLaunch);
  },
});

interface DexPair {
  baseToken: { address: string; symbol?: string; name?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  txns?: { h24?: { buys: number; sells: number } };
  dexId?: string;
  url?: string;
}

/** DexScreener market data for up to 30 mints at once. */
export const dexMarkets = defineTool<{ mints: string[] }, Market[]>({
  name: "dex.markets",
  capability: "net:fetch",
  description: "DexScreener market data for Solana tokens",
  async run({ mints }, { signal }) {
    if (mints.length === 0) return [];
    const pairs = await getJson<DexPair[]>(`${DEX_API}/tokens/v1/solana/${mints.slice(0, 30).join(",")}`, signal);
    // Keep the deepest pool per token.
    const best = new Map<string, DexPair>();
    for (const pair of pairs) {
      const mint = pair.baseToken.address;
      const current = best.get(mint);
      if (!current || (pair.liquidity?.usd ?? 0) > (current.liquidity?.usd ?? 0)) best.set(mint, pair);
    }
    return [...best.entries()].map(([mint, p]) => ({
      mint,
      symbol: (p.baseToken.symbol ?? "?").trim().slice(0, 32),
      name: (p.baseToken.name ?? "").trim().slice(0, 64),
      priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
      liquidityUsd: p.liquidity?.usd ?? null,
      volume24hUsd: p.volume?.h24 ?? null,
      priceChange24h: p.priceChange?.h24 ?? null,
      buys24h: p.txns?.h24?.buys ?? 0,
      sells24h: p.txns?.h24?.sells ?? 0,
      dex: p.dexId ?? null,
      url: p.url ?? null,
    }));
  },
});

interface DexProfile {
  chainId: string;
  tokenAddress: string;
}

/** Tokens that just bought a DexScreener profile, a cheap marketing tell. */
export const dexNewProfiles = defineTool<void, string[]>({
  name: "dex.profiles",
  capability: "sources:read",
  description: "Solana tokens with freshly created DexScreener profiles",
  async run(_input, { signal }) {
    const profiles = await getJson<DexProfile[]>(`${DEX_API}/token-profiles/latest/v1`, signal);
    return profiles.filter((p) => p.chainId === "solana").map((p) => p.tokenAddress);
  },
});

function toLaunch(c: PumpCoin): Launch {
  return {
    mint: c.mint,
    name: c.name,
    symbol: c.symbol,
    createdAt: c.created_timestamp,
    creator: c.creator,
    marketCapUsd: c.usd_market_cap ?? null,
    complete: c.complete ?? false,
    hasSocials: Boolean(c.twitter || c.telegram || c.website),
  };
}

export const allTools = [pumpLatest, dexMarkets, dexNewProfiles];
