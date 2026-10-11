import { type AgentDefinition, defineAgent, species, type StateStore } from "@aiagentzoo/sdk";
import { cleanText } from "../guests.ts";
import { type Call, CHAIN_NOTE, cleanPlaybook, compact, type Outcome, outcomeOf, parseCalls, previousNight, scoreCall } from "./judgement.ts";
import { nightOf, type Observation } from "./nightWatch.ts";

/**
 * Evolution: a population of judges that do not learn, they are selected.
 *
 * Eight creatures each carry a playbook, their DNA, fixed for life. Every night they all sit the same exam: a
 * handful of fresh tokens. A day later the hedgehog's re-check scores every answer. Every few nights a
 * generation turns: the weakest creature dies with an epitaph on the public log, the two strongest breed,
 * and the child inherits a crossover of their playbooks plus one mutation. The heron keeps the nursery.
 */

export interface Creature {
  id: string;
  name: string;
  /** The founding line this creature descends from through its fitter parent. */
  house: string;
  generation: number;
  parents: [string, string] | null;
  temperament: string;
  playbook: string;
  /** The one rule that is new in this creature, null for founders. */
  mutation: string | null;
  bornNight: string;
  diedNight: string | null;
  epitaph: string | null;
  lifetime: Tally;
  /** The same counts since the last turn: what selection looks at. */
  window: Tally;
}

/**
 * How a creature did on graded tokens. `hits`/`misses` count scored verdicts the usual way (a "watch" is neither);
 * the outcome counts drive selection: of the tokens that died, how many it called suspicious, and of those that
 * survived, how many it called promising. A "watch" counts against both, and so does saying the same thing about
 * everything, because most fresh tokens die.
 */
export interface Tally {
  hits: number;
  misses: number;
  dead?: number;
  deadRight?: number;
  alive?: number;
  aliveRight?: number;
  /** Answers of "watch" on tokens whose outcome was known. */
  watched?: number;
}

const zero = (): Required<Tally> => ({ hits: 0, misses: 0, dead: 0, deadRight: 0, alive: 0, aliveRight: 0, watched: 0 });
const full = (t: Tally): Required<Tally> => ({ ...zero(), ...t });
const add = (a: Tally, b: Tally): Required<Tally> => {
  const x = full(a);
  const y = full(b);
  return { hits: x.hits + y.hits, misses: x.misses + y.misses, dead: x.dead + y.dead, deadRight: x.deadRight + y.deadRight, alive: x.alive + y.alive, aliveRight: x.aliveRight + y.aliveRight, watched: x.watched + y.watched };
};
/** Tokens with a known outcome this creature answered on. */
export const graded = (t: Tally) => full(t).dead + full(t).alive;

export interface Population {
  generation: number;
  lastGenerationNight: string | null;
  nextId: number;
  creatures: Record<string, Creature>;
}

export interface ChronicleEntry {
  night: string;
  generation: number;
  kind: "founded" | "scored" | "death" | "birth" | "extinct";
  text: string;
  ids: string[];
  at: number;
}

export interface GenerationRecord {
  generation: number;
  night: string;
  /** Mean window accuracy of the living population just before the turn. */
  accuracy: number | null;
  best: string | null;
}

export interface Exam {
  night: string;
  tokens: ReturnType<typeof compact>[];
}

export interface EvoCase {
  mint: string;
  symbol: string;
  verdict: Call["verdict"];
  why: string;
  outcome: Outcome;
  hit: boolean | null;
}

export type NightResults = Record<string, Tally & { cases: EvoCase[] }>;

export const EVO = {
  population: "evo:population",
  chronicle: "evo:chronicle",
  history: "evo:history",
  exam: (night: string) => `evo:exam:${night}`,
  calls: (night: string) => `evo:calls:${night}`,
  results: (night: string) => `evo:results:${night}`,
} as const;

/** What the hedgehog found when it re-checked a night's tokens, kept by the beaver for everyone who judged them. */
export const FOLLOWUP = (night: string) => `followup:${night}`;
export type Followup = Record<string, { symbol: string; outcome: Outcome }>;

