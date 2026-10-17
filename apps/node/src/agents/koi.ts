import { defineAgent, defineSpecies, type AgentDefinition, type StateStore } from "@aiagentzoo/sdk";
import type { CleanLaunch } from "../chain/pump.ts";
import { cleanText } from "../guests.ts";
import { ZH_SYSTEM } from "../translate.ts";
import { previousNight } from "./judgement.ts";
import type { Followup } from "./evolution.ts";
import { nightOf } from "./nightWatch.ts";

/**
 * 锦鲤, the koi: the zoo's hunter of survivors. The beaver is good at spotting what dies and bad at spotting what
 * lives; the koi does only the second thing. A few times a night it picks, from the launches the beaver is watching,
 * the rare ones that look like they will still be alive tomorrow, and the next night it is graded on them in public.
 * It never calls anything suspicious, so it is measured against the market's own survival rate, not on the
 * balanced scale built for agents that call both ways.
 */

/**
 * A fifth species for it: the seeker reads the chain and thinks, and that is all. It cannot fetch the open web,
 * signal another agent or publish, so a fooled koi can at worst make a bad pick, which then gets graded.
 */
export const seeker = defineSpecies({
  id: "seeker",
  name: "Seeker",
  description: "Reads the chain and looks for the rare thing worth finding.",
  capabilities: ["sources:read", "state:read", "state:write", "model:think"],
});

export const KOI = {
  calls: (night: string) => `koi:calls:${night}`,
  score: (night: string) => `koi:score:${night}`,
  tally: "koi:tally",
  look: "koi:look",
};
/** Picks a night, at most: a koi that says yes often is not a koi. */
export const KOI_PER_NIGHT = 8;
const KOI_PER_WAKE = 2;

export interface KoiPick {
  mint: string;
  symbol: string;
  why: string;
  whyZh?: string;
  at: number;
}

export interface KoiScore {
  night: string;
  alive: number;
  dead: number;
  unknown: number;
  cases: Array<{ mint: string; symbol: string; outcome: "dead" | "alive" | "unknown" }>;
}

export interface KoiTally {
  picks: number;
  graded: number;
  alive: number;
  dead: number;
  nights: number;
}

/** Of the launches that already passed the basic checks, the ones with the most life: many buyers, many coming back. */
export function koiCandidates(clean: CleanLaunch[], picked: Set<string>, max = 10): CleanLaunch[] {
  return clean
    .filter((c) => !picked.has(c.mint) && c.ageMin >= 20 && c.buyers >= 20 && c.repeatBuyers >= 3 && (c.graduated || (c.curveSol ?? 0) >= 5))
    .sort((a, b) => b.buyers * (1 + b.repeatBuyers) - a.buyers * (1 + a.repeatBuyers))
    .slice(0, max);
}

export const KOI_SYSTEM = [
  "You are the koi (锦鲤) of ZOOAI AGENCY, the hunter of survivors.",
  "On pump.fun almost every token is dead within a day: about 1 in 270 is still alive. Your only job is to find those few.",
  "You get a short list of fresh launches that already passed basic on-chain checks. Pick at most 2 that are most likely to still have real buyers and a rising curve tomorrow, or none if none convince you.",
  "Judge from the facts given: many distinct buyers, buyers coming back, a creator who has not sold, no single group holding the supply, a curve that keeps filling.",
  'Answer with a JSON array only: [{"mint": string, "why": string up to 140 chars, plain words for a trader}]. An empty array is a fine answer.',
  "No hype, no price targets, no investment advice.",
].join("\n");

export function parseKoi(text: string, asked: CleanLaunch[], now: number): KoiPick[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const bySymbol = new Map(asked.map((o) => [o.mint, o.symbol]));
  const out: KoiPick[] = [];
  for (const x of raw as Array<{ mint?: unknown; why?: unknown }>) {
    const mint = String(x?.mint ?? "");
    if (!bySymbol.has(mint) || out.some((p) => p.mint === mint)) continue;
    out.push({ mint, symbol: bySymbol.get(mint)!, why: cleanText(String(x.why ?? ""), 160), at: now });
    if (out.length >= KOI_PER_WAKE) break;
  }
  return out;
}

const compactKoi = (c: CleanLaunch) => ({
  mint: c.mint,
  symbol: c.symbol,
  name: c.name,
  ageMin: c.ageMin,
  buyers: c.buyersMore ? `${c.buyers}+` : c.buyers,
  repeatBuyers: c.repeatBuyers,
  top5Share: c.top5Share,
  creatorSold: c.creatorSold,
  curveSol: c.curveSol,
  graduated: c.graduated,
});

/** How a night of picks turned out, from the beaver's re-check of the same tokens. */
export function scoreKoi(night: string, picks: KoiPick[], followup: Followup): KoiScore {
  const cases = picks.map((p) => ({ mint: p.mint, symbol: p.symbol, outcome: followup[p.mint]?.outcome ?? "unknown" }));
  return {
    night,
    alive: cases.filter((c) => c.outcome === "alive").length,
    dead: cases.filter((c) => c.outcome === "dead").length,
    unknown: cases.filter((c) => c.outcome === "unknown").length,
    cases,
  };
}

