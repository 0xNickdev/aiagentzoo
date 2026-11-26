import type { CallerRecord } from "./callers.ts";
import type { Callout } from "./calls.ts";

/**
 * Callers as a signal: who called a coin early, and whether their calls usually hold up a day later.
 *
 * A good record, from Caller Truth (each call followed 24 hours on our tape): at least 8 settled calls, at least 40%
 * of them ended above the cap they were called at, at most half ended dead, and their listed wallet did not sell out
 * within an hour on more than half the calls where we saw it buy. A caller with fewer settled calls is not judged.
 *
 * Only calls made by the moment of the reading count for the marks (no look into what came after); the x-ray reads
 * the same window plus EARLY_CALL_MIN minutes, since a channel post arrives minutes after the call.
 */

export const GOOD_CALLER = { minSettled: 8, minUp: 0.4, maxDead: 0.5, maxQuickExit: 0.5 } as const;
/** The 5-minute reading's window, and the minutes after it the x-ray still calls early. */
export const READING_MIN = 5;
export const EARLY_CALL_MIN = 10;

export function goodCaller(r: CallerRecord | null | undefined): boolean {
  if (!r || r.settled < GOOD_CALLER.minSettled) return false;
  if (r.up / r.settled < GOOD_CALLER.minUp) return false;
  if (r.dead / r.settled > GOOD_CALLER.maxDead) return false;
  if (r.walletSeen > 0 && r.soldWithinHour / r.walletSeen > GOOD_CALLER.maxQuickExit) return false;
  return true;
}

export interface EarlyCall {
  caller: string;
  twitter: string | null;
  wallet: string;
  /** Seconds after launch the call was made. */
  afterSec: number;
  good: boolean;
  record: { settled: number; up: number; dead: number; medianX: number | null } | null;
}

export interface EarlyCalls {
  /** Distinct callers who called it by the cut-off, and how many of them have a good record. */
  n: number;
  good: number;
  /** Seconds after launch of the first call, and of the first good caller's call. */
  firstSec: number | null;
  goodFirstSec: number | null;
  calls: EarlyCall[];
}

/** The calls on a coin made by `until`, one per caller (their first), judged by their Caller Truth record. */
export function earlyCallsOf(calls: Callout[], createdAt: number, until: number, recordOf: (wallet: string) => CallerRecord | null): EarlyCalls {
  const first = new Map<string, Callout>();
  for (const c of [...calls].sort((a, b) => a.at - b.at)) {
    if (!c.wallet || c.at > until) continue;
    if (!first.has(c.wallet)) first.set(c.wallet, c);
  }
  const out: EarlyCall[] = [];
  for (const c of first.values()) {
    const r = recordOf(c.wallet!);
    const good = goodCaller(r);
    out.push({ caller: c.caller, twitter: c.twitter, wallet: c.wallet!, afterSec: Math.max(0, Math.round((c.at - createdAt) / 1000)), good, record: r ? { settled: r.settled, up: r.up, dead: r.dead, medianX: r.medianX } : null });
  }
  const goods = out.filter((c) => c.good);
  return { n: out.length, good: goods.length, firstSec: out[0]?.afterSec ?? null, goodFirstSec: goods[0]?.afterSec ?? null, calls: out };
}

/** The compact field written into a 5-minute mark: counts and timing only, for later training. */
export const markField = (e: EarlyCalls) => ({ n: e.n, good: e.good, firstSec: e.firstSec, goodFirstSec: e.goodFirstSec });

/** The x-ray's line, or null when no good caller called it early. */
export function earlyCallLine(e: EarlyCalls): string | null {
  const g = e.calls.find((c) => c.good);
  if (!g || !g.record) return null;
  const who = g.twitter ? `@${g.twitter.replace(/^@/, "")}` : g.caller;
  const min = Math.round(g.afterSec / 60);
  const rest = e.good > 1 ? ` and ${e.good - 1} more good caller${e.good === 2 ? "" : "s"}` : "";
  return `called early by ${who}${rest}, ${min < 1 ? "in the first minute" : `${min} min after launch`} (record: ${g.record.up} of ${g.record.settled} calls ended up, ${g.record.dead} dead${g.record.medianX !== null ? `, median ${g.record.medianX}x` : ""})`;
}
