import { checkToken } from "./check.ts";
import { solUsd } from "./price.ts";
import { tape } from "./pump.ts";
import { socials } from "./socials.ts";

/**
 * The live feed: pump.fun's new, soon and migrated boards with the known scams taken out (avoid never shown).
 * Building it is also what stamps a coin with the cap it first showed at, so the node builds it on its own clock
 * too, not only when a reader has the page open.
 */
export function feedBody(now = Date.now()) {
  const c = tape.feedCandidates(now);
  const stream = { live: tape.live(now), lastEventSecAgo: Math.round((now - tape.lastEventAt) / 1000) };
  const row = (mint: string) => {
    const t = tape.token(mint);
    if (!t) return null;
    const check = checkToken(mint, t, { now, stream });
    if (check.verdict === "avoid" || check.verdict === "unknown") return null;
    const f = t.facts;
    const image = socials.image(mint);
    // The coins on screen get their picture read now, not when the queue gets to them.
    if (!image) socials.fetchNow(mint, now);
    // pump.fun's curve: 30 SOL and 1.073B tokens virtual at the start, so the cap in SOL follows from the SOL in it.
    // After graduation the pool's depth no longer says the price (anyone can add liquidity): the last trade does.
    const cap = f.graduated ? tape.capNow(mint) : (30 + (f.curveSol ?? 0)) ** 2 / 32.19;
    const capSol = cap === null ? null : Math.round(cap * 10) / 10;
    const shown = tape.noteShown(mint, capSol, now);
    return {
      mint,
      symbol: t.symbol,
      name: t.name,
      createdAt: t.createdAt,
      ...(image ? { image } : {}),
      verdict: check.verdict,
      score: check.score,
      reason: check.reasons[0] ?? null,
      buyers: f.buyers,
      buys: f.buys,
      sells: f.sells,
      devSoldPct: f.creatorSold === null ? null : Math.round(f.creatorSold * 100),
      curveSol: f.curveSol,
      progress: f.graduated ? 1 : Math.min(1, Math.round(((f.curveSol ?? 0) / 85) * 100) / 100),
      capSol,
      // The cap it had when this feed first showed it, and when that was.
      shownCapSol: shown?.capSol ?? null,
      shownAt: shown?.at ?? null,
      poolSol: f.poolSol,
      graduated: f.graduated,
    };
  };
  const pick = (list: string[]) => list.map(row).filter(Boolean).slice(0, 40);
  return { stream, solUsd: solUsd(), new: pick(c.fresh), soon: pick(c.soon), migrated: pick(c.migrated) };
}
