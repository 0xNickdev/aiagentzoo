/**
 * Backtest for "dev gone, holders carry it": which tokens the north node says avoid today would turn caution under the
 * new rule, and how those tokens are doing. Reads public endpoints only, about a request a second.
 *
 *   node scripts/backtest-devgone.ts [out.json]          run it now and save what flipped
 *   node scripts/backtest-devgone.ts --recheck out.json  later: how the saved flips are doing now (drained, dead, alive)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { devGoneOf, type TokenCheck } from "../src/chain/check.ts";
import type { ChainFacts } from "../src/chain/pump.ts";
import type { HolderReport } from "../src/chain/holders.ts";

const NODE = process.env.ZOO_NODE ?? "https://north.zooaiagency.com";
const MAX_DEEP = Number(process.env.MAX_DEEP ?? 150);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(url: string, spacing = 1_000): Promise<T | null> {
  for (let i = 0; i < 4; i++) {
    await sleep(spacing);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (r.status === 429) {
        await sleep(Number(r.headers.get("retry-after") ?? 10) * 1000);
        continue;
      }
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      /* try again */
    }
  }
  return null;
}

const mintsOf = async (kind: string) => ((await get<{ moments: Array<{ mint: string }> }>(`${NODE}/v1/chain/moments?kind=${kind}&limit=500`))?.moments ?? []).map((m) => m.mint);

/** The check's rounded facts back into what devGoneOf reads. */
function factsOf(c: TokenCheck, drained: boolean): ChainFacts {
  const f = c.facts!;
  const u = (x: number | null) => (x === null ? null : x / 100);
  return {
    ageMin: f.ageMin, graduated: f.graduated, quote: f.quote ?? undefined, poolSol: f.poolSol, curveSol: f.curveSol,
    creatorSold: u(f.creatorSoldPct), bundlersHeld: u(f.bundlersHeldPct) ?? 0, earlyHeld: u(f.earlyHeldPct) ?? undefined, drained,
  } as unknown as ChainFacts;
}
const holdersOf = (c: TokenCheck): HolderReport | null =>
  c.holders ? ({ top10Share: c.holders.top10Pct / 100, topShare: c.holders.topWalletPct / 100, programShare: (c.holders.programPct ?? 0) / 100, creator: null, creatorShare: c.holders.creatorHoldsPct === null ? null : c.holders.creatorHoldsPct / 100 } as HolderReport) : null;

interface Dex { liquidityUsd: number | null; priceChangeH6: number | null; priceChangeH24: number | null; volumeH24: number | null }
async function dex(mint: string): Promise<Dex | null> {
  const d = await get<{ pairs: Array<{ liquidity?: { usd?: number }; priceChange?: { h6?: number; h24?: number }; volume?: { h24?: number } }> | null }>(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  const p = d?.pairs?.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!d) return null;
  return { liquidityUsd: p?.liquidity?.usd ?? null, priceChangeH6: p?.priceChange?.h6 ?? null, priceChangeH24: p?.priceChange?.h24 ?? null, volumeH24: p?.volume?.h24 ?? null };
}
/** Dead: under 2,000 dollars of liquidity, or down 90% in a day. */
const deadOf = (d: Dex | null) => d !== null && ((d.liquidityUsd ?? 0) < 2_000 || (d.priceChangeH24 ?? 0) <= -90);

async function recheck(file: string) {
  const saved = JSON.parse(readFileSync(file, "utf8")) as { at: number; flipped: Array<{ mint: string; symbol: string | null }> };
  const drainedNow = new Set(await mintsOf("drained"));
  let drained = 0, dead = 0;
  for (const t of saved.flipped) {
    const c = await get<TokenCheck>(`${NODE}/v1/check/${t.mint}`);
    const d = await dex(t.mint);
    const isDrained = drainedNow.has(t.mint) || (c?.facts?.poolSol ?? 999) < 40;
    const isDead = deadOf(d);
    if (isDrained) drained += 1;
    else if (isDead) dead += 1;
    console.log(`${t.symbol ?? t.mint}\tpool ${c?.facts?.poolSol ?? "?"} SOL\tliq $${Math.round(d?.liquidityUsd ?? 0)}\th24 ${d?.priceChangeH24 ?? "?"}%\t${isDrained ? "DRAINED" : isDead ? "DEAD" : "alive"}`);
  }
  const n = saved.flipped.length;
  console.log(`\n${n} flipped ${((Date.now() - saved.at) / 3.6e6).toFixed(1)} h ago: ${drained} drained, ${dead} dead, ${n - drained - dead} alive (${n ? Math.round(((drained + dead) / n) * 100) : 0}% bad)`);
}

