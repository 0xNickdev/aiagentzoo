import { curveCapOf, CURVE_DEAD_SOL, POOL_DEAD_SOL } from "../agents/judgement.ts";
import type { HolderReport } from "./holders.ts";
import type { LineageView } from "./lineage.ts";
import type { ChainFacts, CreatorRecord } from "./pump.ts";

/**
 * A pre-trade check for agents: one fast, model-free verdict on a pump.fun token from what the tape saw on chain.
 * avoid and caution say why in plain words; pass means none of the checks fired, not that the token is good.
 */
export type CheckVerdict = "avoid" | "caution" | "pass" | "unknown";

export const CHECK_VERSION = 3;
/** Under this age a token has had no time to show anything but its creator's history: the check says so. */
export const EARLY_MIN = 10;

export interface TokenCheck {
  version: number;
  mint: string;
  symbol: string | null;
  verdict: CheckVerdict;
  /** true on pass; null when the tape never saw the token, so the caller decides with its other tools. */
  proceed: boolean | null;
  /** Why the verdict, in plain words: every avoid reason first, then every caution reason. */
  reasons: string[];
  /** Worth knowing, never a reason to refuse: "too early to tell", "holders not checked". */
  notes: string[];
  facts: {
    ageMin: number;
    buyers: number;
    buys: number;
    sells: number;
    creatorSoldPct: number | null;
    creatorLaunches24h: number;
    creatorDumped48h: number | null;
    creatorMedianDumpMin: number | null;
    bundleWallets: number | null;
    bundleSharePct: number | null;
    top5BuyingPct: number | null;
    graduated: boolean;
    /** The token it trades against when not SOL; then curveSol is null. */
    quote: string | null;
    mayhem: boolean;
    curveSol: number | null;
    poolSol: number | null;
    /** Wallets that bought in the first 5 seconds, and the share of the supply they still hold (curve trades). */
    earlyWallets: number | null;
    earlyHeldPct: number | null;
    /** At least this share of the trading is wallets selling back what they bought. */
    churnPct: number | null;
    /** Buy-and-sell in one transaction: bump bots. */
    bumps: number | null;
    /** First-second wallets that keep sniping this creator's launches, that snipe together, that snipe everything. */
    creatorCrew: number | null;
    ringWallets: number | null;
    serialSnipers: number | null;
  } | null;
  /** Who paid for the creator, and what else that wallet paid for. Absent when the node has no RPC. */
  funding?: { funder: string | null; funderIsHot: boolean; otherCreators: number; theirLaunches48h: number; theirDumps48h: number } | null;
  /** Only with ?holders=1: who holds it right now, from Solana RPC. */
  holders?: { top10Pct: number; topWalletPct: number; creatorHoldsPct: number | null } | null;
  /** How fresh the chain stream behind this answer is. */
  stream: { live: boolean; lastEventSecAgo: number | null };
  checkedAt: number;
  more: string;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100));

export interface CheckInput {
  symbol: string;
  facts: ChainFacts;
  creatorRecord: CreatorRecord | null;
}

