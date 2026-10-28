import { oddsOf } from "./chain/odds.ts";
import { defineTool } from "@aiagentzoo/sdk";
import { type ChainFacts, type CleanLaunch, tape } from "./chain/pump.ts";

/** A token launch as reported by pump.fun. */
export interface Launch {
  mint: string;
  name: string;
  symbol: string;
  createdAt: number;
  creator: string;
  marketCapUsd: number | null;
  complete: boolean;
  /** null when unknown: launches read from the chain carry no socials. */
  hasSocials: boolean | null;
  /** What the chain showed when the launch was picked up, when a stream is configured. */
  chain?: ChainFacts;
}

/** Market data from DexScreener for one token. */
export interface Market {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  /** Market cap in SOL while the token is still on the pump.fun bonding curve, where DexScreener reports no liquidity. */
  curveCapSol?: number | null;
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
/** The tape's facts on a launch with the odds the first five minutes give, so every judge can weigh what 34,183 launches taught. */
function factsWithOdds(mint: string, social: boolean): ChainFacts | null {
  const facts = tape.facts(mint);
  if (!facts) return null;
  const read = tape.oddsInputs(mint, { social, funderExchange: false, funderMany: false });
  const o = read ? oddsOf(read.inputs, read.at) : null;
  return { ...facts, odds: o ? { run: o.run, devDumps: o.devDumps, vsAverage: o.vsAverage } : null };
}

export const pumpLatest = defineTool<{ limit?: number }, Launch[]>({
  name: "pump.latest",
  capability: "sources:read",
  description: "Latest token launches on pump.fun",
  async run(input, { signal }) {
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 50);
    // The HTTP API knows the socials; the chain stream knows the trading. Use both when both are up,
    // and the chain alone when pump.fun rate-limits us.
    try {
      const coins = await getJson<PumpCoin[]>(
        `${PUMP_API}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`,
        signal,
      );
      return coins.map((c) => {
        const chain = factsWithOdds(c.mint, Boolean(c.twitter || c.telegram || c.website));
        return chain ? { ...toLaunch(c), chain } : toLaunch(c);
      });
    } catch (error) {
      if (tape.live()) return tape.launches(limit);
      throw error;
    }
  },
});

export interface DexPair {
  baseToken: { address: string; symbol?: string; name?: string };
  priceUsd?: string;
  priceNative?: string;
  quoteToken?: { address?: string };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  txns?: { h24?: { buys: number; sells: number } };
  dexId?: string;
  url?: string;
}

const WSOL = "So11111111111111111111111111111111111111112";

/**
 * Every pump.fun token has a supply of one billion, so the curve price in SOL gives its market cap in SOL.
 * Only for curves quoted in SOL: some pump.fun pairs trade against another token.
 */
export function curveCapSol(p: Pick<DexPair, "dexId" | "priceNative" | "quoteToken">): number | null {
  if (p.dexId !== "pumpfun" || !p.priceNative || p.quoteToken?.address !== WSOL) return null;
  const cap = Number(p.priceNative) * 1e9;
  return Number.isFinite(cap) ? cap : null;
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
      curveCapSol: curveCapSol(p),
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

/** Fresh chain facts for tokens the stream has seen; empty on nodes without a stream. */
export const chainFacts = defineTool<{ mints: string[]; social?: Record<string, boolean | null> }, Record<string, ChainFacts>>({
  name: "chain.facts",
  capability: "sources:read",
  description: "On-chain trading picture of fresh pump.fun tokens: buys, sells, creator selling, serial launches, and the odds",
  async run({ mints, social = {} }) {
    const out: Record<string, ChainFacts> = {};
    for (const mint of mints.slice(0, 30)) {
      const f = factsWithOdds(mint, social[mint] ?? false);
      if (f) out[mint] = f;
    }
    return out;
  },
});

/**
 * Fresh launches that passed the basic on-chain checks, newest first: read from the tape where this node streams,
 * otherwise from the north node that does.
 */
export function chainClean(northUrl?: string) {
  return defineTool<{ limit?: number }, CleanLaunch[]>({
    name: "chain.clean",
    capability: "sources:read",
    description: "Fresh pump.fun launches with a holding creator, returning buyers and no bundle, with their chain facts",
    async run({ limit = 30 } = {}, { signal }) {
      if (tape.lastEventAt > 0) return tape.clean(limit, Date.now(), true);
      if (!northUrl) return [];
      const res = await fetch(`${northUrl}/v1/chain/clean?limit=${Math.min(50, limit)}&wide=1`, { signal });
      if (!res.ok) throw new Error(`north responded ${res.status}`);
      return ((await res.json()) as { launches: CleanLaunch[] }).launches;
    },
  });
}

export const allTools = [pumpLatest, dexMarkets, dexNewProfiles, chainFacts];
