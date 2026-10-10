import { type AgentDefinition, defineAgent, species, type StateStore } from "@aiagentzoo/sdk";
import { cleanText } from "../guests.ts";
import { type Call, candidates, cleanPlaybook, compact, type Outcome, parseCalls, previousNight, scoreCall } from "./judgement.ts";
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
  /** Hits and misses since the last generation turned: what selection looks at. */
  window: Tally;
}

export interface Tally {
  hits: number;
  misses: number;
}

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
/** A creature needs this many scored answers in a generation before it can be chosen to die or to breed. */
const MIN_SCORED = 3;

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

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
const roman = (n: number) => ROMAN[n] ?? String(n);

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
      lifetime: { hits: 0, misses: 0 },
      window: { hits: 0, misses: 0 },
    };
  });
  return { generation: 0, lastGenerationNight: night, nextId: FOUNDERS.length + 1, creatures };
}

export const living = (p: Population) => Object.values(p.creatures).filter((c) => c.diedNight === null);

/** Accuracy with a gentle prior, so one lucky answer does not crown a creature. */
export const fitness = (t: Tally) => (t.hits + 1) / (t.hits + t.misses + 2);
export const accuracy = (t: Tally) => (t.hits + t.misses ? t.hits / (t.hits + t.misses) : null);

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
    const hits = cases.filter((x) => x.hit === true).length;
    const misses = cases.filter((x) => x.hit === false).length;
    results[id] = { hits, misses, cases };
    next.creatures[id] = {
      ...c,
      lifetime: { hits: c.lifetime.hits + hits, misses: c.lifetime.misses + misses },
      window: { hits: c.window.hits + hits, misses: c.window.misses + misses },
    };
  }
  return { pop: next, results };
}

/** Who dies and who breeds this generation, or null when selection has too little to go on. */
export function selection(pop: Population): { dies: Creature; parents: [Creature, Creature] } | null {
  const ranked = living(pop)
    .filter((c) => c.window.hits + c.window.misses >= MIN_SCORED)
    .sort((a, b) => fitness(b.window) - fitness(a.window) || b.window.hits - a.window.hits || a.id.localeCompare(b.id));
  if (ranked.length < 3) return null;
  return { dies: ranked.at(-1)!, parents: [ranked[0]!, ranked[1]!] };
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
  const mean = alive.map((c) => accuracy(c.window)).filter((a): a is number => a !== null);
  const record: GenerationRecord = {
    generation: pop.generation,
    night,
    accuracy: mean.length ? mean.reduce((s, a) => s + a, 0) / mean.length : null,
    best: chosen.parents[0].id,
  };
  const [a, b] = chosen.parents;
  const generation = Math.max(a.generation, b.generation) + 1;
  const id = `c${pop.nextId}`;
  const born: Creature = {
    id,
    name: `${a.house} ${roman(generation + 1)}`,
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
    lifetime: { hits: 0, misses: 0 },
    window: { hits: 0, misses: 0 },
  };
  const creatures: Record<string, Creature> = {};
  for (const c of Object.values(pop.creatures)) {
    if (c.id === chosen.dies.id) creatures[c.id] = { ...c, diedNight: night, epitaph };
    else creatures[c.id] = c.diedNight === null ? { ...c, window: { hits: 0, misses: 0 } } : c;
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
      // Only once yesterday's answers are graded, so selection never runs on half a night.
      const graded = Boolean(await ctx.state.get<NightResults>(EVO.results(yesterday))) || !(await ctx.state.get<Exam>(EVO.exam(yesterday)));
      const chosen = since >= generationNights && graded ? selection(pop) : null;
      if (chosen) {
        const [a, b] = chosen.parents;
        let child: { playbook: string; mutation: string | null } = { playbook: interleave(a.playbook, b.playbook), mutation: null };
        try {
          const result = await ctx.think({
            system: BREED_SYSTEM,
            prompt: `Parent A, ${a.name}, right ${a.window.hits} of ${a.window.hits + a.window.misses}. Parent B, ${b.name}, right ${b.window.hits} of ${b.window.hits + b.window.misses}. Their playbooks follow.`,
            untrusted: { parentA: a.playbook, parentB: b.playbook },
            maxTokens: 900,
          });
          child = parseChild(result.text) ?? child;
        } catch (error) {
          await ctx.trace("evo.breed.fallback", { reason: (error as Error).message.slice(0, 200) });
        }
        const d = chosen.dies;
        let epitaph = `My rules were right ${d.window.hits} times and wrong ${d.window.misses}. The nursery keeps the better ones.`;
        try {
          const result = await ctx.think({
            system: EPITAPH_SYSTEM,
            prompt: `You are ${d.name}, ${d.temperament}. Right ${d.window.hits}, wrong ${d.window.misses} this generation. Your playbook follows.`,
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
        note({ night, generation: pop.generation, kind: "death", text: `${d.name} dies after being right ${d.window.hits} of ${d.window.hits + d.window.misses}. "${epitaph}"`, ids: [d.id] });
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
        // Only tokens with a market can be scored tomorrow.
        const scorable = obs.filter((o) => o.market);
        if (scorable.length >= examAfter) {
          exam = { night, tokens: candidates(scorable, new Set(), EXAM_SIZE).map(compact) };
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
            answers[c.id] = parseCalls(result.text, asked, ctx.now);
            await ctx.trace("evo.answered", { id: c.id, name: c.name, calls: answers[c.id]!.map(({ mint, verdict, why }) => ({ mint, verdict, why })) });
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
  const answered = Object.keys((await store.get<Record<string, Call[]>>(EVO.calls(night))) ?? {});
  const since = pop.lastGenerationNight ? nightsBetween(pop.lastGenerationNight, night) : 0;
  return {
    night,
    generation: pop.generation,
    nextGenerationInNights: Math.max(0, generationNights - since),
    creatures: Object.values(pop.creatures).map(({ playbook: _p, ...c }) => ({ ...c, accuracy: accuracy(c.lifetime), fitness: fitness(c.window) })),
    chronicle: ((await store.get<ChronicleEntry[]>(EVO.chronicle)) ?? []).slice(-120).reverse(),
    history: (await store.get<GenerationRecord[]>(EVO.history)) ?? [],
    exam: exam ? { night, tokens: exam.tokens.map((t) => ({ mint: t.mint, symbol: t.symbol })), answered } : null,
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
    accuracy: accuracy(c.lifetime),
    parents: parents.map((p) => ({ id: p.id, name: p.name, house: p.house, playbook: p.playbook })),
    children,
    record,
  };
}