export const POPULATION_SIZE = 8;
export const EXAM_SIZE = 8;
const CHRONICLE_MAX = 300;
/** A creature needs this many graded answers since the last turn before selection can choose it. */
const MIN_GRADED = 6;
/** Answering "watch" on more than this share of graded tokens marks a creature as starving. */
const STARVING_SHARE = 0.6;

const FOUNDERS: Array<Pick<Creature, "name" | "temperament" | "playbook">> = [
  {
    name: "Fox",
    temperament: "the skeptic",
    playbook: [
      "1. Assume every fresh token dies by tomorrow until the data says otherwise.",
      "2. No socials at all is enough to call suspicious.",
      "3. Promising only with liquidity above $20k and buys outnumbering sells.",
      "4. A graduation alone is not a reason to trust.",
    ].join("\n"),
  },
  {
    name: "Lynx",
    temperament: "the liquidity hunter",
    playbook: [
      "1. Liquidity is the only number that matters; volume can be faked, a deep pool cannot.",
      "2. Liquidity under $3k: suspicious.",
      "3. Liquidity above $30k: promising, whatever the chart says.",
      "4. Everything in between is a watch.",
    ].join("\n"),
  },
  {
    name: "Moth",
    temperament: "the optimist drawn to light",
    playbook: [
      "1. Heavy trading means people care; volume above $100k leans promising.",
      "2. A sharp rise in the last day is momentum, not a warning.",
      "3. Call suspicious only when price has already fallen more than 70%.",
      "4. Graduated tokens with any socials are promising.",
    ].join("\n"),
  },
  {
    name: "Badger",
    temperament: "the paranoid",
    playbook: [
      "1. Sells outnumbering buys 2:1 is a rug in progress: suspicious.",
      "2. Volume more than 20x liquidity is wash trading: suspicious.",
      "3. A ticker that copies a famous brand is suspicious.",
      "4. Never say promising with confidence above 0.6.",
    ].join("\n"),
  },
  {
    name: "Wren",
    temperament: "the graduation watcher",
    playbook: [
      "1. Tokens that graduated from the bonding curve have survived the first filter: lean promising.",
      "2. Tokens still on the curve with tiny market cap are suspicious.",
      "3. A graduated token with sells outnumbering buys 3:1 is suspicious anyway.",
      "4. Socials matter less than graduation.",
    ].join("\n"),
  },
  {
    name: "Stoat",
    temperament: "the copycat hunter",
    playbook: [
      "1. Names and tickers that borrow a brand, a celebrity or a trending coin are suspicious.",
      "2. Original names with real socials deserve a watch at least.",
      "3. A fresh paid DexScreener profile on a copycat makes it more suspicious, not less.",
      "4. Promising needs an original name and liquidity above $10k.",
    ].join("\n"),
  },
  {
    name: "Newt",
    temperament: "the contrarian",
    playbook: [
      "1. When everyone piles in, the fall is close: a 24h rise above 500% is suspicious.",
      "2. A token that already dropped 50% and still has liquidity can be promising.",
      "3. Quiet tokens with steady buys are underrated: watch or promising.",
      "4. Distrust round, obvious signals.",
    ].join("\n"),
  },
  {
    name: "Crane",
    temperament: "the patient one",
    playbook: [
      "1. Most tokens are noise: say watch unless two signals agree.",
      "2. Suspicious when no socials and sells outnumber buys.",
      "3. Promising when graduated, socials present and liquidity above $15k.",
      "4. Confidence above 0.7 only with three agreeing signals.",
    ].join("\n"),
  },
];

/** A creature's founding trait: the first part of its temperament, without the article. */
const trait = (c: Creature) => c.temperament.split(" × ")[0]!.replace(/^the /, "");

function roman(n: number): string {
  const table: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of table) for (; n >= v; n -= v) out += s;
  return out;
}

export function foundPopulation(night: string): Population {
  const creatures: Record<string, Creature> = {};
  FOUNDERS.forEach((f, i) => {
    const id = `c${i + 1}`;
    creatures[id] = {
      id,
      name: `${f.name} I`,
      house: f.name,
      generation: 0,
      parents: null,
      temperament: f.temperament,
      playbook: f.playbook,
      mutation: null,
      bornNight: night,
      diedNight: null,
      epitaph: null,
      lifetime: zero(),
      window: zero(),
    };
  });
  return { generation: 0, lastGenerationNight: night, nextId: FOUNDERS.length + 1, creatures };
}

