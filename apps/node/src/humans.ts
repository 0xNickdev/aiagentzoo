import type { StateStore } from "@aiagentzoo/sdk";
import { CONTEST, type Exam, FOLLOWUP, type Followup, HUMANS, type OddsCall } from "./contest/exam.ts";
import { HOLDER_MIN } from "./holders.ts";
import { skillOf, type Verdict, VERDICTS } from "./agents/judgement.ts";
import { nightOf } from "./agents/nightWatch.ts";
import { ODDS_ID, ODDS_NAME, weekOf } from "./stats.ts";

/**
 * Humans vs the beaver, where the beaver is now the odds model. Every night holders sit the exam (contest/exam.ts):
 * the tokens the odds model answered when the exam was set. The next day the same re-check grades both. Weekly
 * standings put people and the odds model on one honest scale.
 */

const key = HUMANS.answers;
/** A week's rank needs this many graded answers, with dead and living tokens among them. */
export const HUMAN_MIN_GRADED = 15;
export const HUMAN_MIN_SIDE = 2;

type Answers = Record<string, Verdict>;
interface Tally {
  dead: number;
  deadRight: number;
  alive: number;
  aliveRight: number;
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const smoothed = (t: Tally) => ((t.deadRight + 1) / (t.dead + 2) + (t.aliveRight + 1) / (t.alive + 2)) / 2;

/** Records a holder's answers to tonight's exam; answers can change until the night ends. */
export async function submitAnswers(store: StateStore, wallet: string, raw: unknown, briefAt: string, now = Date.now()): Promise<{ ok: true; night: string; answered: number } | { ok: false; status: number; reason: string }> {
  const night = nightOf(now, briefAt);
  const exam = await store.get<Exam>(CONTEST.exam(night));
  if (!exam) return { ok: false, status: 409, reason: "tonight's exam is not set yet, try again later tonight" };
  const asked = new Set(exam.tokens.map((t) => t.mint));
  const answers: Answers = {};
  for (const a of Array.isArray(raw) ? raw : []) {
    const { mint, verdict } = (a ?? {}) as { mint?: unknown; verdict?: unknown };
    if (typeof mint === "string" && asked.has(mint) && VERDICTS.includes(verdict as Verdict)) answers[mint] = verdict as Verdict;
  }
  if (!Object.keys(answers).length) return { ok: false, status: 400, reason: "no answers to tonight's tokens" };
  const all = (await store.get<Record<string, Answers>>(key(night))) ?? {};
  all[wallet] = { ...(all[wallet] ?? {}), ...answers };
  await store.set(key(night), all);
  return { ok: true, night, answered: Object.keys(all[wallet]!).length };
}

async function weekTallies(store: StateStore, start: string) {
  const humans = new Map<string, Tally>();
  const judges = new Map<string, Tally>();
  for (let i = 0; i < 7; i++) {
    const night = addDays(start, i);
    const followup = await store.get<Followup>(FOLLOWUP(night));
    if (!followup) continue;
    // The balance each wallet held when the night was graded; a wallet under the line that morning sat the night for nothing.
    const held = (await store.get<Record<string, number>>(HUMANS.held(night))) ?? {};
    for (const [wallet, answers] of Object.entries((await store.get<Record<string, Answers>>(key(night))) ?? {})) {
      if (wallet in held && held[wallet]! < HOLDER_MIN) continue;
      const t = humans.get(wallet) ?? { dead: 0, deadRight: 0, alive: 0, aliveRight: 0 };
      for (const [mint, verdict] of Object.entries(answers)) {
        const outcome = followup[mint]?.outcome;
        if (outcome === "dead") {
          t.dead += 1;
          if (verdict === "suspicious") t.deadRight += 1;
        } else if (outcome === "alive") {
          t.alive += 1;
          if (verdict === "promising") t.aliveRight += 1;
        }
      }
      humans.set(wallet, t);
    }
    // The baseline: the odds model's answers on the same exam, recorded when it was set.
    const odds = (await store.get<OddsCall[]>(CONTEST.odds(night))) ?? [];
    if (odds.length) {
      const t = judges.get(ODDS_ID) ?? { dead: 0, deadRight: 0, alive: 0, aliveRight: 0 };
      for (const c of odds) {
        const outcome = followup[c.mint]?.outcome;
        if (outcome === "dead") {
          t.dead += 1;
          if (c.verdict === "suspicious") t.deadRight += 1;
        } else if (outcome === "alive") {
          t.alive += 1;
          if (c.verdict === "promising") t.aliveRight += 1;
        }
      }
      judges.set(ODDS_ID, t);
    }
  }
  const rank = (m: Map<string, Tally>, minGraded: number, minSide: number) =>
    [...m.entries()]
      .map(([id, t]) => ({ id, ...t, graded: t.dead + t.alive, score: smoothed(t), skill: skillOf(t), ranked: t.dead + t.alive >= minGraded && t.dead >= minSide && t.alive >= minSide }))
      .sort((a, b) => Number(b.ranked) - Number(a.ranked) || b.score - a.score || b.graded - a.graded);
  return { humans: rank(humans, HUMAN_MIN_GRADED, HUMAN_MIN_SIDE), judges: rank(judges, 0, 0) };
}

/** Tonight's exam, the caller's answers, this week's standings against the odds model, and last week's top three. */
export async function humansView(store: StateStore, briefAt: string, wallet: string | null, now = Date.now()) {
  const night = nightOf(now, briefAt);
  const exam = await store.get<Exam>(CONTEST.exam(night));
  const mine = wallet ? (((await store.get<Record<string, Answers>>(key(night))) ?? {})[wallet] ?? {}) : {};
  const start = weekOf(night);
  const week = await weekTallies(store, start);
  const last = await weekTallies(store, addDays(start, -7));
  const odds = week.judges.find((j) => j.id === ODDS_ID);
  const baseline = odds ? { name: ODDS_NAME, score: odds.score, skill: odds.skill, graded: odds.graded } : null;
  const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
  return {
    night,
    exam: exam?.tokens ?? [],
    mine,
    rules: { minGraded: HUMAN_MIN_GRADED, minSide: HUMAN_MIN_SIDE, holdMin: HOLDER_MIN, heldAtGrading: true },
    week: { start, end: addDays(start, 6), endsAt: `${addDays(start, 7)}T00:00:00Z` },
    // The bar people play against. bestJudge is the same row under its old name, for clients built for the nursery.
    baseline,
    bestJudge: baseline,
    standings: week.humans.slice(0, 25).map((r) => ({ ...r, id: short(r.id), you: r.id === wallet })),
    lastWeekTop: last.humans.filter((r) => r.ranked).slice(0, 3).map((r) => ({ wallet: short(r.id), score: r.score, graded: r.graded })),
  };
}

