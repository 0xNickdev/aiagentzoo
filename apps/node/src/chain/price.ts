/**
 * SOL in dollars, for market caps people read in dollars. Fetched in the background every five minutes and read
 * synchronously; null until the first answer. Caps are kept in SOL and turned into dollars at today's price.
 */

const EVERY_MS = 5 * 60_000;
let usd: number | null = null;
let at = 0;
let pending = false;

async function refresh(): Promise<void> {
  if (pending) return;
  pending = true;
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT", { signal: AbortSignal.timeout(5_000) });
    const v = Number(((await r.json()) as { price?: string }).price);
    if (Number.isFinite(v) && v > 0) usd = v;
  } catch {
    /* keep the last price */
  } finally {
    at = Date.now();
    pending = false;
  }
}

export function solUsd(now = Date.now()): number | null {
  if (now - at > EVERY_MS) void refresh();
  return usd;
}

/** For tests. */
export function setSolUsd(v: number | null): void {
  usd = v;
  at = Date.now();
}
