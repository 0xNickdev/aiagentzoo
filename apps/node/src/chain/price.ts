/**
 * SOL, BNB and ETH in dollars, for market caps people read in dollars. Each is fetched in the background every five
 * minutes and read synchronously; null until the first answer. Caps are kept in the chain's own unit and turned into
 * dollars at today's price.
 */

/** What a tape's amounts are in: SOL on Solana, BNB on BNB Chain, ETH on Base. */
export type Unit = "SOL" | "BNB" | "ETH";

const EVERY_MS = 5 * 60_000;
const TICKER: Record<Unit, string> = { SOL: "SOLUSDT", BNB: "BNBUSDT", ETH: "ETHUSDT" };
const state: Record<Unit, { usd: number | null; at: number; pending: boolean }> = {
  SOL: { usd: null, at: 0, pending: false },
  BNB: { usd: null, at: 0, pending: false },
  ETH: { usd: null, at: 0, pending: false },
};

async function refresh(unit: Unit): Promise<void> {
  const s = state[unit];
  if (s.pending) return;
  s.pending = true;
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${TICKER[unit]}`, { signal: AbortSignal.timeout(5_000) });
    const v = Number(((await r.json()) as { price?: string }).price);
    if (Number.isFinite(v) && v > 0) s.usd = v;
  } catch {
    /* keep the last price */
  } finally {
    s.at = Date.now();
    s.pending = false;
  }
}

/** One unit of the chain's coin in dollars, as last read; null before the first answer. */
export function unitUsd(unit: Unit, now = Date.now()): number | null {
  const s = state[unit];
  if (now - s.at > EVERY_MS) void refresh(unit);
  return s.usd;
}

export function solUsd(now = Date.now()): number | null {
  return unitUsd("SOL", now);
}

/** For tests. */
export function setSolUsd(v: number | null): void {
  setUnitUsd("SOL", v);
}

export function setUnitUsd(unit: Unit, v: number | null): void {
  state[unit].usd = v;
  state[unit].at = Date.now();
}
