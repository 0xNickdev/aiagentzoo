import { appendFileSync, renameSync, statSync } from "node:fs";
import { checkToken } from "./check.ts";
import { tape } from "./pump.ts";
import type { MarkRow } from "./radar.ts";

/** A coin with fewer buyers than this at the mark is not written down: nobody was looking at it. */
const MIN_BUYERS = 10;
/** The readings file is turned over at this size, so it never fills the disk. */
const MAX_BYTES = 400 * 1024 * 1024;

/**
 * Timed readings: how a launch stood five and twenty minutes in, and what the check said of it then. The tape keeps
 * only where a coin ended, and by then everyone has sold, so a rule like "the bundle has left" cannot be tested on it.
 * These lines can: one JSON line per reading, to be set against where the coin stood hours later. The verdict is the
 * one the live feed shows (chain facts only, without holders, funders or socials).
 */
export function writeMarks(file: string, now = Date.now(), onRow?: (row: MarkRow, info: { symbol: string; skip: boolean }) => void): number {
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
    const row = {
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
      creatorFeesSol: f?.creatorFees?.total ?? null,
    };
    const line = JSON.stringify(row);
    lines += `${line}\n`;
    // The runner radar reads the same line the trial grades (parsed back, as the trial reads it); a failure there never costs the reading.
    try {
      onRow?.(JSON.parse(line) as MarkRow, { symbol: t.symbol, skip: Boolean(t.facts.mayhem || t.facts.quote || t.facts.venue) });
    } catch {
      /* the mark stands */
    }
    n++;
  }
  if (lines) {
    // About 16 MB a day: past 400 MB the file is set aside as .old (the one before it is dropped) and a new one begins.
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`);
    } catch {
      /* no file yet */
    }
    appendFileSync(file, lines);
  }
  return n;
}