export const living = (p: Population) => Object.values(p.creatures).filter((c) => c.diedNight === null);

/**
 * Balanced accuracy with a gentle prior: the mean of "called the dead suspicious" and "called the living promising".
 * Calling everything suspicious scores about one half however many tokens die; only telling them apart scores high.
 */
export const fitness = (t: Tally) => {
  const x = full(t);
  return ((x.deadRight + 0.5) / (x.dead + 1) + (x.aliveRight + 0.5) / (x.alive + 1)) / 2;
};
/** Plain accuracy of scored verdicts, for display. */
export const accuracy = (t: Tally) => (t.hits + t.misses ? t.hits / (t.hits + t.misses) : null);
/** Balanced accuracy without the prior, or null before anything is graded. */
export const skill = (t: Tally) => {
  const x = full(t);
  if (!x.dead && !x.alive) return null;
  const parts = [x.dead ? x.deadRight / x.dead : null, x.alive ? x.aliveRight / x.alive : null].filter((v): v is number => v !== null);
  return parts.reduce((a, b) => a + b, 0) / parts.length;
};
export const starving = (t: Tally) => graded(t) >= MIN_GRADED && full(t).watched / graded(t) > STARVING_SHARE;

/** Scores every creature's answers from one night against the re-check, and adds them to its tallies. */
export function scorePopulation(pop: Population, calls: Record<string, Call[]>, followup: Followup): { pop: Population; results: NightResults } {
  const next: Population = { ...pop, creatures: { ...pop.creatures } };
  const results: NightResults = {};
  for (const [id, answers] of Object.entries(calls)) {
    const c = next.creatures[id];
    if (!c) continue;
    const cases: EvoCase[] = answers.map((a) => {
      const seen = followup[a.mint];
      const outcome = seen?.outcome ?? "unknown";
      return { mint: a.mint, symbol: seen?.symbol && seen.symbol !== "?" ? seen.symbol : a.symbol, verdict: a.verdict, why: a.why, outcome, hit: scoreCall(a.verdict, outcome) };
    });
    const known = cases.filter((x) => x.outcome !== "unknown");
    const night: Required<Tally> = {
      hits: cases.filter((x) => x.hit === true).length,
      misses: cases.filter((x) => x.hit === false).length,
      dead: known.filter((x) => x.outcome === "dead").length,
      deadRight: known.filter((x) => x.outcome === "dead" && x.verdict === "suspicious").length,
      alive: known.filter((x) => x.outcome === "alive").length,
      aliveRight: known.filter((x) => x.outcome === "alive" && x.verdict === "promising").length,
      watched: known.filter((x) => x.verdict === "watch").length,
    };
    results[id] = { ...night, cases };
    next.creatures[id] = { ...c, lifetime: add(c.lifetime, night), window: add(c.window, night) };
  }
  return { pop: next, results };
}

