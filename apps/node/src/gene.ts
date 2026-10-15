import { type ModelProvider, renderUntrusted, type StateStore, UNTRUSTED_NOTICE } from "@aiagentzoo/sdk";
import { EVO, fitness, GENE, living, mistakes, type PendingGene, type PendingName, type Population } from "./agents/evolution.ts";
import { EXAM_FIELDS } from "./agents/judgement.ts";
import { cleanText } from "./guests.ts";
import { nightOf } from "./agents/nightWatch.ts";
import { weekOf } from "./stats.ts";
import { weekWinner } from "./humans.ts";

/**
 * The holders' gene. Every week the heron puts three candidate rules to $ZOOAGENCY holders, each aimed at the
 * nursery's latest mistakes. Holders vote with their balance; when the week closes every balance is read again and
 * the smaller of the two counts, so buying for the vote and selling after does not pay. The winning rule becomes the
 * mutation of the nursery's next newborn, and the week's best human on /play gives that newborn its name.
 */

export interface Candidate {
  id: "a" | "b" | "c";
  rule: string;
}
export interface Ballot {
  pick: Candidate["id"];
  weight: number;
  at: number;
}
export interface GeneVote {
  v?: number;
  week: string;
  candidates: Candidate[];
  votes: Record<string, Ballot>;
  closed: { winner: Candidate | null; tally: Record<string, number>; at: number } | null;
}
const IDS: Candidate["id"][] = ["a", "b", "c"];
const NAME = /^[A-Z][a-z]{2,13}$/;

const prevWeek = (week: string) => new Date(Date.parse(`${week}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);

const PROPOSE_SYSTEM = [
  "You are the heron of ZOOAI AGENCY. You keep a nursery of AI judges that call fresh Solana tokens suspicious, watch or promising.",
  "Propose exactly three different rules a judge could add to its playbook, each aimed at the mistakes below. One sentence each, at most 160 characters, concrete numbers where they help.",
  "Holders vote on them, so write plain English a person reads at a glance: words, not code. Say 'above', 'below', 'at least', 'and', 'is missing'; no ==, >, <, &&, parentheses or quotes.",
  "Tokens still on the pump.fun bonding curve always have no pool liquidity (market.liq is empty) and that is normal, never a red flag on its own; their size is market.curveCapSol, which starts near 28.",
  "Give one rule for catching dead tokens, one for spotting tokens that will live, and one that tells them apart in a way the mistakes show the nursery gets wrong.",
  `Rules may only use fields the judges actually see: ${EXAM_FIELDS}.`,
  'Answer with a JSON array of three strings only, like ["rule one", "rule two", "rule three"].',
  UNTRUSTED_NOTICE,
].join("\n");

/** Three rules for the week: the heron's proposals, or without a model the newest mutations in the nursery. */
export async function proposeRules(store: StateStore, model?: ModelProvider | null): Promise<string[]> {
  const pop = await store.get<Population>(EVO.population);
  const alive = pop ? living(pop).sort((x, y) => fitness(y.window) - fitness(x.window)) : [];
  if (model && alive.length) {
    try {
      const reader = { get: async <T>(k: string) => (await store.get<T>(k)) ?? undefined, keys: async (prefix?: string) => store.keys(prefix) };
      const wrong = await mistakes(reader, alive.map((c) => c.id), "", 12);
      const result = await model.think({ system: PROPOSE_SYSTEM, prompt: `The nursery's latest wrong calls:\n\n${renderUntrusted(wrong)}`, maxTokens: 400 });
      const start = result.text.indexOf("[");
      const end = result.text.lastIndexOf("]");
      const rules = (JSON.parse(result.text.slice(start, end + 1)) as unknown[])
        .filter((r): r is string => typeof r === "string")
        .map((r) => cleanText(r.replace(/==/g, " is ").replace(/!=/g, " is not ").replace(/>=|≥/g, " at least ").replace(/<=|≤/g, " at most ").replace(/>/g, " above ").replace(/</g, " below ").replace(/&&/g, " and ").replace(/\|\|/g, " or "), 160))
        .filter((r) => r.length >= 20);
      if (new Set(rules).size >= 3) return [...new Set(rules)].slice(0, 3);
    } catch {
      // Fall through to the nursery's own mutations.
    }
  }
  const own = [...new Set(alive.flatMap((c) => (c.mutation ? [cleanText(c.mutation, 160)] : [])))];
  return own.length >= 3 ? own.slice(0, 3) : [];
}

/** Bumped when the way candidates are written changes: a vote nobody has used yet is drawn again. */
const CANDIDATES_V = 2;

