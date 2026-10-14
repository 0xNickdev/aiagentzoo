import type { Enclosure } from "@aiagentzoo/sdk";
import { evolutionView } from "./agents/evolution.ts";
import { balance, type Call, type GuestTally, type Playbook, previousNight, type Scorecard, skillOf } from "./agents/judgement.ts";
import { GUEST_SCORES, nightOf } from "./agents/nightWatch.ts";
import type { GuestHouse } from "./guests.ts";

/** The numbers the site shows up top, read from the canyon's state. */
export function canyonStats(enclosure: Enclosure, briefAt: string, model: string | null, guests?: GuestHouse) {
  return async () => {
    const night = nightOf(Date.now(), briefAt);
    const obs = (await enclosure.store.get<Record<string, unknown>>(`obs:${night}`)) ?? {};
    const calls = (await enclosure.store.get<Call[]>(`calls:${night}`)) ?? [];
    const score = await enclosure.store.get<Scorecard>(`score:${previousNight(night)}`);
    const playbook = await enclosure.store.get<Playbook>("beaver:playbook");
    const all = guests?.list() ?? [];
    // The beaver's whole record, the same number the leaderboard shows, so the site never leads with one lucky night.
    const board = (await leaderboard(enclosure, briefAt)()) as { rows: BoardRow[] };
    const beaver = board.rows.find((r) => r.id === "beaver");
    return {
      record: beaver ? { score: beaver.score, skill: beaver.skill, graded: beaver.graded } : null,
      night,
      tokensTonight: Object.keys(obs).length,
      callsTonight: calls.length,
      modelCallsTonight: calls.filter((c) => c.by === "model").length,
      accuracy: score?.accuracy ?? null,
      // Balanced accuracy: calling everything suspicious cannot inflate it. Null on scorecards from before it existed.
      skill: score?.skill ?? null,
      scored: score ? score.hits + score.misses : 0,
      playbookVersion: playbook?.version ?? 0,
      guests: all.length,
      clawpumpGuests: all.filter((g) => g.platform === "clawpump").length,
      model,
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
/** How far back the beaver's nightly scorecards are read. */
const BOARD_NIGHTS = 120;

export interface BoardRow {
  id: string;
  name: string;
  kind: "resident" | "guest" | "nursery";
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
  /** Night the agent died, for nursery creatures that did. */
  died?: string | null;
}

const row = (id: string, name: string, kind: BoardRow["kind"], t: Required<Pick<GuestTally, "dead" | "deadRight" | "alive" | "aliveRight">>, extra: Partial<BoardRow> = {}): BoardRow => {
  const graded = t.dead + t.alive;
  const score = ((t.deadRight + 1) / (t.dead + 2) + (t.aliveRight + 1) / (t.alive + 2)) / 2;
  return { id, name, kind, skill: skillOf(t), score, graded, ...t, ranked: graded >= RANK_MIN_GRADED && t.dead >= RANK_MIN_SIDE && t.alive >= RANK_MIN_SIDE, ...extra };
};

/** Every agent the zoo grades, resident, guest and nursery, on one honest scale. */
export function leaderboard(enclosure: Enclosure, briefAt: string) {
  return async () => {
    const tonight = nightOf(Date.now(), briefAt);
    const rows: BoardRow[] = [];

    // The beaver: every night's calls, re-balanced as one record.
    const cases: Scorecard["cases"] = [];
    let night = tonight;
    let nights = 0;
    for (let i = 0; i < BOARD_NIGHTS; i++) {
      night = previousNight(night);
      const score = await enclosure.store.get<Scorecard>(`score:${night}`);
      if (!score) continue;
      nights += 1;
      cases.push(...score.cases);
    }
    if (cases.length) {
      const b = balance(cases);
      rows.push(row("beaver", "Beaver", "resident", b));
    }

    const guests = (await enclosure.store.get<Record<string, GuestTally>>(GUEST_SCORES)) ?? {};
    for (const [name, t] of Object.entries(guests)) {
      rows.push(row(`guest:${name}`, name, "guest", { dead: t.dead ?? 0, deadRight: t.deadRight ?? 0, alive: t.alive ?? 0, aliveRight: t.aliveRight ?? 0 }));
    }

    const evo = (await evolutionView(enclosure.store, briefAt)) as {
      creatures: Array<{ id: string; name: string; diedNight: string | null; lifetime: { dead: number; deadRight: number; alive: number; aliveRight: number } }>;
    } | null;
    for (const c of evo?.creatures ?? []) {
      rows.push(row(`nursery:${c.id}`, c.name, "nursery", c.lifetime, { died: c.diedNight }));
    }

    rows.sort((a, b) => Number(b.ranked) - Number(a.ranked) || b.score - a.score || b.graded - a.graded);
    return { night: tonight, beaverNights: nights, minGraded: RANK_MIN_GRADED, minSide: RANK_MIN_SIDE, rows };
  };
}