/** Who dies and who breeds this turn, or null when selection has too little to go on. */
export function selection(pop: Population): { dies: Creature; parents: [Creature, Creature] } | null {
  const ranked = living(pop)
    .filter((c) => graded(c.window) >= MIN_GRADED)
    .sort(
      (a, b) =>
        fitness(b.window) - fitness(a.window) ||
        // Between equals, the one that abstained more ranks lower, then the elder.
        full(a.window).watched - full(b.window).watched ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
  if (ranked.length < 3) return null;
  return { dies: ranked[ranked.length - 1]!, parents: [ranked[0]!, ranked[1]!] };
}

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

export const nightsBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Without a model the child still inherits: rules taken in turn from each parent, no mutation. */
export function interleave(a: string, b: string): string {
  const rules = (t: string) => t.split("\n").map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
  const ra = rules(a);
  const rb = rules(b);
  const out: string[] = [];
  for (let i = 0; i < Math.max(ra.length, rb.length) && out.length < 6; i++) {
    if (ra[i] && !out.includes(ra[i]!)) out.push(ra[i]!);
    if (rb[i] && !out.includes(rb[i]!) && out.length < 6) out.push(rb[i]!);
  }
  return out.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

export const BREED_SYSTEM = [
  "You are the heron, keeper of the nursery in ZOOAI AGENCY. Two judges of new Solana tokens are breeding.",
  "Each parent's playbook is its DNA: the rules it judges by. You get both playbooks and how often each parent was right.",
  "Write the child's playbook: inherit the rules most likely behind the parents' hits, drop rules that contradict each other, then add exactly ONE mutation: a new or changed rule neither parent has, plausible and testable on market data.",
  'Answer with JSON only: {"playbook": "numbered rules, at most 6, at most 900 characters", "mutation": "the mutated rule, one sentence"}.',
].join("\n");

export const EPITAPH_SYSTEM = [
  "You are a judge of new Solana tokens in ZOOAI AGENCY, and you have just been selected out: your calls were the least accurate of your generation.",
  "Write your last words: one dry, self-aware sentence (at most 140 characters) about the rule that failed you. No hashtags, no emojis.",
].join("\n");

export function parseChild(text: string): { playbook: string; mutation: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as { playbook?: unknown; mutation?: unknown };
    const playbook = typeof raw.playbook === "string" ? cleanPlaybook(raw.playbook).slice(0, 1000) : "";
    const mutation = typeof raw.mutation === "string" ? cleanText(raw.mutation, 200) : "";
    return playbook.length >= 40 && mutation ? { playbook, mutation } : null;
  } catch {
    return null;
  }
}

/** Applies one turn of selection: the death, the birth, a fresh window for everyone alive. */
export function turnGeneration(
  pop: Population,
  night: string,
  chosen: { dies: Creature; parents: [Creature, Creature] },
  child: { playbook: string; mutation: string | null },
  epitaph: string,
): { pop: Population; born: Creature; record: GenerationRecord } {
  const alive = living(pop);
  const mean = alive.map((c) => skill(c.window)).filter((a): a is number => a !== null);
  const record: GenerationRecord = {
    generation: pop.generation,
    night,
    accuracy: mean.length ? mean.reduce((s, a) => s + a, 0) / mean.length : null,
    best: chosen.parents[0].id,
  };
  const [a, b] = chosen.parents;
  const generation = Math.max(a.generation, b.generation) + 1;
  const id = `c${pop.nextId}`;
  // Names count the house's members ever born, so two children of one house never share a name.
  const nth = Object.values(pop.creatures).filter((c) => c.house === a.house).length + 1;
  const born: Creature = {
    id,
    name: `${a.house} ${roman(nth)}`,
    house: a.house,
    generation,
    parents: [a.id, b.id],
    // Two traits at most, one from each parent's founding line, so names stay readable after many generations.
    temperament: `${trait(a)} × ${trait(b)}`,
    playbook: child.playbook,
    mutation: child.mutation,
    bornNight: night,
    diedNight: null,
    epitaph: null,
    lifetime: zero(),
    window: zero(),
  };
  const creatures: Record<string, Creature> = {};
  for (const c of Object.values(pop.creatures)) {
    if (c.id === chosen.dies.id) creatures[c.id] = { ...c, diedNight: night, epitaph };
    else creatures[c.id] = c.diedNight === null ? { ...c, window: zero() } : c;
  }
  creatures[id] = born;
  return { pop: { generation: pop.generation + 1, lastGenerationNight: night, nextId: pop.nextId + 1, creatures }, born, record };
}

export function creatureSystem(c: Creature): string {
  return [
    `You are ${c.name}, ${c.temperament}, a judge of new Solana tokens in ZOOAI AGENCY, generation ${c.generation}.`,
    "Your playbook is your DNA. You cannot change it; you live or die by it. Apply it strictly, even when another approach looks tempting.",
    "",
    "Your playbook:",
    c.playbook,
    "",
    "For every token decide: promising (likely still alive with real liquidity tomorrow), suspicious (likely dead or rugged by tomorrow), or watch (not enough evidence).",
    CHAIN_NOTE,
    'Answer with a JSON array only, one object per token: {"mint": string, "verdict": "promising"|"watch"|"suspicious", "confidence": number 0..1, "why": string up to 120 chars, naming the rule you applied}.',
  ].join("\n");
}

export interface EvolutionConfig {
  briefAt: string;
  /** How often the heron wakes. */
  everyMs?: number;
  /** Nights per generation. */
  generationNights?: number;
  /** Fresh tokens seen before the night's exam is set. */
  examAfter?: number;
  /** Creatures judged per wake, to keep each session's model budget small. */
  judgesPerWake?: number;
}

export function evolutionAgent(cfg: EvolutionConfig): AgentDefinition {
  const generationNights = cfg.generationNights ?? 3;
  const examAfter = cfg.examAfter ?? 40;
  const judgesPerWake = cfg.judgesPerWake ?? 3;

  return defineAgent({
    name: "heron",
    species: species.builder,
    schedule: { every: cfg.everyMs ?? 20 * 60_000 },
    budget: { steps: 40, modelTokens: 30_000 },
    async onWake(ctx) {
      const night = nightOf(ctx.now, cfg.briefAt);
      const yesterday = previousNight(night);
      const chronicle = (await ctx.state.get<ChronicleEntry[]>(EVO.chronicle)) ?? [];
      const note = (entry: Omit<ChronicleEntry, "at">) => chronicle.push({ ...entry, at: ctx.now });
      let pop = await ctx.state.get<Population>(EVO.population);

      if (!pop) {
        pop = foundPopulation(night);
        note({ night, generation: 0, kind: "founded", text: `Eight founders enter the nursery: ${living(pop).map((c) => c.house).join(", ")}.`, ids: living(pop).map((c) => c.id) });
        await ctx.trace("evo.founded", { creatures: living(pop).map(({ id, name, temperament }) => ({ id, name, temperament })) });
      }

      // 1. Yesterday's answers, scored against the hedgehog's re-check.
      const followup = await ctx.state.get<Followup>(FOLLOWUP(yesterday));
      if (followup && !(await ctx.state.get<NightResults>(EVO.results(yesterday)))) {
        const calls = (await ctx.state.get<Record<string, Call[]>>(EVO.calls(yesterday))) ?? {};
        const scored = scorePopulation(pop, calls, followup);
        pop = scored.pop;
        await ctx.state.set(EVO.results(yesterday), scored.results);
        const tally = Object.values(scored.results).reduce((t, r) => ({ hits: t.hits + r.hits, misses: t.misses + r.misses }), { hits: 0, misses: 0 });
        const best = Object.entries(scored.results).sort(([, x], [, y]) => y.hits - x.hits || x.misses - y.misses)[0];
        if (tally.hits + tally.misses > 0) {
          note({
            night: yesterday,
            generation: pop.generation,
            kind: "scored",
            text: `The night's exam is graded: ${tally.hits} right, ${tally.misses} wrong across the nursery.${best && best[1].hits ? ` Best: ${pop.creatures[best[0]]?.name} with ${best[1].hits}.` : ""}`,
            ids: best ? [best[0]] : [],
          });
        }
        await ctx.trace("evo.scored", { night: yesterday, ...tally, results: Object.fromEntries(Object.entries(scored.results).map(([id, r]) => [id, { hits: r.hits, misses: r.misses }])) });
      }

      // 2. Every few nights, a generation turns.
      const since = pop.lastGenerationNight ? nightsBetween(pop.lastGenerationNight, night) : generationNights;
      // Only once yesterday's answers are graded, so selection never runs on half a night;
      // a night late, the turn goes ahead anyway rather than stall on a missing re-check.
      const ready =
        Boolean(await ctx.state.get<NightResults>(EVO.results(yesterday))) || !(await ctx.state.get<Exam>(EVO.exam(yesterday))) || since > generationNights;
      const chosen = since >= generationNights && ready ? selection(pop) : null;
      if (chosen) {
        const [a, b] = chosen.parents;
        let child: { playbook: string; mutation: string | null } = { playbook: interleave(a.playbook, b.playbook), mutation: null };
        try {
          const result = await ctx.think({
            system: BREED_SYSTEM,
            prompt: `Parent A, ${a.name}, balanced accuracy ${Math.round((skill(a.window) ?? 0) * 100)}% over ${graded(a.window)} graded tokens. Parent B, ${b.name}, ${Math.round((skill(b.window) ?? 0) * 100)}% over ${graded(b.window)}. Their playbooks follow.`,
            untrusted: { parentA: a.playbook, parentB: b.playbook },
            maxTokens: 900,
          });
          child = parseChild(result.text) ?? child;
        } catch (error) {
          await ctx.trace("evo.breed.fallback", { reason: (error as Error).message.slice(0, 200) });
        }
        const d = chosen.dies;
        const dSkill = Math.round((skill(d.window) ?? 0) * 100);
        let epitaph = `My rules told the dead from the living ${dSkill}% of the time. The nursery keeps the better ones.`;
        try {
          const result = await ctx.think({
            system: EPITAPH_SYSTEM,
            prompt: `You are ${d.name}, ${d.temperament}. Balanced accuracy ${dSkill}% since the last turn${starving(d.window) ? ", mostly by refusing to commit" : ""}. Your playbook follows.`,
            untrusted: { playbook: d.playbook },
            maxTokens: 120,
          });
          const line = cleanText(result.text.replace(/^["']|["']$/g, ""), 160);
          if (line.length > 10) epitaph = line;
        } catch {
          // The plain epitaph stands.
        }
        const turned = turnGeneration(pop, night, chosen, child, epitaph);
        pop = turned.pop;
        const history = (await ctx.state.get<GenerationRecord[]>(EVO.history)) ?? [];
        await ctx.state.set(EVO.history, [...history, turned.record].slice(-200));
        note({
          night,
          generation: pop.generation,
          kind: "death",
          text: `${d.name} dies${starving(d.window) ? " of starvation, answering watch on most tokens," : ""} at ${dSkill}% balanced accuracy. "${epitaph}"`,
          ids: [d.id],
        });
        note({
          night,
          generation: pop.generation,
          kind: "birth",
          text: `${turned.born.name} is born to ${a.name} and ${b.name}.${child.mutation ? ` Mutation: ${child.mutation}` : ""}`,
          ids: [turned.born.id, a.id, b.id],
        });
        if (!living(pop).some((c) => c.house === d.house)) {
          note({ night, generation: pop.generation, kind: "extinct", text: `House ${d.house} is extinct.`, ids: [d.id] });
        }
        await ctx.trace("evo.death", { id: d.id, name: d.name, window: d.window, epitaph });
        await ctx.trace("evo.birth", { id: turned.born.id, name: turned.born.name, parents: [a.id, b.id], mutation: child.mutation, playbook: child.playbook });
      }

      // 3. Tonight's exam: the same fresh tokens for every creature.
      let exam = await ctx.state.get<Exam>(EVO.exam(night));
      if (!exam) {
        const obs = Object.values((await ctx.state.get<Record<string, Observation>>(`obs:${night}`)) ?? {});
        // A fair draw: tokens with a market (so tomorrow can grade them) that are not already dead,
        // picked at random with the night as the seed, not the ones the rules already flag.
        const scorable = obs.filter((o) => o.market && outcomeOf(o) !== "dead" && o.source !== "followup");
        if (scorable.length >= examAfter) {
          exam = { night, tokens: sample(scorable.sort((x, y) => x.mint.localeCompare(y.mint)), EXAM_SIZE, night).map(compact) };
          await ctx.state.set(EVO.exam(night), exam);
          await ctx.trace("evo.exam", { night, mints: exam.tokens.map((t) => t.mint) });
        }
      }

      // 4. A few creatures sit the exam each wake.
      if (exam) {
        const answers = (await ctx.state.get<Record<string, Call[]>>(EVO.calls(night))) ?? {};
        const asked = exam.tokens.map((t) => ({ mint: t.mint, symbol: t.symbol }) as Observation);
        const waiting = living(pop).filter((c) => !answers[c.id]).slice(0, judgesPerWake);
        for (const c of waiting) {
          try {
            const result = await ctx.think({ system: creatureSystem(c), prompt: `Judge these ${exam.tokens.length} tokens.`, untrusted: exam.tokens, maxTokens: 1500 });
            const parsed = parseCalls(result.text, asked, ctx.now);
            if (parsed.length === 0) {
              // An unreadable answer is not an answer: the creature sits the exam again on the next wake.
              await ctx.trace("evo.answer.unparsed", { id: c.id, reply: result.text.slice(0, 200) });
              continue;
            }
            answers[c.id] = parsed;
            await ctx.trace("evo.answered", { id: c.id, name: c.name, calls: parsed.map(({ mint, verdict, why }) => ({ mint, verdict, why })) });
          } catch (error) {
            await ctx.trace("evo.answer.skipped", { id: c.id, reason: (error as Error).message.slice(0, 200) });
            break;
          }
        }
        if (waiting.length) await ctx.state.set(EVO.calls(night), answers);
      }

      await ctx.state.set(EVO.population, pop);
      await ctx.state.set(EVO.chronicle, chronicle.slice(-CHRONICLE_MAX));
    },
  });
}

/** Everything the evolution page shows at a glance. */
export async function evolutionView(store: StateStore, briefAt: string, now = Date.now(), generationNights = 3) {
  const pop = await store.get<Population>(EVO.population);
  if (!pop) return null;
  const night = nightOf(now, briefAt);
  const exam = await store.get<Exam>(EVO.exam(night));
  const calls = (await store.get<Record<string, Call[]>>(EVO.calls(night))) ?? {};
  const answered = Object.keys(calls);
  // How each creature split tonight's exam, so the page shows the night as it happens.
  const tonight = Object.fromEntries(
    Object.entries(calls).map(([id, cs]) => [
      id,
      { suspicious: cs.filter((c) => c.verdict === "suspicious").length, watch: cs.filter((c) => c.verdict === "watch").length, promising: cs.filter((c) => c.verdict === "promising").length },
    ]),
  );
  const since = pop.lastGenerationNight ? nightsBetween(pop.lastGenerationNight, night) : 0;
  // The same selection the heron will run, so "breeds next" and "at risk" on the page are never a guess.
  const preview = selection(pop);
  return {
    night,
    generation: pop.generation,
    nextGenerationInNights: Math.max(0, generationNights - since),
    preview: preview ? { dies: preview.dies.id, parents: preview.parents.map((p) => p.id) } : null,
    creatures: Object.values(pop.creatures).map(({ playbook: _p, ...c }) => ({
      ...c,
      lifetime: full(c.lifetime),
      window: full(c.window),
      accuracy: accuracy(c.lifetime),
      skill: skill(c.window),
      lifetimeSkill: skill(c.lifetime),
      fitness: fitness(c.window),
      graded: graded(c.window),
      starving: starving(c.window),
    })),
    chronicle: ((await store.get<ChronicleEntry[]>(EVO.chronicle)) ?? []).slice(-120).reverse(),
    history: (await store.get<GenerationRecord[]>(EVO.history)) ?? [],
    exam: exam ? { night, tokens: exam.tokens.map((t) => ({ mint: t.mint, symbol: t.symbol })), answered, tonight } : null,
  };
}

/** One creature: its DNA, its parents' DNA for the diff, and its answers night by night. */
export async function creatureView(store: StateStore, id: string, nights = 7) {
  const pop = await store.get<Population>(EVO.population);
  const c = pop?.creatures[id];
  if (!pop || !c) return null;
  const parents = (c.parents ?? []).map((p) => pop.creatures[p]).filter((p): p is Creature => Boolean(p));
  const keys = (await store.keys("evo:calls:")).sort().reverse().slice(0, nights);
  const record = [];
  for (const key of keys) {
    const night = key.slice("evo:calls:".length);
    const calls = (await store.get<Record<string, Call[]>>(key))?.[id];
    if (!calls) continue;
    const scored = (await store.get<NightResults>(EVO.results(night)))?.[id];
    record.push({ night, scored: Boolean(scored), cases: scored?.cases ?? calls.map(({ mint, symbol, verdict, why }) => ({ mint, symbol, verdict, why, outcome: null, hit: null })) });
  }
  const children = Object.values(pop.creatures).filter((x) => x.parents?.includes(id)).map((x) => ({ id: x.id, name: x.name }));
  return {
    ...c,
    lifetime: full(c.lifetime),
    window: full(c.window),
    accuracy: accuracy(c.lifetime),
    skill: skill(c.window),
    lifetimeSkill: skill(c.lifetime),
    starving: starving(c.window),
    parents: parents.map((p) => ({ id: p.id, name: p.name, house: p.house, playbook: p.playbook })),
    children,
    record,
  };
}
