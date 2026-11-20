import type { StateStore } from "@aiagentzoo/sdk";
import { compact, type Outcome, outcomeOf, type Verdict } from "../agents/judgement.ts";
import type { Observation } from "../agents/nightWatch.ts";

/**
 * The night's exam for both contests: a handful of tokens the zoo saw tonight, the same for every holder who plays
 * and for the odds model, which answers it the moment it is set. No model writes it: it is a seeded draw from the
 * night's observations that anyone can recompute from the night id. The next day the regrade (regrade.ts) grades
 * everyone on it with the same re-check.
 */

/** State keys. The exam keeps the nursery's old key, so nights set before 2026-11-20 still read. */
export const CONTEST = {
  exam: (night: string) => `evo:exam:${night}`,
  /** The odds model's verdict on each exam token, recorded when the exam is set. */
  odds: (night: string) => `contest:odds:${night}`,
} as const;
/** What the hedgehog found when it re-checked a night's tokens: the outcome everyone who judged them is graded on. */
export const FOLLOWUP = (night: string) => `followup:${night}`;
/** Humans vs the odds model: a night's answers by wallet, and the balance each answering wallet held when the night was graded. */
export const HUMANS = { answers: (night: string) => `humans:${night}`, held: (night: string) => `humans:held:${night}` };

export type Followup = Record<string, { symbol: string; outcome: Outcome }>;
export type ExamToken = ReturnType<typeof compact>;
export interface Exam {
  night: string;
  tokens: ExamToken[];
}
/** The odds model's answer on one exam token. */
export interface OddsCall {
  mint: string;
  symbol: string;
  /** chain.odds.run when the exam was set; null when the token had none (then the verdict is watch and not scored). */
  run: number | null;
  verdict: Verdict;
  at: number;
}

export const EXAM_SIZE = 8;
/** Scorable tokens seen before the night's exam is set. */
export const EXAM_AFTER = 40;
/** Liquidity above which a token is counted sturdy for the exam draw. */
export const STURDY_LIQUIDITY = 10_000;
/** The odds model's chance of a run above which a fresh launch is counted lively: about four times the average launch. */
export const LIVELY_ODDS = 0.1;
/** The same line is where the odds model says promising instead of suspicious. */
export const ODDS_PROMISING = LIVELY_ODDS;
/** Seats on each night's exam for sturdy and lively tokens; plain fresh launches take the rest. */
export const EXAM_SEATS = { sturdy: 3, lively: 3 } as const;
/** Scorable tokens after which the exam is set even if the sturdy or lively seats cannot all be filled. */
export const EXAM_WAIT_MAX = 300;

type Drawable = { mint: string; complete: boolean; market: { liquidityUsd: number | null } | null; chain?: { odds?: { run: number } | null } | null };

/** Splits the scorable tokens into sturdy (deep liquidity or graduated), lively (high odds of a run) and plain fresh launches. */
export function examStrata<T extends Drawable>(scorable: T[]): { sturdy: T[]; lively: T[]; fresh: T[] } {
  const sorted = [...scorable].sort((x, y) => x.mint.localeCompare(y.mint));
  const sturdy = sorted.filter((o) => o.complete || (o.market?.liquidityUsd ?? 0) >= STURDY_LIQUIDITY);
  const lively = sorted.filter((o) => !sturdy.includes(o) && (o.chain?.odds?.run ?? 0) >= LIVELY_ODDS);
  const fresh = sorted.filter((o) => !sturdy.includes(o) && !lively.includes(o));
  return { sturdy, lively, fresh };
}

/** The exam is set once the sturdy and lively seats can be filled between them, or once the night has waited long enough. */
export const examReady = <T extends Drawable>(scorable: T[], size: number, after: number) => {
  const { sturdy, lively } = examStrata(scorable);
  if (scorable.length < Math.max(after, size)) return false;
  return sturdy.length + lively.length >= EXAM_SEATS.sturdy + EXAM_SEATS.lively || scorable.length >= EXAM_WAIT_MAX;
};

/** A seeded shuffle, so the night's exam is a fair random draw that anyone can recompute from the night id. */
export function sample<T>(items: T[], n: number, seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.slice(0, n);
}

/**
 * Three sturdy tokens, three lively launches and the rest plain fresh launches, each a seeded draw anyone can
 * recompute from the night id. Plain launches almost all die; sturdy ones live far more often, and the lively seats
 * bring launches the odds model favours, so calling everything a rug stops paying.
 * A short stratum's seats go to lively, then sturdy, then fresh.
 */
export function drawExam<T extends Drawable>(scorable: T[], size: number, night: string): T[] {
  const strata = examStrata(scorable);
  const count = {
    sturdy: Math.min(EXAM_SEATS.sturdy, strata.sturdy.length),
    lively: Math.min(EXAM_SEATS.lively, strata.lively.length),
    fresh: Math.min(Math.max(0, size - EXAM_SEATS.sturdy - EXAM_SEATS.lively), strata.fresh.length),
  };
  let left = size - count.sturdy - count.lively - count.fresh;
  for (const k of ["lively", "sturdy", "fresh"] as const) {
    const add = Math.max(0, Math.min(left, strata[k].length - count[k]));
    count[k] += add;
    left -= add;
  }
  return (["sturdy", "lively", "fresh"] as const).flatMap((k) => sample(strata[k], count[k], `${night}:${k}`)).slice(0, size);
}

/**
 * Tokens that can sit the exam (the heron's rule): a market to grade tomorrow, not already dead. And now odds from
 * the chain too, so the baseline answers every token the holders answer.
 */
export const scorable = (obs: Observation[]) => obs.filter((o) => o.market && o.source !== "followup" && outcomeOf(o) !== "dead" && typeof o.chain?.odds?.run === "number");

/** The odds model's verdict: promising at or above the lively line, suspicious under it, watch when it has no odds. */
export function oddsCall(t: Pick<ExamToken, "mint" | "symbol" | "chain">, at: number): OddsCall {
  const run = typeof t.chain?.odds?.run === "number" ? t.chain.odds.run : null;
  return { mint: t.mint, symbol: t.symbol, run, verdict: run === null ? "watch" : run >= ODDS_PROMISING ? "promising" : "suspicious", at };
}

/**
 * Sets tonight's exam once enough tokens are in, and records the odds model's answers with it. Idempotent: an exam
 * already set stays as it is. Returns the exam, or null while the night is still too thin.
 */
export async function setExam(store: StateStore, night: string, obs: Observation[], now = Date.now(), opts: { size?: number; after?: number } = {}): Promise<Exam | null> {
  const existing = await store.get<Exam>(CONTEST.exam(night));
  if (existing) return existing;
  const size = opts.size ?? EXAM_SIZE;
  const pool = scorable(obs);
  if (!examReady(pool, size, opts.after ?? EXAM_AFTER)) return null;
  const exam: Exam = { night, tokens: drawExam(pool, size, night).map(compact) };
  await store.set(CONTEST.odds(night), exam.tokens.map((t) => oddsCall(t, now)));
  await store.set(CONTEST.exam(night), exam);
  return exam;
}