export function checkToken(
  mint: string,
  found: CheckInput | null,
  opts: { now?: number; stream?: TokenCheck["stream"]; holders?: HolderReport | null; lineage?: LineageView | null } = {},
): TokenCheck {
  const now = opts.now ?? Date.now();
  const stream = opts.stream ?? { live: true, lastEventSecAgo: null };
  const base = { version: CHECK_VERSION, mint, checkedAt: now, more: "https://zooaiagency.com/skill.md", stream };
  if (!found) {
    return {
      ...base,
      symbol: null,
      verdict: "unknown",
      proceed: null,
      reasons: ["not a pump.fun launch from the last two days, so there is no chain record to check"],
      notes: stream.live ? [] : ["the chain stream is down right now: a fresh launch may be missing for that reason"],
      facts: null,
    };
  }
  const f = found.facts;
  const c = found.creatorRecord;
  const avoid: string[] = [];
  const caution: string[] = [];
  const notes: string[] = [];
  const early = f.ageMin < EARLY_MIN;

  // The creator selling their own bag is the pump.fun rug.
  if (f.creatorSold !== null && f.creatorSold >= 0.5) avoid.push(`the creator sold ${pct(Math.min(1, f.creatorSold))}% of their own bag`);
  else if (f.creatorSold !== null && f.creatorSold > 0.1) caution.push(`the creator has sold ${pct(f.creatorSold)}% of their own bag`);

  // Their history, from every launch of theirs the tape saw in two days.
  if (c && c.dumped >= 3 && c.dumped / Math.max(1, c.launches48h) >= 0.5) {
    const speed = c.medianDumpMin === null ? "" : `, usually ${c.medianDumpMin} min after launch`;
    avoid.push(`this creator dumped ${c.dumped} of their ${c.launches48h} launches in 48 hours${speed}`);
  } else if (f.creatorLaunches24h >= 3) {
    caution.push(`the creator launched ${f.creatorLaunches24h} tokens in the last 24 hours`);
  }

  // Who paid for the creator: a fresh wallet funded by the same hand as a row of ruggers is that rugger again.
  const lin = opts.lineage;
  if (lin && lin.funder && !lin.funderIsHot && lin.siblings.length) {
    const n = lin.siblings.length;
    const they = `the wallet that funded this creator also funded ${n} other launcher${n === 1 ? "" : "s"}`;
    if (lin.siblingDumped48h >= 3 && lin.siblingDumped48h / Math.max(1, lin.siblingLaunches48h) >= 0.5) {
      avoid.push(`${they}; they dumped ${lin.siblingDumped48h} of their ${lin.siblingLaunches48h} launches in 48 hours`);
    } else notes.push(`${they} the zoo has traced`);
  } else if (opts.lineage === null) notes.push("who funded the creator is not traced yet: it is queued");

  // Wallets other than the creator buying in the launch block: the supply was split up before anyone could see it.
  if (f.bundleWallets !== null && f.bundleShare !== null && f.bundleWallets >= 3 && f.bundleShare >= 0.15) {
    avoid.push(`${f.bundleWallets} wallets bought ${pct(f.bundleShare)}% of the supply in the launch block`);
  }

  // Wallets in before anyone could see the token, still sitting on a big share: they decide when it dies.
  if (f.earlyWallets !== undefined && f.earlyHeld !== undefined && f.earlyWallets >= 2) {
    const who = `${f.earlyWallets} wallets that bought in the first 5 seconds still hold ${pct(f.earlyHeld)}% of the supply`;
    // In Mayhem Mode pump.fun's own bot trades from the first second, so an early crowd may be partly that bot.
    if (f.earlyWallets >= 3 && f.earlyHeld >= 0.5 && !f.mayhem) avoid.push(who);
    else if (f.earlyHeld >= 0.25) caution.push(who);
  }

  // Who those first-second wallets are, from every launch the tape saw them snipe in two days.
  if ((f.creatorCrew ?? 0) >= 2) {
    avoid.push(`${f.creatorCrew} of the wallets in the first 5 seconds keep sniping this creator's other launches: they are the creator's own wallets`);
  }
  if ((f.ringWallets ?? 0) >= 3) caution.push(`${f.ringWallets} of the first-second wallets have sniped launches together before: one operator`);
  else if ((f.serialSnipers ?? 0) >= 3) caution.push(`${f.serialSnipers} serial snipers got in first: wallets that buy launches in the first seconds to sell to whoever comes next`);

  if (f.graduated) {
    if (f.poolSol !== null && f.poolSol < POOL_DEAD_SOL) avoid.push(`graduated, but the pool is down to ${f.poolSol.toFixed(2)} SOL`);
  } else if (f.ageMin >= 360 && !f.quote) {
    const real = f.curveSol ?? (f.buys === 0 ? 0 : null);
    if (real !== null && curveCapOf(real) < CURVE_DEAD_SOL) avoid.push(`${Math.round(f.ageMin / 60)} hours old and the curve is back where it opened: nobody is holding it`);
  }

  if (f.mayhem) notes.push("launched in Mayhem Mode: two billion supply, and pump.fun's own bot trades it for the first 24 hours, so its volume is partly that bot");

  if (early) {
    // Minutes in, a handful of buyers is normal; only the creator's own record can speak yet.
    // Said once the verdict is known: "no red flags yet" next to an avoid would contradict it.
  } else {
    if (f.top5Share !== null && f.top5Share > 0.5) caution.push(`the top 5 buyers took ${pct(f.top5Share)}% of all buying`);
    if (f.buyers === 0) caution.push("nobody has bought it");
    else if (f.buyers < 10) caution.push(`only ${f.buyers} wallets have bought it`);
    if (f.sells > f.buys * 2 && f.sells >= 10) caution.push(`sells outnumber buys ${f.sells} to ${f.buys}`);
    if (f.washShare !== undefined && f.washShare >= 0.3 && !f.mayhem) caution.push(`at least ${pct(f.washShare)}% of the trading is wallets selling back what they just bought: volume, not holders`);
    if (f.bumps !== undefined && f.bumps >= 3 && !f.mayhem) caution.push(`a bot bought and sold it in the same transaction ${f.bumps} times to keep it on the front page`);
  }

  // Who holds it now catches what trades cannot: a creator who moved the bag to other wallets instead of selling.
  let holders: TokenCheck["holders"];
  if (opts.holders !== undefined) {
    const h = opts.holders;
    holders = h ? { top10Pct: pct(h.top10Share)!, topWalletPct: pct(h.topShare)!, creatorHoldsPct: pct(h.creatorShare) } : null;
    if (!h) notes.push("holders could not be read from Solana right now");
    else {
      if (h.topShare >= 0.2) caution.push(`one wallet holds ${pct(h.topShare)}% of the supply`);
      else if (h.top10Share >= 0.5) caution.push(`the 10 largest wallets hold ${pct(h.top10Share)}% of the supply`);
      const bought = f.creatorSold !== null;
      if (bought && (f.creatorSold ?? 0) < 0.5 && h.creatorShare !== null && h.creatorShare < 0.001) {
        caution.push("the creator no longer holds any of it, but never sold on the curve: the bag moved to other wallets");
      }
    }
  }

  const verdict: CheckVerdict = avoid.length ? "avoid" : caution.length ? "caution" : "pass";
  if (early) {
    const age = Math.max(0, Math.round(f.ageMin));
    notes.unshift(verdict === "pass" ? `only ${age} min old: no red flags yet, so check again before adding` : `only ${age} min old: more can show up, check again before adding`);
  }
  if (verdict === "pass") notes.push("pass means no creator dump, bundle, creator's crew, sniper hold, serial launcher or dead curve was seen on chain; it is not a call that the price goes up");
  if (!stream.live) notes.push("the chain stream is down right now: this answer may be stale");
  return {
    ...base,
    symbol: found.symbol,
    verdict,
    proceed: verdict === "pass",
    reasons: [...avoid, ...caution],
    notes,
    facts: {
      ageMin: Math.round(f.ageMin),
      buyers: f.buyers,
      buys: f.buys,
      sells: f.sells,
      creatorSoldPct: pct(f.creatorSold === null ? null : Math.min(1, f.creatorSold)),
      creatorLaunches24h: f.creatorLaunches24h,
      creatorDumped48h: c ? c.dumped : null,
      creatorMedianDumpMin: c ? c.medianDumpMin : null,
      bundleWallets: f.bundleWallets,
      bundleSharePct: pct(f.bundleShare),
      top5BuyingPct: pct(f.top5Share),
      graduated: f.graduated,
      quote: f.quote ?? null,
      mayhem: Boolean(f.mayhem),
      curveSol: f.curveSol,
      poolSol: f.poolSol,
      earlyWallets: f.earlyWallets ?? null,
      earlyHeldPct: pct(f.earlyHeld),
      churnPct: pct(f.washShare),
      bumps: f.bumps ?? null,
      creatorCrew: f.creatorCrew ?? null,
      ringWallets: f.ringWallets ?? null,
      serialSnipers: f.serialSnipers ?? null,
    },
    ...(holders !== undefined ? { holders } : {}),
    ...(lin !== undefined
      ? { funding: lin ? { funder: lin.funder, funderIsHot: lin.funderIsHot, otherCreators: lin.siblings.length, theirLaunches48h: lin.siblingLaunches48h, theirDumps48h: lin.siblingDumped48h } : null }
      : {}),
  };
}

/** A sliding one-minute window per caller: cheap protection for a public endpoint agents may call in a loop. */
export class RateGate {
  private readonly hits = new Map<string, number[]>();
  private readonly perMinute: number;
  constructor(perMinute: number) {
    this.perMinute = perMinute;
  }
  /** Milliseconds to wait, 0 when the call may go ahead (and is counted). */
  take(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent);
      return 60_000 - (now - recent[0]!);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < 60_000)) this.hits.delete(k);
    return 0;
  }
}