async function run(out: string) {
  const drainedSet = new Set(await mintsOf("drained"));
  const mints = [...new Set([...(await mintsOf("graduated")), ...(await mintsOf("whale"))])];
  console.error(`${mints.length} graduated mints; ${drainedSet.size} drained moments`);
  // A light check first (cheap): only the ones the new rule could touch need the holders read.
  const light: TokenCheck[] = [];
  for (const m of mints) {
    const c = await get<TokenCheck>(`${NODE}/v1/check/${m}`);
    if (c?.facts) light.push(c);
  }
  const stats = { checked: light.length, avoid: light.filter((c) => c.verdict === "avoid").length, ageOk: 0, candidates: 0, deepRead: 0, holdersUnknown: 0 };
  const candidates = light.filter((c) => {
    if (c.verdict !== "avoid") return false;
    const f = factsOf(c, drainedSet.has(c.mint));
    if ((f.ageMin ?? 0) >= 120) stats.ageOk += 1;
    // Everything but the holders: the same rule with a spread-out holder list.
    return devGoneOf(f, { top10Share: 0, topShare: 0, programShare: 0, creator: null, creatorShare: null });
  });
  stats.candidates = candidates.length;
  console.error(`${stats.checked} checked, ${stats.avoid} avoid, ${stats.candidates} candidates before holders`);
  const flipped: Array<Record<string, unknown>> = [];
  const heldBack: Array<Record<string, unknown>> = [];
  for (const c0 of candidates.slice(0, MAX_DEEP)) {
    // The free tier allows ten deep reads a minute.
    const c = await get<TokenCheck>(`${NODE}/v1/check/${c0.mint}?holders=1`, 6_500);
    if (!c?.facts) continue;
    stats.deepRead += 1;
    const h = holdersOf(c);
    if (!h) stats.holdersUnknown += 1;
    const row = { mint: c.mint, symbol: c.symbol, ageMin: c.facts.ageMin, poolSol: c.facts.poolSol, curveSol: c.facts.curveSol, buyers: c.facts.buyers, top10Pct: c.holders?.top10Pct, topWalletPct: c.holders?.topWalletPct, bundlersHeldPct: c.facts.bundlersHeldPct, reasons: c.reasons };
    if (c.verdict === "avoid" && devGoneOf(factsOf(c, drainedSet.has(c.mint)), h)) flipped.push(row);
    else heldBack.push(row);
  }
  let bad = 0;
  for (const r of flipped) {
    const d = await dex(r.mint as string);
    r.dex = d;
    r.dead = deadOf(d);
    if (r.dead) bad += 1;
  }
  writeFileSync(out, JSON.stringify({ at: Date.now(), stats, flipped, heldBack }, null, 2));
  for (const r of flipped) console.log(`${r.symbol}\t${Math.round((r.ageMin as number) / 60)}h\tpool ${r.poolSol}\ttop10 ${r.top10Pct}%\ttop ${r.topWalletPct}%\tbundlers ${r.bundlersHeldPct}%\tliq $${Math.round((r.dex as Dex | null)?.liquidityUsd ?? 0)}\th24 ${(r.dex as Dex | null)?.priceChangeH24 ?? "?"}%\t${r.dead ? "DEAD" : "alive"}`);
  console.log(`\n${JSON.stringify(stats)}\nflipped avoid -> caution: ${flipped.length}; dead now: ${bad}; held back by holders: ${heldBack.length}\nsaved to ${out}; run --recheck ${out} later for what happened next`);
}

const args = process.argv.slice(2);
if (args[0] === "--recheck") await recheck(args[1]!);
else await run(args[0] ?? "backtest-devgone.json");
