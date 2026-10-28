import { type ModelProvider, renderUntrusted, UNTRUSTED_NOTICE } from "@aiagentzoo/sdk";
import { type Creature, fitness, graded, living, type Population } from "./agents/evolution.ts";
import { CHAIN_NOTE, FIELD_NOTES, type Verdict } from "./agents/judgement.ts";

/**
 * The nursery's council: when someone asks about a token, every living creature judges it by its own DNA, and the
 * votes are weighed by each creature's graded record. A creature no better than a coin flip still speaks, but its
 * vote weighs nothing, so the council leans the way the judges who have been right lean.
 */

export interface CouncilVote {
  id: string;
  name: string;
  house: string;
  verdict: Verdict;
  why: string;
  /** How much this vote counts: the creature's balanced accuracy above one half, zero until it has a record. */
  weight: number;
}

export interface Council {
  verdict: Verdict;
  /** From -1 (all weight on suspicious) to 1 (all weight on promising). */
  lean: number;
  votes: CouncilVote[];
}

/** Graded tokens a creature needs before its vote weighs anything. */
export const COUNCIL_MIN_GRADED = 6;
/** How far the weighted vote must lean before the council calls it; closer than this it says watch. */
export const COUNCIL_LEAN = 0.3;

const VERDICTS: Verdict[] = ["promising", "watch", "suspicious"];
const SIGN: Record<Verdict, number> = { promising: 1, watch: 0, suspicious: -1 };

export const weightOf = (c: Creature) => (graded(c.lifetime) >= COUNCIL_MIN_GRADED ? Math.max(0, Math.round((fitness(c.lifetime) - 0.5) * 1000) / 1000) : 0);

/** The weighted vote; when no creature has earned weight yet, every vote counts the same. */
export function tally(votes: CouncilVote[]): Pick<Council, "verdict" | "lean"> {
  const total = votes.reduce((a, v) => a + v.weight, 0);
  const w = (v: CouncilVote) => (total > 0 ? v.weight : 1);
  const sum = votes.reduce((a, v) => a + w(v), 0);
  const lean = sum ? votes.reduce((a, v) => a + w(v) * SIGN[v.verdict], 0) / sum : 0;
  const rounded = Math.round(lean * 100) / 100;
  return { verdict: rounded >= COUNCIL_LEAN ? "promising" : rounded <= -COUNCIL_LEAN ? "suspicious" : "watch", lean: rounded };
}

function councilSystem(creatures: Creature[]): string {
  return [
    "You speak for the judges of the ZOOAI AGENCY nursery. Each judge below has a playbook, its DNA. Judge the token once per judge, applying ONLY that judge's playbook, strictly, even where another judge's rule would say otherwise.",
    "",
    ...creatures.flatMap((c) => [`Judge ${c.id}: ${c.name}, ${c.temperament}.`, c.playbook, ""]),
    "Verdicts: promising (likely still alive with real liquidity tomorrow), suspicious (likely dead or rugged by tomorrow), or watch (not enough evidence).",
    FIELD_NOTES,
    CHAIN_NOTE,
    `Answer with a JSON array only, one object per judge: {"id": string, "verdict": "promising"|"watch"|"suspicious", "why": string up to 120 chars, naming the rule applied}.`,
    'Write "why" for a trader, in plain words, never field names.',
    UNTRUSTED_NOTICE,
  ].join("\n");
}

/** Reads the model's answer into one vote per living creature it answered for; anything else is dropped. */
export function parseVotes(text: string, creatures: Creature[]): CouncilVote[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const byId = new Map(creatures.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const votes: CouncilVote[] = [];
  for (const r of rows as Array<{ id?: unknown; verdict?: unknown; why?: unknown }>) {
    const c = typeof r?.id === "string" ? byId.get(r.id) : undefined;
    if (!c || seen.has(c.id) || !VERDICTS.includes(r.verdict as Verdict)) continue;
    seen.add(c.id);
    votes.push({ id: c.id, name: c.name, house: c.house, verdict: r.verdict as Verdict, why: typeof r.why === "string" ? r.why.slice(0, 160) : "", weight: weightOf(c) });
  }
  return votes;
}

/** One model call for the whole nursery on one token, or null when there is no nursery or no readable answer. */
export async function convene(model: ModelProvider, pop: Population | undefined | null, token: unknown): Promise<Council | null> {
  const creatures = pop ? living(pop) : [];
  if (!creatures.length) return null;
  const result = await model.think({
    system: councilSystem(creatures),
    prompt: `Judge this 1 token once for each of the ${creatures.length} judges.\n\n${renderUntrusted([token])}`,
    maxTokens: 1500,
  });
  const votes = parseVotes(result.text, creatures);
  if (votes.length < Math.ceil(creatures.length / 2)) return null;
  votes.sort((a, b) => b.weight - a.weight);
  return { ...tally(votes), votes };
}