export async function openVote(store: StateStore, week: string, model?: ModelProvider | null): Promise<GeneVote | null> {
  const existing = await store.get<GeneVote>(GENE.vote(week));
  if (existing && (existing.v === CANDIDATES_V || Object.keys(existing.votes).length || existing.closed)) return existing;
  const rules = await proposeRules(store, model);
  if (rules.length < 3) return null;
  const vote: GeneVote = { v: CANDIDATES_V, week, candidates: rules.map((rule, i) => ({ id: IDS[i]!, rule })), votes: {}, closed: null };
  await store.set(GENE.vote(week), vote);
  return vote;
}

export async function castVote(store: StateStore, week: string, wallet: string, pick: string, weight: number, now = Date.now()): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  const vote = await store.get<GeneVote>(GENE.vote(week));
  if (!vote || vote.closed) return { ok: false, status: 409, reason: "no vote is open this week yet" };
  if (!vote.candidates.some((c) => c.id === pick)) return { ok: false, status: 400, reason: "pick one of the three rules" };
  vote.votes[wallet] = { pick: pick as Candidate["id"], weight, at: now };
  await store.set(GENE.vote(week), vote);
  return { ok: true };
}

const tallyOf = (vote: GeneVote) => {
  const tally: Record<string, number> = Object.fromEntries(vote.candidates.map((c) => [c.id, 0]));
  for (const b of Object.values(vote.votes)) tally[b.pick] = (tally[b.pick] ?? 0) + b.weight;
  return tally;
};

/**
 * Closes a finished week: every voter's balance is read again and the smaller of the two counts. The winning rule
 * waits for the next birth, and the week's best human on /play earns the right to name it.
 */
export async function closeWeek(store: StateStore, week: string, balanceOf: (wallet: string) => Promise<number | null>, now = Date.now()): Promise<GeneVote | null> {
  const vote = await store.get<GeneVote>(GENE.vote(week));
  if (!vote || vote.closed) return vote ?? null;
  for (const [wallet, b] of Object.entries(vote.votes)) {
    const balance = await balanceOf(wallet);
    if (balance !== null) b.weight = Math.min(b.weight, balance);
  }
  const tally = tallyOf(vote);
  const best = Math.max(0, ...Object.values(tally));
  const winner = best > 0 ? (vote.candidates.find((c) => tally[c.id] === best) ?? null) : null;
  vote.closed = { winner, tally, at: now };
  await store.set(GENE.vote(week), vote);
  if (winner) await store.set(GENE.pending, { week, rule: winner.rule } satisfies PendingGene);
  const human = await weekWinner(store, week);
  if (human) await store.set(GENE.name, { week, wallet: human, name: null } satisfies PendingName);
  return vote;
}

/** Runs on the canyon every few minutes: closes last week's vote once, opens this week's. */
export async function tickGene(store: StateStore, briefAt: string, balanceOf: (wallet: string) => Promise<number | null>, model?: ModelProvider | null, now = Date.now()) {
  const week = weekOf(nightOf(now, briefAt));
  await closeWeek(store, prevWeek(week), balanceOf, now);
  await openVote(store, week, model);
}

export async function nameNewborn(store: StateStore, wallet: string, name: string): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  const pending = await store.get<PendingName>(GENE.name);
  if (!pending || pending.wallet !== wallet) return { ok: false, status: 403, reason: "only last week's best human on /play names the next newborn" };
  const clean = name.trim();
  if (!NAME.test(clean)) return { ok: false, status: 400, reason: "one word, 3-14 letters, starting with a capital: like Ember" };
  await store.set(GENE.name, { ...pending, name: clean });
  return { ok: true };
}

/** This week's vote with its running tally, what the caller picked, and what waits for the next birth. */
export async function geneView(store: StateStore, briefAt: string, wallet: string | null, now = Date.now()) {
  const week = weekOf(nightOf(now, briefAt));
  const vote = await store.get<GeneVote>(GENE.vote(week));
  const last = await store.get<GeneVote>(GENE.vote(prevWeek(week)));
  const pending = await store.get<PendingGene>(GENE.pending);
  const name = await store.get<PendingName>(GENE.name);
  return {
    week,
    closesAt: new Date(Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000).toISOString(),
    candidates: vote?.candidates ?? [],
    tally: vote ? tallyOf(vote) : {},
    voters: vote ? Object.keys(vote.votes).length : 0,
    mine: wallet ? (vote?.votes[wallet]?.pick ?? null) : null,
    lastWinner: last?.closed?.winner ?? null,
    pending: pending ?? null,
    naming: name ? { week: name.week, name: name.name, you: wallet === name.wallet } : null,
  };
}
