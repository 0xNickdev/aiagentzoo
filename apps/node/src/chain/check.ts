import { curveCapOf, CURVE_DEAD_SOL, POOL_DEAD_SOL } from "../agents/judgement.ts";
import type { ChainFacts, CreatorRecord } from "./pump.ts";

/**
 * A pre-trade check for agents: one fast, model-free verdict on a pump.fun token from what the tape saw on chain.
 * avoid and caution say why in plain words; pass means none of the checks fired, not that the token is good.
 */
export type CheckVerdict = "avoid" | "caution" | "pass" | "unknown";

export interface TokenCheck {
  mint: string;
  symbol: string | null;
  verdict: CheckVerdict;
  /** true only on pass; null when the tape never saw the token, so the caller decides with its other tools. */
  proceed: boolean | null;
  reasons: string[];
  facts: {
    ageMin: number;
    buyers: number;
    creatorSoldPct: number | null;
    creatorLaunches24h: number;
    creatorDumped48h: number | null;
    bundleWallets: number | null;
    bundleSharePct: number | null;
    top5SharePct: number | null;
    graduated: boolean;
    /** The token it trades against when not SOL. */
    quote: string | null;
    curveSol: number | null;
    poolSol: number | null;
  } | null;
  checkedAt: number;
  more: string;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100));

export function checkToken(
  mint: string,
  found: { symbol: string; facts: ChainFacts; creatorRecord: CreatorRecord | null } | null,
  now = Date.now(),
): TokenCheck {
  const more = `https://zooaiagency.com/ask`;
  if (!found) {
    return {
      mint,
      symbol: null,
      verdict: "unknown",
      proceed: null,
      reasons: ["not a pump.fun launch from the last two days, so there is no chain record to check"],
      facts: null,
      checkedAt: now,
      more,
    };
  }
  const f = found.facts;
  const c = found.creatorRecord;
  const avoid: string[] = [];
  const caution: string[] = [];

  if (f.creatorSold !== null && f.creatorSold >= 0.5) avoid.push(`the creator sold ${pct(Math.min(1, f.creatorSold))}% of their own bag`);
  else if (f.creatorSold !== null && f.creatorSold > 0.1) caution.push(`the creator has sold ${pct(f.creatorSold)}% of their own bag`);

  if (c && c.dumped >= 3 && c.dumped / Math.max(1, c.launches48h) >= 0.5) {
    const speed = c.medianDumpMin === null ? "" : `, usually ${c.medianDumpMin} min after launch`;
    avoid.push(`this creator dumped ${c.dumped} of their ${c.launches48h} launches in 48 hours${speed}`);
  } else if (f.creatorLaunches24h >= 3) {
    caution.push(`the creator launched ${f.creatorLaunches24h} tokens in the last 24 hours`);
  }

  if (f.bundleWallets !== null && f.bundleShare !== null && f.bundleWallets >= 3 && f.bundleShare >= 0.15) {
    avoid.push(`${f.bundleWallets} wallets bought ${pct(f.bundleShare)}% of the supply in the launch block`);
  }

  if (f.graduated) {
    if (f.poolSol !== null && f.poolSol < POOL_DEAD_SOL) avoid.push(`graduated, but the pool is down to ${f.poolSol.toFixed(2)} SOL`);
  } else if (f.ageMin >= 360 && !f.quote) {
    const real = f.curveSol ?? (f.buys === 0 ? 0 : null);
    if (real !== null && curveCapOf(real) < CURVE_DEAD_SOL) avoid.push(`${Math.round(f.ageMin / 60)} hours old and the curve is back where it opened: nobody is holding it`);
  }

  if (f.top5Share !== null && f.top5Share > 0.5) caution.push(`the top 5 buyers took ${pct(f.top5Share)}% of all buying`);
  if (f.ageMin < 10) caution.push(`only ${Math.max(0, Math.round(f.ageMin))} min old, too early to tell`);
  else if (f.buyers === 0) caution.push("nobody has bought it");
  else if (f.buyers < 10) caution.push(`only ${f.buyers} wallets have bought it`);
  if (f.sells > f.buys * 2 && f.sells >= 10) caution.push(`sells outnumber buys ${f.sells} to ${f.buys}`);

  const verdict: CheckVerdict = avoid.length ? "avoid" : caution.length ? "caution" : "pass";
  return {
    mint,
    symbol: found.symbol,
    verdict,
    proceed: verdict === "pass",
    reasons: verdict === "pass" ? ["no creator dump, bundle, serial launcher or dead curve seen on chain"] : [...avoid, ...caution],
    facts: {
      ageMin: Math.round(f.ageMin),
      buyers: f.buyers,
      creatorSoldPct: pct(f.creatorSold === null ? null : Math.min(1, f.creatorSold)),
      creatorLaunches24h: f.creatorLaunches24h,
      creatorDumped48h: c ? c.dumped : null,
      bundleWallets: f.bundleWallets,
      bundleSharePct: pct(f.bundleShare),
      top5SharePct: pct(f.top5Share),
      graduated: f.graduated,
      quote: f.quote ?? null,
      curveSol: f.curveSol,
      poolSol: f.poolSol,
    },
    checkedAt: now,
    more,
  };
}
