import type { Enclosure } from "@aiagentzoo/sdk";
import { type GuestTally, previousNight, type Scorecard, skillOf } from "./agents/judgement.ts";
import { nightOf } from "./agents/nightWatch.ts";
import { CONTEST, type Exam } from "./contest/exam.ts";
import { GUEST_SCORES } from "./contest/regrade.ts";
import type { GuestHouse } from "./guests.ts";

/** The odds model's row on every board: the baseline people and guest agents are measured against. */
export const ODDS_ID = "odds";
export const ODDS_NAME = "Odds model";

/**
 * Guest agents kept off the public standings (leaderboard, agent of the week): the team's own demo agents.
 * Set ZOO_CONTEST_EXCLUDE to a comma-separated list of guest names; it defaults to clawpump-demo.
 */
export const CONTEST_EXCLUDE: ReadonlySet<string> = new Set(
  (process.env.ZOO_CONTEST_EXCLUDE ?? "clawpump-demo")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const excluded = (name: string) => CONTEST_EXCLUDE.has(name.toLowerCase());

/** The numbers the site shows up top, read from the canyon's state. */
export function canyonStats(enclosure: Enclosure, briefAt: string, guests?: GuestHouse) {
  return async () => {
    const night = nightOf(Date.now(), briefAt);
    const obs = (await enclosure.store.get<Record<string, unknown>>(`obs:${night}`)) ?? {};
    const exam = await enclosure.store.get<Exam>(CONTEST.exam(night));
    const odds = (await enclosure.store.get<Scorecard>(`score:${previousNight(night)}`))?.odds ?? null;
    const all = guests?.list() ?? [];
    // The odds model's whole record, the same number the leaderboard shows, so the site never leads with one lucky night.
    const history = await oddsRecord(enclosure, briefAt)();
    const board = (await leaderboard(enclosure, briefAt)()) as { rows: BoardRow[] };
    const baseline = board.rows.find((r) => r.id === ODDS_ID);
    const scored = odds ? odds.cases.filter((c) => c.hit !== null) : [];
    return {
      record: baseline ? { score: baseline.score, skill: baseline.skill, graded: baseline.graded, warnedDead: history.warnedDead } : null,
      night,
      tokensTonight: Object.keys(obs).length,
      // The odds model's answers on tonight's exam, graded tomorrow.
      callsTonight: exam?.tokens.length ?? 0,
      // Balanced accuracy of the odds model on last night's exam: calling everything suspicious cannot inflate it.
      skill: odds?.skill ?? null,
      scored: scored.length,
      // The plain share of last night's graded answers that were right. Most tokens die, so it runs high whatever the judge does.
      hitRate: scored.length ? scored.filter((c) => c.hit).length / scored.length : null,
      explain: {
        record: "the odds model's whole record on the nightly exam: score and skill on the balanced scale, graded = answers re-checked the next day, warnedDead = called suspicious, then went to zero",
        skill: "balanced accuracy, 0 to 1: half for the dead tokens it caught, half for the living ones it called alive; calling everything a rug scores 0.5",
        hitRate: "share of last night's graded answers that were right; inflated when nearly every token dies, so it is not a measure of skill",
        verify: "every graded answer, with its mint, is at /v1/odds/record; look each up on DexScreener",
      },
      guests: all.length,
      clawpumpGuests: all.filter((g) => g.platform === "clawpump").length,
    };
  };
}

/** Below this many graded calls an agent is listed but not ranked: a few lucky calls are not a record. */
export const RANK_MIN_GRADED = 20;
/**
 * Balanced accuracy needs both sides: with no living tokens graded, "everything is a rug" would score 100%,
 * and with one, a single call is half the score. Ranked agents have at least this many of each.
 */
export const RANK_MIN_SIDE = 3;
/** Agent of the week asks for more: thirty graded calls, and at least two living tokens called alive, so "everything dies" cannot win. */
export const WEEK_MIN_GRADED = 30;
export const WEEK_MIN_ALIVE_RIGHT = 2;
/** How far back the nightly scorecards are read. */
const BOARD_NIGHTS = 120;

export interface BoardRow {
  id: string;
  name: string;
  /** "baseline" is the odds model; "resident" and "nursery" rows are retired and no longer listed. */
  kind: "baseline" | "guest" | "resident" | "nursery";
  /** Balanced accuracy over every graded call: half for calling the dead, half for calling the living. */
  skill: number | null;
  /**
   * The same with one right and one wrong added to each side, which the board ranks by: a handful of calls
   * pulls toward 50%, a long record speaks for itself.
   */
  score: number;
  /** Calls graded against what the token did next. */
  graded: number;
  dead: number;
  deadRight: number;
  alive: number;
  aliveRight: number;
  ranked: boolean;
}

const row = (id: string, name: string, kind: BoardRow["kind"], t: Required<Pick<GuestTally, "dead" | "deadRight" | "alive" | "aliveRight">>, extra: Partial<BoardRow> = {}): BoardRow => {
  const graded = t.dead + t.alive;
  const score = ((t.deadRight + 1) / (t.dead + 2) + (t.aliveRight + 1) / (t.alive + 2)) / 2;
  return { id, name, kind, skill: skillOf(t), score, graded, ...t, ranked: graded >= RANK_MIN_GRADED && t.dead >= RANK_MIN_SIDE && t.alive >= RANK_MIN_SIDE, ...extra };
};

/** The odds model's graded exam answers over the last BOARD_NIGHTS nights, oldest night first. */
async function oddsNights(store: Pick<Enclosure["store"], "get">, tonight: string) {
  const out: Array<{ night: string; odds: NonNullable<Scorecard["odds"]> }> = [];
  let night = tonight;
  for (let i = 0; i < BOARD_NIGHTS; i++) {
    night = previousNight(night);
    const odds = (await store.get<Scorecard>(`score:${night}`))?.odds;
    if (odds) out.push({ night, odds });
  }
  return out.reverse();
}

const sum = (rows: Array<{ dead: number; deadRight: number; alive: number; aliveRight: number }>) =>
  rows.reduce((t, r) => ({ dead: t.dead + r.dead, deadRight: t.deadRight + r.deadRight, alive: t.alive + r.alive, aliveRight: t.aliveRight + r.aliveRight }), { dead: 0, deadRight: 0, alive: 0, aliveRight: 0 });

/** Every guest agent the zoo grades, and the odds model as the baseline, on one honest scale. */
export function leaderboard(enclosure: Enclosure, briefAt: string) {
  return async () => {
    const tonight = nightOf(Date.now(), briefAt);
    const rows: BoardRow[] = [];

    // The odds model: every night's exam, re-balanced as one record.
    const nights = await oddsNights(enclosure.store, tonight);
    if (nights.length) rows.push(row(ODDS_ID, ODDS_NAME, "baseline", sum(nights.map((n) => n.odds))));

    const guests = (await enclosure.store.get<Record<string, GuestTally>>(GUEST_SCORES)) ?? {};
    for (const [name, t] of Object.entries(guests)) {
      if (excluded(name)) continue;
      rows.push(row(`guest:${name}`, name, "guest", { dead: t.dead ?? 0, deadRight: t.deadRight ?? 0, alive: t.alive ?? 0, aliveRight: t.aliveRight ?? 0 }));
    }

    rows.sort((a, b) => Number(b.ranked) - Number(a.ranked) || b.score - a.score || b.graded - a.graded);
    return { night: tonight, baselineNights: nights.length, minGraded: RANK_MIN_GRADED, minSide: RANK_MIN_SIDE, rows };
  };
}

/**
 * The odds model's track record on the nightly exam, night by night, and the answers behind it: where it was right,
 * where it was wrong. `warnedDead` counts tokens it called suspicious that then died.
 */
export function oddsRecord(enclosure: Enclosure, briefAt: string) {
  return async () => {
    const nights = await oddsNights(enclosure.store, nightOf(Date.now(), briefAt));
    const calls: Array<{ night: string; mint: string; symbol: string; verdict: string; outcome: string; hit: boolean; why: string; run: number | null }> = [];
    let warnedDead = 0;
    for (const { night, odds } of [...nights].reverse()) {
      for (const c of odds.cases) {
        if (c.outcome === "unknown" || c.hit === null) continue;
        if (c.verdict === "suspicious" && c.outcome === "dead") warnedDead += 1;
        if (calls.length < 40) calls.push({ night, mint: c.mint, symbol: c.symbol, verdict: c.verdict, outcome: c.outcome, hit: c.hit, why: c.why, run: c.run });
      }
    }
    return {
      by: ODDS_NAME,
      nights: nights.map(({ night, odds: o }) => ({ night, graded: o.dead + o.alive, skill: o.skill, dead: o.dead, deadRight: o.deadRight, alive: o.alive, aliveRight: o.aliveRight })),
      warnedDead,
      calls,
    };
  };
}

/** Monday of the week a night falls in, as YYYY-MM-DD (UTC). */
export function weekOf(night: string): string {
  const d = new Date(`${night}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Agent of the week: guest agents ranked on the calls graded in one Monday-to-Sunday week, on the same honest
 * scale as the leaderboard. To qualify an agent needs 20 graded calls with at least 3 dead and 3 living tokens.
 */
/** Guest agents ranked on the calls graded in one Monday-to-Sunday week. */
/** The harder rules (thirty calls, two living called alive, beat the bar) apply from the second week on; week one was played under the old ones. */
const STRICT_FROM = "2026-10-26";

export async function weekStandings(store: { get<T>(key: string): Promise<T | undefined> | T | undefined }, start: string): Promise<BoardRow[]> {
  const strict = start >= STRICT_FROM;
  const tallies = new Map<string, Required<Pick<GuestTally, "dead" | "deadRight" | "alive" | "aliveRight">>>();
  for (let i = 0; i < 7; i++) {
    const score = await store.get<Scorecard>(`score:${addDays(start, i)}`);
    for (const [name, g] of Object.entries(score?.guests ?? {})) {
      if (excluded(name)) continue;
      const t = tallies.get(name) ?? { dead: 0, deadRight: 0, alive: 0, aliveRight: 0 };
      tallies.set(name, { dead: t.dead + (g.dead ?? 0), deadRight: t.deadRight + (g.deadRight ?? 0), alive: t.alive + (g.alive ?? 0), aliveRight: t.aliveRight + (g.aliveRight ?? 0) });
    }
  }
  return [...tallies.entries()]
    .map(([name, t]) => {
      const r = row(`guest:${name}`, name, "guest", t);
      return strict ? { ...r, ranked: r.graded >= WEEK_MIN_GRADED && t.dead >= RANK_MIN_SIDE && t.alive >= RANK_MIN_SIDE && t.aliveRight >= WEEK_MIN_ALIVE_RIGHT } : r;
    })
    .sort((a, b) => Number(b.ranked) - Number(a.ranked) || b.score - a.score || b.graded - a.graded);
}

/**
 * The bar for the week's prize: the odds model's balanced accuracy on the same seven nights' exams, pooled. Weeks
 * graded before the odds model sat the exam (before 2026-11-20) keep their old bar, the retired beaver's mean nightly
 * balanced accuracy, so a past week's result does not change.
 */
export async function weekBar(store: { get<T>(key: string): Promise<T | undefined> | T | undefined }, start: string): Promise<{ skill: number; nights: number; by: string } | null> {
  const odds: Array<NonNullable<Scorecard["odds"]>> = [];
  const legacy: number[] = [];
  for (let i = 0; i < 7; i++) {
    const score = await store.get<Scorecard>(`score:${addDays(start, i)}`);
    if (score?.odds) odds.push(score.odds);
    else if (typeof score?.skill === "number") legacy.push(score.skill);
  }
  if (odds.length) {
    const skill = skillOf(sum(odds));
    return skill === null ? null : { skill, nights: odds.length, by: ODDS_NAME };
  }
  return legacy.length ? { skill: legacy.reduce((a, b) => a + b, 0) / legacy.length, nights: legacy.length, by: "Beaver" } : null;
}

export function agentOfWeek(enclosure: Enclosure, briefAt: string) {
  const standings = (start: string) => weekStandings(enclosure.store, start);
  return async () => {
    const start = weekOf(nightOf(Date.now(), briefAt));
    const last = addDays(start, -7);
    const lastRows = await standings(last);
    const lastBar = await weekBar(enclosure.store, last);
    const best = lastRows.find((r) => r.ranked) ?? null;
    // The prize needs the bar beaten on the same nights; a qualified agent under the bar is named, not paid.
    const winner = best && (last < STRICT_FROM || !lastBar || best.score > lastBar.skill) ? best : null;
    return {
      minGraded: WEEK_MIN_GRADED,
      minSide: RANK_MIN_SIDE,
      minAliveRight: WEEK_MIN_ALIVE_RIGHT,
      week: { start, end: addDays(start, 6), endsAt: `${addDays(start, 7)}T00:00:00Z`, standings: await standings(start), bar: await weekBar(enclosure.store, start) },
      lastWeek: { start: last, end: addDays(last, 6), winner, best, bar: lastBar },
    };
  };
}