export function koiAgent(cfg: { briefAt: string; everyMs?: number }): AgentDefinition {
  return defineAgent({
    name: "koi",
    species: seeker,
    schedule: { every: cfg.everyMs ?? 60 * 60_000 },
    budget: { steps: 12, modelTokens: 12_000 },
    async onWake(ctx) {
      const night = nightOf(ctx.now, cfg.briefAt);
      const yesterday = previousNight(night);

      // Last night's picks, graded as soon as the beaver's re-check of them is in.
      if (!(await ctx.state.get<KoiScore>(KOI.score(yesterday)))) {
        const followup = await ctx.state.get<Followup>(`followup:${yesterday}`);
        const past = (await ctx.state.get<KoiPick[]>(KOI.calls(yesterday))) ?? [];
        if (followup && past.length) {
          const score = scoreKoi(yesterday, past, followup);
          await ctx.state.set(KOI.score(yesterday), score);
          const t = (await ctx.state.get<KoiTally>(KOI.tally)) ?? { picks: 0, graded: 0, alive: 0, dead: 0, nights: 0 };
          await ctx.state.set(KOI.tally, { picks: t.picks + past.length, graded: t.graded + score.alive + score.dead, alive: t.alive + score.alive, dead: t.dead + score.dead, nights: t.nights + 1 });
          await ctx.trace("koi.scored", { night: yesterday, alive: score.alive, dead: score.dead, unknown: score.unknown });
        }
      }

      const picks = (await ctx.state.get<KoiPick[]>(KOI.calls(night))) ?? [];
      if (picks.length >= KOI_PER_NIGHT) return;
      let clean: CleanLaunch[];
      try {
        clean = await ctx.use<CleanLaunch[]>("chain.clean", { limit: 50 });
      } catch {
        // The stream is out of reach this hour; the next wake tries again.
        return;
      }
      const asked = koiCandidates(clean, new Set(picks.map((p) => p.mint)));
      // When it last looked and at how many, so an empty night reads as "looked, nothing convinced it", not as silence.
      await ctx.state.set(KOI.look, { at: ctx.now, candidates: asked.length });
      // Nothing worth a look: leave no output, so a quiet hour is never mistaken for a loop.
      if (!asked.length) return;
      let fresh: KoiPick[] = [];
      try {
        const r = await ctx.think({ system: KOI_SYSTEM, prompt: `Here are ${asked.length} fresh launches. Pick at most ${KOI_PER_WAKE}.`, untrusted: asked.map(compactKoi), maxTokens: 600 });
        fresh = parseKoi(r.text, asked, ctx.now).slice(0, KOI_PER_NIGHT - picks.length);
      } catch (error) {
        // No model, no picks: the koi does not guess by rules.
        await ctx.trace("koi.skipped", { reason: (error as Error).message.slice(0, 200) });
        return;
      }
      if (!fresh.length) return;
      // Its reasons in Chinese too: the koi is the Chinese community's agent first.
      for (const p of fresh) {
        try {
          const zh = await ctx.think({ system: ZH_SYSTEM, prompt: "Translate.", untrusted: p.why, maxTokens: 200 });
          const text = zh.text.replace(/[–—]/g, "-").trim();
          if (/[一-鿿]/.test(text)) p.whyZh = text.slice(0, 300);
        } catch {
          // English only for this one.
        }
      }
      await ctx.state.set(KOI.calls(night), [...picks, ...fresh]);
      await ctx.trace("koi.picked", { night, picks: fresh.map(({ mint, symbol, why }) => ({ mint, symbol, why })) });
    },
  });
}

/** The koi's record and tonight's picks, for the site and the bot. */
export async function koiView(store: StateStore, briefAt: string, now = Date.now()) {
  const night = nightOf(now, briefAt);
  const tonight = (await store.get<KoiPick[]>(KOI.calls(night))) ?? [];
  const tally = (await store.get<KoiTally>(KOI.tally)) ?? { picks: 0, graded: 0, alive: 0, dead: 0, nights: 0 };
  const nights: Array<{ night: string; picks: KoiPick[]; score: KoiScore | null }> = [];
  let n = night;
  for (let i = 0; i < 7; i++) {
    n = previousNight(n);
    const picks = (await store.get<KoiPick[]>(KOI.calls(n))) ?? [];
    if (!picks.length) continue;
    nights.push({ night: n, picks, score: (await store.get<KoiScore>(KOI.score(n))) ?? null });
  }
  const lastLook = (await store.get<{ at: number; candidates: number }>(KOI.look)) ?? null;
  return { night, tonight, tally, nights, perNight: KOI_PER_NIGHT, lastLook };
}
