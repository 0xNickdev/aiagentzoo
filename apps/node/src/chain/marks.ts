import { appendFileSync } from "node:fs";
import { checkToken } from "./check.ts";
import { tape } from "./pump.ts";

/** A coin with fewer buyers than this at the mark is not written down: nobody was looking at it. */
const MIN_BUYERS = 10;

/**
 * Timed readings: how a launch stood five and twenty minutes in, and what the check said of it then. The tape keeps
 * only where a coin ended, and by then everyone has sold, so a rule like "the bundle has left" cannot be tested on it.
 * These lines can: one JSON line per reading, to be set against where the coin stood hours later. The verdict is the
 * one the live feed shows (chain facts only, without holders, funders or socials).
 */
export function writeMarks(file: string, now = Date.now()): number {
  const stream = { live: tape.live(now), lastEventSecAgo: Math.round((now - tape.lastEventAt) / 1000) };
  // A reading taken while the stream is down would describe the outage, not the coin.
  if (!stream.live) return 0;
  let lines = "";
  let n = 0;
  for (const { mint, min } of tape.dueMarks(now)) {
    const t = tape.token(mint, now);
    if (!t || t.facts.buyers < MIN_BUYERS) continue;
    const c = checkToken(mint, t, { now, stream });
    const f = c.facts;
    lines += `${JSON.stringify({
      mint,
      min,
      at: now,
      createdAt: t.createdAt,
      verdict: c.verdict,
      score: c.score,
      reasons: c.reasons,
      buyers: f?.buyers ?? null,
      buys: f?.buys ?? null,
      sells: f?.sells ?? null,
      curveSol: f?.curveSol ?? null,
      graduated: f?.graduated ?? null,
      creatorSoldPct: f?.creatorSoldPct ?? null,
      bundlers: f?.bundlers ?? null,
      bundlersHeldPct: f?.bundlersHeldPct ?? null,
      bundlersPeakPct: f?.bundlersPeakPct ?? null,
      bundledSol: f?.bundledSol ?? null,
      solIn: t.facts.solIn ?? null,
      top5BuyingPct: f?.top5BuyingPct ?? null,
      earlyHeldPct: f?.earlyHeldPct ?? null,
      churnPct: f?.churnPct ?? null,
    })}\n`;
    n++;
  }
  if (lines) appendFileSync(file, lines);
  return n;
}
