import type { StateStore } from "@aiagentzoo/sdk";
import { balance, type GuestTally, type OddsScore, outcomeOf, scoreCall, type Scorecard, scoreNight } from "../agents/judgement.ts";
import type { GuestReport, Observation } from "../agents/nightWatch.ts";
import { snapshotHolding } from "../holders.ts";
import { CONTEST, FOLLOWUP, type Followup, type OddsCall } from "./exam.ts";

/**
 * The next-day regrade. The beaver hands yesterday's exam tokens and the guests' reported tokens to the hedgehog,
 * which re-reads each on DexScreener and on chain and sends the observations back in batches. Each batch lands here:
 * the outcomes are kept for everyone who judged those tokens, guests' verdicts and the odds model's are scored, each
 * answering holder's balance is read again (one bag cannot play from two wallets), and the guests' ledger moves.
 * Rules and arithmetic only: no model anywhere.
 */

/** Hits and misses of every guest's verdicts across nights. */
export const GUEST_SCORES = "guestscores";
/** Tokens re-checked a night, sent to the gatherer in batches of 30. */
export const FOLLOWUP_MAX = 90;

/**
 * The tokens worth a re-check tomorrow, at most `max`: the exam first (holders and the odds model answered it),
 * then the guests' verdicts, taking turns so each guest gets checked, until the room runs out.
 */
export function followupMints(exam: string[], reports: GuestReport[], max = FOLLOWUP_MAX): string[] {
  const picked = new Set<string>(exam.slice(0, max));
  const queues = reports.map((r) => r.items.filter((i) => i.verdict !== "watch" && !i.already).map((i) => i.mint));
  for (let round = 0; picked.size < max && queues.some((q) => q.length > round); round++) {
    for (const q of queues) {
      const mint = q[round];
      if (mint && picked.size < max) picked.add(mint);
    }
  }
  return [...picked];
}

/** The odds model's exam answers against the outcomes: one case each, counted the same way a guest's are. */
export function scoreOdds(calls: OddsCall[], followup: Followup): OddsScore {
  const cases = calls.map((c) => {
    const seen = followup[c.mint];
    const outcome = seen?.outcome ?? "unknown";
    return { mint: c.mint, symbol: seen?.symbol && seen.symbol !== "?" ? seen.symbol : c.symbol, verdict: c.verdict, why: c.run === null ? "no odds" : `odds of a run ${Math.round(c.run * 1000) / 10}%`, outcome, hit: scoreCall(c.verdict, outcome), run: c.run };
  });
  const { dead, deadRight, alive, aliveRight, skill } = balance(cases);
  return { cases, dead, deadRight, alive, aliveRight, skill };
}

/**
 * One batch of the hedgehog's re-check for `night`. Idempotent per token: a batch merges with those already back and
 * the night is scored on everything back so far, never on one batch; the guests' ledger only moves by what changed.
 */
export async function regrade(store: StateStore, night: string, items: Observation[], opts: { balance?: (wallet: string) => Promise<number | null> } = {}): Promise<Scorecard> {
  const before = (await store.get<Scorecard>(`score:${night}`)) ?? null;
  const seen = (await store.get<Observation[]>(`followupobs:${night}`)) ?? [];
  const merged = [...new Map([...seen, ...items].map((o) => [o.mint, o])).values()];
  await store.set(`followupobs:${night}`, merged);

  const followup: Followup = Object.fromEntries(merged.map((o) => [o.mint, { symbol: o.symbol, outcome: outcomeOf(o) }]));
  await store.set(FOLLOWUP(night), followup);

  const reports = Object.values((await store.get<Record<string, GuestReport>>(`reports:${night}`)) ?? {});
  const score: Scorecard = scoreNight(night, [], reports, merged);
  const odds = await store.get<OddsCall[]>(CONTEST.odds(night));
  if (odds?.length) score.odds = scoreOdds(odds, followup);
  await store.set(`score:${night}`, score);

  // The humans who answered that night: what each wallet holds now, so a bag sold after answering, or passed from
  // wallet to wallet through the night, earns nothing.
  await snapshotHolding(store, night, opts.balance).catch(() => null);

  // Guests earn a track record from the same checks: one ledger of hits and misses per guest.
  if (Object.keys(score.guests).length) {
    const ledger = (await store.get<Record<string, GuestTally>>(GUEST_SCORES)) ?? {};
    for (const [name, g] of Object.entries(score.guests)) {
      const prev = ledger[name] ?? { hits: 0, misses: 0 };
      // Only what this batch added: the ledger already holds the night's earlier batches.
      const had = before?.guests[name];
      const sum = (k: keyof GuestTally) => (prev[k] ?? 0) + (g[k] ?? 0) - (had?.[k] ?? 0);
      ledger[name] = { hits: sum("hits"), misses: sum("misses"), dead: sum("dead"), deadRight: sum("deadRight"), alive: sum("alive"), aliveRight: sum("aliveRight") };
    }
    await store.set(GUEST_SCORES, ledger);
  }
  return score;
}
