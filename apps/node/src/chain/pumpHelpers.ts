/** Pure helpers the tape and the long memory share: caps in dollars, a dev's habits, ordinals and hashes. */
import { type Unit, unitUsd } from "./price.ts";

/** pump.fun mints a billion tokens. */
const SUPPLY = 1_000_000_000;
/** In Mayhem Mode pump.fun's own bot mints a second billion to trade with for the first 24 hours. */
export const supplyOf = (t: { mayhem?: boolean; supply?: number }) => t.supply ?? (t.mayhem ? 2 * SUPPLY : SUPPLY);
/** A token's caps in dollars at today's price of the chain's coin, and how it moved after the dev's dump. */
export function capsFrom(c: { capFirst?: number | null; capPeak?: number | null; capPeakAt?: number | null; capDump?: number | null; capLow?: number | null; capHigh?: number | null; devFirstSellAt?: number | null; createdAt: number }, unit: Unit = "SOL") {
  const usd = unitUsd(unit);
  const $ = (sol: number | null | undefined) => (usd && sol ? Math.round(sol * usd) : null);
  const sec = (at: number | null | undefined) => (at === null || at === undefined ? null : Math.max(0, Math.round((at - c.createdAt) / 1000)));
  return {
    firstCapUsd: $(c.capFirst),
    peakCapUsd: $(c.capPeak),
    peakAfterSec: c.capPeak ? sec(c.capPeakAt) : null,
    dumpCapUsd: $(c.capDump),
    afterDumpLowPct: c.capDump && c.capLow ? Math.round((c.capLow / c.capDump - 1) * 100) / 100 : null,
    afterDumpHighX: c.capDump && c.capHigh ? Math.round((c.capHigh / c.capDump) * 100) / 100 : null,
    devFirstSellSec: sec(c.devFirstSellAt),
  };
}

/** A dev's habits, medians over their launches with the number each rests on. Describes, never recommends. */
export interface DevPattern {
  /** Launches with a known peak: the ones the medians rest on. */
  launches: number;
  /** Market caps in dollars at today's SOL price. */
  firstCapUsd: number | null;
  peakCapUsd: number | null;
  /** Peak over first-second cap. */
  upsideX: number | null;
  peakAfterSec: number | null;
  /** Share of launches whose peak reached $20K, over those with a known peak. */
  reached20k: number | null;
  firstSellSec: number | null;
  /** Of launches with a dev dump: cap where they dumped, how far it fell in the next 30 minutes, how often it doubled. */
  dumpCapUsd: number | null;
  afterDumpLowPct: number | null;
  afterDumpDoubled: number | null;
  dumps: number;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Medians over a dev's launches; needs at least two with prices to say anything. */
export function devPattern(list: LaunchOutcome[]): DevPattern | null {
  const priced = list.filter((x) => x.peakCapUsd !== null && x.peakCapUsd !== undefined);
  if (priced.length < 2) return null;
  const dumped = list.filter((x) => x.dumpCapUsd !== null && x.dumpCapUsd !== undefined && x.afterDumpLowPct !== null && x.afterDumpLowPct !== undefined);
  const ups = priced.filter((x) => x.firstCapUsd).map((x) => x.peakCapUsd! / x.firstCapUsd!);
  const round = (v: number | null, k = 1) => (v === null ? null : Math.round(v * k) / k);
  return {
    launches: priced.length,
    firstCapUsd: round(median(priced.filter((x) => x.firstCapUsd).map((x) => x.firstCapUsd!))),
    peakCapUsd: round(median(priced.map((x) => x.peakCapUsd!))),
    upsideX: round(median(ups), 10),
    peakAfterSec: median(priced.filter((x) => x.peakAfterSec !== null && x.peakAfterSec !== undefined).map((x) => x.peakAfterSec!)),
    reached20k: round(priced.filter((x) => x.peakCapUsd! >= 20_000).length / priced.length, 100),
    firstSellSec: median(list.filter((x) => x.devFirstSellSec !== null && x.devFirstSellSec !== undefined).map((x) => x.devFirstSellSec!)),
    dumpCapUsd: round(median(dumped.map((x) => x.dumpCapUsd!))),
    afterDumpLowPct: round(median(dumped.map((x) => x.afterDumpLowPct!)), 100),
    afterDumpDoubled: dumped.length ? round(dumped.filter((x) => (x.afterDumpHighX ?? 0) >= 2).length / dumped.length, 100) : null,
    dumps: dumped.length,
  };
}

/** Tickers a dev used more than once, the most repeated first. */
export function repeatsOf(list: Array<{ symbol: string }>): Array<{ symbol: string; n: number }> {
  const n = new Map<string, number>();
  for (const x of list) {
    const k = x.symbol.replace(/^\$/, "").trim().toUpperCase();
    if (k) n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([symbol, c]) => ({ symbol, n: c }));
}

/** Launches a day over the days they were active, and days since the last launch. */
export function tempoOf(list: Array<{ createdAt: number }>, now = Date.now()): { perDay: number; idleDays: number } | undefined {
  if (!list.length) return undefined;
  const ts = list.map((x) => x.createdAt).sort((a, b) => a - b);
  const days = new Set(ts.map((t) => Math.floor(t / DAY_MS))).size;
  return { perDay: Math.round((ts.length / days) * 10) / 10, idleDays: Math.round(((now - ts[ts.length - 1]!) / DAY_MS) * 10) / 10 };
}

/** One of a creator's launches and how it went. Older records (from before these were counted) lack the optional ones. */
export interface LaunchOutcome {
  mint: string;
  symbol: string;
  createdAt: number;
  dumpedAfterMin: number | null;
  dumpedAfterSec?: number | null;
  /** SOL the dev took out beyond what they put in; negative when they sold at a loss. */
  devTookSol?: number | null;
  /** Buyers still holding when the dev sold. */
  leftHolding?: number | null;
  /** Alive now (or when last recorded): a pool with enough SOL, or a curve near graduation. */
  alive?: boolean | null;
  graduated: boolean;
  /** Market caps in dollars at today's SOL price: first second, peak, and where the dev dumped. */
  firstCapUsd?: number | null;
  peakCapUsd?: number | null;
  peakAfterSec?: number | null;
  dumpCapUsd?: number | null;
  /** In the 30 minutes after the dump: the lowest it went (as a fraction, -0.34) and the most it rose (as a multiple). */
  afterDumpLowPct?: number | null;
  afterDumpHighX?: number | null;
  devFirstSellSec?: number | null;
}

export const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
};

export const DAY_MS = 24 * 3_600_000;

/** FNV-1a: a wallet as a 32-bit number. At 5,000 wallets two colliding is a few in a thousand. */
export const hash32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};
