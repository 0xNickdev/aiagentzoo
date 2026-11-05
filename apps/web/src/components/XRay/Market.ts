import { useEffect, useState } from "react";
import { chainOf } from "../../chain";

/** Where the coin trades right now, from DexScreener: market cap, how it moved, volume. Null until known. */
export interface Market {
  mcapUsd: number | null;
  m5: number | null;
  h1: number | null;
  h24: number | null;
  volH24: number | null;
  liqUsd: number | null;
  dex: string;
}

const DS_CHAIN: Record<string, string> = { solana: "solana", bsc: "bsc", base: "base" };

export function useMarket(mint: string): Market | null {
  const [m, setM] = useState<Market | null>(null);
  useEffect(() => {
    setM(null);
    const chain = DS_CHAIN[chainOf(mint)] ?? "solana";
    let gone = false;
    const read = () =>
      fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${mint}`, { signal: AbortSignal.timeout(6000) })
        .then((r) => (r.ok ? r.json() : []))
        .then((pairs: Array<{ dexId: string; marketCap?: number; fdv?: number; priceChange?: Record<string, number>; volume?: Record<string, number>; liquidity?: { usd?: number } }>) => {
          if (gone || !pairs.length) return;
          // The pair with the most liquidity speaks for the coin; on the bonding curve that is the only one.
          const p = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
          setM({
            mcapUsd: p.marketCap ?? p.fdv ?? null,
            m5: p.priceChange?.m5 ?? null,
            h1: p.priceChange?.h1 ?? null,
            h24: p.priceChange?.h24 ?? null,
            volH24: p.volume?.h24 ?? null,
            liqUsd: p.liquidity?.usd ?? null,
            dex: p.dexId,
          });
        })
        .catch(() => null);
    void read();
    const id = setInterval(read, 30_000);
    return () => {
      gone = true;
      clearInterval(id);
    };
  }, [mint]);
  return m;
}

export const usdShort = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
export const pctMove = (n: number) => `${n > 0 ? "+" : ""}${Math.abs(n) >= 100 ? Math.round(n) : n.toFixed(1)}%`;
