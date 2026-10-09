import { cleanText } from "../guests.ts";
import type { GuestReport, Observation } from "./nightWatch.ts";

/**
 * How the pack judges and learns.
 *
 * The beaver makes calls on the night's tokens: a verdict, a confidence and
 * a reason. The next morning the hedgehog re-checks those tokens on
 * DexScreener; each call is scored against what actually happened. The
 * scorecard then goes back to the model, which rewrites the beaver's
 * playbook: the rules it judges by. Every version is on the public log.
 */

export const VERDICTS = ["promising", "watch", "suspicious"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Call {
  mint: string;
  symbol: string;
  verdict: Verdict;
  /** 0..1 */
  confidence: number;
  why: string;
  /** "model" when the beaver thought it through, "rules" when no model was at hand. */
  by: "model" | "rules";
  at: number;
}

export type Outcome = "dead" | "alive" | "unknown";

export interface Case {
  mint: string;
  symbol: string;
  verdict: Verdict;
  why: string;
  outcome: Outcome;
  /** null when the call cannot be scored: a "watch", or no market to judge by. */
  hit: boolean | null;
}

export interface Scorecard {
  night: string;
  checked: number;
  hits: number;
  misses: number;
  /** hits / (hits + misses), or null when nothing could be scored. */
  accuracy: number | null;
  cases: Case[];
  /** The same scoring applied to every guest's verdicts. */
  guests: Record<string, { hits: number; misses: number }>;
}

export interface Playbook {
  version: number;
  text: string;
  night: string | null;
  accuracy: number | null;
  updatedAt: number;
}

export const DEFAULT_PLAYBOOK: Playbook = {
  version: 0,
  night: null,
  accuracy: null,
  updatedAt: 0,
  text: [
    "1. No socials plus sells outnumbering buys 3:1 is the strongest rug signal I have.",
    "2. Volume far above liquidity usually means wash trading; lean suspicious.",
    "3. A token that graduated from the bonding curve with steady buys deserves a watch, not a promise.",
    "4. Paid DexScreener promotion alone proves nothing either way.",
    "5. Say watch when the data is thin. Confidence above 0.8 only with two independent signals.",
  ].join("\n"),
};

/** What happened to a token, judged from a fresh market read a day later. */
export function outcomeOf(o: Observation | undefined): Outcome {
  const m = o?.market;
  if (!m) return "unknown";
  if ((m.priceChange24h ?? 0) <= -80 || (m.liquidityUsd !== null && m.liquidityUsd < 100)) return "dead";
  if ((m.liquidityUsd ?? 0) >= 1000) return "alive";
  return "unknown";
}

export function scoreCall(verdict: Verdict, outcome: Outcome): boolean | null {
  if (verdict === "watch" || outcome === "unknown") return null;
  return verdict === "suspicious" ? outcome === "dead" : outcome === "alive";
}

/** Scores a night's calls and guest reports against the follow-up observations. */
export function scoreNight(night: string, calls: Call[], reports: GuestReport[], followups: Observation[]): Scorecard {
  const now = new Map(followups.map((o) => [o.mint, o]));
  const cases: Case[] = calls.map((c) => {
    const outcome = outcomeOf(now.get(c.mint));
    return { mint: c.mint, symbol: c.symbol, verdict: c.verdict, why: c.why, outcome, hit: scoreCall(c.verdict, outcome) };
  });
  const hits = cases.filter((c) => c.hit === true).length;
  const misses = cases.filter((c) => c.hit === false).length;
  const guests: Scorecard["guests"] = {};
  for (const r of reports) {
    const g = (guests[r.guest] = { hits: 0, misses: 0 });
    for (const i of r.items) {
      const hit = scoreCall(i.verdict, outcomeOf(now.get(i.mint)));
      if (hit === true) g.hits += 1;
      if (hit === false) g.misses += 1;
    }
  }
  return { night, checked: followups.length, hits, misses, accuracy: hits + misses ? hits / (hits + misses) : null, cases, guests };
}

/** The tokens worth a re-check tomorrow: every scored call and guest verdict, at most `max`. */
export function followupMints(calls: Call[], reports: GuestReport[], max = 30): string[] {
  const mints = [
    ...calls.filter((c) => c.verdict !== "watch").map((c) => c.mint),
    ...reports.flatMap((r) => r.items.filter((i) => i.verdict !== "watch").map((i) => i.mint)),
  ];
  return [...new Set(mints)].slice(0, max);
}

/** Rule flags, the beaver's fallback when it has no model, and a hint when it does. */
export function ruleFlags(o: Observation): string[] {
  const usd = (n: number | null | undefined) => n ?? 0;
  const m = o.market;
  const reasons: string[] = [];
  if (o.hasSocials === false) reasons.push("no socials");
  if (m && m.sells24h > 0 && m.sells24h > m.buys24h * 3) reasons.push("sells outnumber buys 3:1");
  if (m && usd(m.liquidityUsd) > 0 && usd(m.volume24hUsd) > usd(m.liquidityUsd) * 50) reasons.push("volume 50x liquidity");
  return reasons;
}

/** Up to `max` tokens the beaver has not judged yet, the most telling first. */
export function candidates(obs: Observation[], judged: Set<string>, max = 15): Observation[] {
  const fresh = obs.filter((o) => !judged.has(o.mint) && o.source !== "followup");
  const weight = (o: Observation) => ruleFlags(o).length * 10 + (o.complete ? 5 : 0) + Math.log10(1 + (o.market?.volume24hUsd ?? 0));
  return fresh.sort((a, b) => weight(b) - weight(a)).slice(0, max);
}

export function ruleCalls(items: Observation[], now: number): Call[] {
  return items.flatMap((o) => {
    const flags = ruleFlags(o);
    if (flags.length < 2) return [];
    return [{ mint: o.mint, symbol: o.symbol, verdict: "suspicious" as const, confidence: 0.5, why: flags.join(", "), by: "rules" as const, at: now }];
  });
}

export function judgeSystem(playbook: Playbook): string {
  return [
    "You are the beaver, a builder in ZOOAI AGENCY. Each night you judge new Solana tokens from market data alone.",
    "You judge by your playbook below. You wrote it yourself from your track record, and you will rewrite it tomorrow when your calls are checked against what happened.",
    "",
    `Playbook v${playbook.version}:`,
    playbook.text,
    "",
    "For every token decide: promising (likely still alive with real liquidity tomorrow), suspicious (likely dead or rugged by tomorrow), or watch (not enough evidence).",
    'Answer with a JSON array only, one object per token: {"mint": string, "verdict": "promising"|"watch"|"suspicious", "confidence": number 0..1, "why": string up to 140 chars}.',
    "Facts and numbers, no hype, no investment advice.",
  ].join("\n");
}

export function compact(o: Observation) {
  const m = o.market;
  return {
    mint: o.mint,
    symbol: o.symbol,
    name: o.name,
    source: o.source,
    graduated: o.complete,
    hasSocials: o.hasSocials,
    marketCapUsd: o.marketCapUsd,
    market: m ? { liq: m.liquidityUsd, vol24h: m.volume24hUsd, change24h: m.priceChange24h, buys24h: m.buys24h, sells24h: m.sells24h, dex: m.dex } : null,
    flags: ruleFlags(o),
  };
}

/** Parses the model's verdicts, keeping only well-formed calls on tokens it was asked about. */
export function parseCalls(text: string, asked: Observation[], now: number): Call[] {
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
  const calls: Call[] = [];
  for (const item of raw) {
    const x = item as Partial<Call>;
    if (typeof x?.mint !== "string" || !bySymbol.has(x.mint) || !VERDICTS.includes(x.verdict as Verdict)) continue;
    if (calls.some((c) => c.mint === x.mint)) continue;
    const confidence = typeof x.confidence === "number" && Number.isFinite(x.confidence) ? Math.min(1, Math.max(0, x.confidence)) : 0.5;
    calls.push({ mint: x.mint, symbol: bySymbol.get(x.mint)!, verdict: x.verdict as Verdict, confidence, why: cleanText(String(x.why ?? ""), 160), by: "model", at: now });
  }
  return calls;
}

export const REFLECT_SYSTEM = [
  "You are the beaver, a builder in ZOOAI AGENCY. Yesterday you judged Solana tokens; this morning they were checked against what actually happened.",
  "Rewrite your playbook so tomorrow's calls are better: keep rules that produced hits, change or drop rules behind misses, add at most two new rules grounded in the cases.",
  "Numbered rules, at most 8, at most 1200 characters in total. Plain text, no markdown headings. Output only the playbook.",
].join("\n");

/** Keeps a model-written playbook plain: no control characters or markup, bounded length. */
export function cleanPlaybook(text: string): string {
  return text
    // Comparisons carry the meaning of a rule; spell them out instead of letting the sanitizer drop them.
    .replace(/>=|≥/g, " at least ")
    .replace(/<=|≤/g, " at most ")
    .replace(/>/g, " above ")
    .replace(/</g, " below ")
    .split("\n")
    .map((line) => cleanText(line, 300))
    .filter(Boolean)
    .slice(0, 10)
    .join("\n")
    .slice(0, 1500);
}

/** The night before `night` (night ids are dates). */
export function previousNight(night: string): string {
  return new Date(Date.parse(`${night}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
