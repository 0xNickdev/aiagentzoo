import type { GuestReport, Observation } from "./nightWatch.ts";

/**
 * How a verdict is graded. Anyone who judges a token (a guest agent, a holder in the humans' contest, the odds model)
 * says promising, watch or suspicious; the next day the hedgehog re-checks the token on DexScreener and on chain, and
 * each verdict is scored against what actually happened. No model is involved anywhere in this.
 */

export const VERDICTS = ["promising", "watch", "suspicious"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Call {
  mint: string;
  symbol: string;
  verdict: Verdict;
  /** 0..1 */
  confidence: number;
  why: string;
  /** The same reason in Simplified Chinese, on calls kept from before 2026-11-20. */
  whyZh?: string;
  /** Who made the call: "model" and "rules" are the retired beaver's, kept in old nights' records. */
  by: "model" | "rules" | "odds";
  at: number;
  /** The token was already dead when the call was made: calling it suspicious proves nothing, so it is not scored. */
  already?: boolean;
}

export type Outcome = "dead" | "alive" | "unknown";

export interface Case {
  mint: string;
  symbol: string;
  verdict: Verdict;
  why: string;
  outcome: Outcome;
  already?: boolean;
  /** null when the call cannot be scored: a "watch", or no market to judge by. */
  hit: boolean | null;
}

export interface Scorecard {
  night: string;
  checked: number;
  hits: number;
  misses: number;
  /** hits / (hits + misses), or null when nothing could be scored. */
  accuracy: number | null;
  /** Balanced accuracy: the mean of "called the dead suspicious" and "called the living promising". Base rates cannot inflate it. */
  skill?: number | null;
  cases: Case[];
  /** The same scoring applied to every guest's verdicts. */
  guests: Record<string, GuestTally>;
  /** Each guest verdict with how its token turned out, so a guest's record can be read call by call. */
  guestCases?: Record<string, GuestCase[]>;
  /** The odds model on the night's exam, graded by the same re-check: the baseline both contests measure against. */
  odds?: OddsScore;
}

/** The odds model's verdicts on one night's exam tokens, graded. */
export interface OddsScore {
  cases: Array<Case & { run: number | null }>;
  dead: number;
  deadRight: number;
  alive: number;
  aliveRight: number;
  skill: number | null;
}

export interface GuestTally {
  hits: number;
  misses: number;
  dead?: number;
  deadRight?: number;
  alive?: number;
  aliveRight?: number;
}

/** Outcome counts over graded, fair cases (a "watch" counts as not called), and the balanced accuracy they give. */
export function balance(cases: Array<{ verdict: Verdict; outcome: Outcome; already?: boolean }>) {
  const fair = cases.filter((c) => c.outcome !== "unknown" && !c.already);
  const dead = fair.filter((c) => c.outcome === "dead");
  const alive = fair.filter((c) => c.outcome === "alive");
  const counts = {
    dead: dead.length,
    deadRight: dead.filter((c) => c.verdict === "suspicious").length,
    alive: alive.length,
    aliveRight: alive.filter((c) => c.verdict === "promising").length,
  };
  return { ...counts, skill: skillOf(counts) };
}

/** Balanced accuracy needs both sides: with no living token graded, calling everything dead would read 100%. */
export function skillOf(t: { dead?: number; deadRight?: number; alive?: number; aliveRight?: number }): number | null {
  if (!t.dead || !t.alive) return null;
  return ((t.deadRight ?? 0) / t.dead + (t.aliveRight ?? 0) / t.alive) / 2;
}

export interface GuestCase {
  mint: string;
  symbol: string;
  verdict: Verdict;
  outcome: Outcome;
  hit: boolean | null;
  already?: boolean;
}

/** A pump.fun token opens at about 28 SOL of market cap. Still under this a day later, nobody is holding it up. */
export const CURVE_DEAD_SOL = 32;
/** About three times the opening cap: a few thousand dollars of real buying, on par with $1,000 of pool liquidity. */
export const CURVE_ALIVE_SOL = 85;

/** A token younger than this is never called dead by its curve or pool: every launch opens under the dead line. */
export const CURVE_MIN_AGE_MS = 6 * 3_600_000;
/** On PumpSwap, about $100 and $1,000 of pool liquidity, counted in the pool's SOL side. */
export const POOL_DEAD_SOL = 0.4;
export const POOL_ALIVE_SOL = 4;

/** A bonding curve's market cap in SOL from the real SOL in it (30 SOL virtual at the start, 1.073B virtual tokens). */
export const curveCapOf = (realSol: number) => (30 + realSol) ** 2 / 32.19;

const byCap = (cap: number, young: boolean): Outcome => (cap >= CURVE_ALIVE_SOL ? "alive" : cap < CURVE_DEAD_SOL && !young ? "dead" : "unknown");

/** What happened to a token, judged from a fresh market read a day later. */
export function outcomeOf(o: Observation | undefined): Outcome {
  if (!o) return "unknown";
  const m = o.market;
  const ageMs = o.chain ? o.chain.ageMin * 60_000 : o.createdAt ? o.seenAt - o.createdAt : null;
  const young = ageMs !== null && ageMs < CURVE_MIN_AGE_MS;
  if (m) {
    if ((m.priceChange24h ?? 0) <= -80 || (m.liquidityUsd !== null && m.liquidityUsd < 100)) return "dead";
    if (m.liquidityUsd !== null) return m.liquidityUsd >= 1000 ? "alive" : "unknown";
    // Still on the bonding curve: DexScreener reports no liquidity there, so the curve's market cap decides.
    if (m.curveCapSol != null) return byCap(m.curveCapSol, young);
  }
  // DexScreener never listed most small launches: our own read of the chain decides then.
  const c = o.chain;
  if (!c) return "unknown";
  if (c.graduated) {
    if (c.poolSol === null) return "unknown";
    return c.poolSol >= POOL_ALIVE_SOL ? "alive" : c.poolSol < POOL_DEAD_SOL && !young ? "dead" : "unknown";
  }
  // Paired with another token: its curve is not counted in SOL, so the SOL lines do not apply.
  if (c.quote) return "unknown";
  // Nobody ever bought: the curve is where it opened.
  const real = c.curveSol ?? (c.buys === 0 ? 0 : null);
  return real === null ? "unknown" : byCap(curveCapOf(real), young);
}

export function scoreCall(verdict: Verdict, outcome: Outcome): boolean | null {
  if (verdict === "watch" || outcome === "unknown") return null;
  return verdict === "suspicious" ? outcome === "dead" : outcome === "alive";
}

/** Scores a night's calls and guest reports against the follow-up observations. */
export function scoreNight(night: string, calls: Call[], reports: GuestReport[], followups: Observation[]): Scorecard {
  const now = new Map(followups.map((o) => [o.mint, o]));
  const cases: Case[] = calls.map((c) => {
    const outcome = outcomeOf(now.get(c.mint));
    return { mint: c.mint, symbol: c.symbol, verdict: c.verdict, why: c.why, outcome, already: c.already === true, hit: c.already ? null : scoreCall(c.verdict, outcome) };
  });
  const hits = cases.filter((c) => c.hit === true).length;
  const misses = cases.filter((c) => c.hit === false).length;
  const guests: Scorecard["guests"] = {};
  const guestCases: Record<string, GuestCase[]> = {};
  for (const r of reports) {
    const g: GuestTally = (guests[r.guest] = { hits: 0, misses: 0 });
    guestCases[r.guest] = r.items.map((i) => {
      const seen = now.get(i.mint);
      const outcome = outcomeOf(seen);
      // A token that was already dead when the guest reported it cannot earn a hit.
      const hit = i.already ? null : scoreCall(i.verdict, outcome);
      if (hit === true) g.hits += 1;
      if (hit === false) g.misses += 1;
      return { mint: i.mint, symbol: seen?.symbol ?? "?", verdict: i.verdict, outcome, hit, already: i.already === true };
    });
    const { skill: _s, ...counts } = balance(guestCases[r.guest]!);
    Object.assign(g, counts);
  }
  return {
    night,
    checked: followups.length,
    hits,
    misses,
    accuracy: hits + misses ? hits / (hits + misses) : null,
    skill: balance(cases).skill,
    cases,
    guests,
    guestCases,
  };
}

/** Red flags read from the market and the chain, shown with an exam token. */
export function ruleFlags(o: Observation): string[] {
  const usd = (n: number | null | undefined) => n ?? 0;
  const m = o.market;
  const reasons: string[] = [];
  if (o.hasSocials === false) reasons.push("no socials");
  if (m && m.sells24h > 0 && m.sells24h > m.buys24h * 3) reasons.push("sells outnumber buys 3:1");
  if (m && usd(m.liquidityUsd) > 0 && usd(m.volume24hUsd) > usd(m.liquidityUsd) * 50) reasons.push("volume 50x liquidity");
  // Read straight from the chain: the creator dumping their own bag, and wallets that launch all day.
  const c = o.chain;
  if (c && c.creatorSold !== null && c.creatorSold >= 0.5) reasons.push(`creator sold ${Math.round(c.creatorSold * 100)}% of their bag`);
  if (c && c.creatorLaunches24h >= 5) reasons.push(`creator launched ${c.creatorLaunches24h} tokens today`);
  if (c && (c.bundleWallets ?? 0) >= 3 && (c.bundleShare ?? 0) >= 0.15) {
    reasons.push(`bundled: ${c.bundleWallets} wallets took ${Math.round((c.bundleShare ?? 0) * 100)}% of supply in the launch block`);
  }
  return reasons;
}

export function compact(o: Observation) {
  const m = o.market;
  return {
    mint: o.mint,
    symbol: o.symbol,
    name: o.name,
    source: o.source,
    graduated: o.complete,
    hasSocials: o.hasSocials,
    marketCapUsd: o.marketCapUsd,
    market: m ? { liq: m.liquidityUsd, curveCapSol: m.curveCapSol ?? null, vol24h: m.volume24hUsd, change24h: m.priceChange24h, buys24h: m.buys24h, sells24h: m.sells24h, dex: m.dex } : null,
    flags: ruleFlags(o),
    chain: o.chain ?? null,
  };
}

/** The night before `night` (night ids are dates). */
export function previousNight(night: string): string {
  return new Date(Date.parse(`${night}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
