// The home's scroll story: one real token read in four chapters, driven by one scroll progress value.
// This module has no three.js in it: the page's text and the particle scene both read the same timeline from here.
import snapshot from "./storySnapshot.json";

export type Verdict = "pass" | "caution" | "avoid";
export type Mark = "d" | "g" | "a" | "u";

export interface StoryBuyer {
  wallet: string;
  label?: string;
  afterSec: number | null;
  exitSec: number | null;
  serial: boolean;
}

/** Everything the story shows, read from one X-Ray. Nothing here is made up: a field the X-Ray lacks is left out. */
export interface StoryData {
  mint: string;
  symbol: string;
  venue?: string;
  createdAt: number;
  verdict: Verdict;
  run: number;
  reason?: string;
  dev: string;
  /** Launches and dumps in the last 48 hours, when the node counted them. */
  last48h?: { launches: number; dumped: number };
  medianDumpMin: number | null;
  /** The dev's launches we have on record, oldest to newest: d dumped, g graduated, a alive, u unsettled. */
  timeline: Mark[];
  /** Launches on record in all, when the timeline is only the latest of them. */
  onRecord: number;
  early: StoryBuyer[];
  /** Funders that paid for two or more of the early wallets. */
  shared: Array<{ funder: string; wallets: string[] }>;
  /** Set when this is the bundled snapshot, not a coin read just now: when it was read. */
  exampleAt?: number;
}

/* ---------- the timeline: one progress p in 0..1 over the pinned track ---------- */

// Edges on p: the hero holds, then each chapter morphs in and holds while its own beats play.
const E = { hero: 0.045, c1: 0.1, c1e: 0.25, c2: 0.33, c2e: 0.57, c3: 0.63, c3e: 0.8, c4: 0.86 };
export const CHAPTERS = ["The token", "The dev", "The first seconds", "The verdict"] as const;
/** Where each chapter starts on the rail, for its tick. */
export const CHAPTER_EDGES = [E.hero, E.c1e, E.c2e, E.c3e];

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const smooth = (x: number) => x * x * (3 - 2 * x);

export interface Phase {
  /** The scene's stage: 0 hero eyes, 1 eyes on the address, 2 the dev, 3 the first buyers, 4 the gauge; fractions morph. */
  s: number;
  /** The chapter on screen for the counter, 0 for the hero. */
  ch: number;
  /** How much of each chapter's text is up, 0..1 (index 0 is the hero). */
  vis: [number, number, number, number, number];
  /** Progress inside each chapter's hold, 0..1. */
  local: [number, number, number, number];
}

export function phase(p: number): Phase {
  let s: number;
  if (p < E.hero) s = 0;
  else if (p < E.c1) s = span(p, E.hero, E.c1);
  else if (p < E.c1e) s = 1;
  else if (p < E.c2) s = 1 + span(p, E.c1e, E.c2);
  else if (p < E.c2e) s = 2;
  else if (p < E.c3) s = 2 + span(p, E.c2e, E.c3);
  else if (p < E.c3e) s = 3;
  else if (p < E.c4) s = 3 + span(p, E.c3e, E.c4);
  else s = 4;
  // a chapter's text comes up over the second half of the morph into it and leaves over the first half of the next
  const up = (k: number) => clamp((s - (k - 0.5)) / 0.5);
  const down = (k: number) => (k >= 4 ? 1 : clamp(1 - (s - k) / 0.42));
  const vis: Phase["vis"] = [clamp(1 - s / 0.45), 0, 0, 0, 0];
  for (let k = 1; k <= 4; k++) vis[k] = Math.min(up(k), down(k));
  const local: Phase["local"] = [span(p, E.c1, E.c1e), span(p, E.c2, E.c2e), span(p, E.c3, E.c3e), span(p, E.c4, 0.97)];
  const ch = s < 0.5 ? 0 : Math.min(4, Math.round(s));
  return { s, ch, vis, local };
}

/** The beats inside the chapters, shared by the scene and the text. */
export const beats = (ph: Phase) => ({
  // ch1: the address types itself, the eyes turn to it and the pupils tighten
  type: clamp(ph.local[0] / 0.55),
  look: smooth(clamp((ph.local[0] - 0.15) / 0.45)) * (ph.s < 1.5 ? 1 : 0),
  // ch2: the launches grow along the spiral, then the dumped ones fall
  grow: clamp(ph.local[1] / 0.42),
  fall: clamp((ph.local[1] - 0.42) / 0.5),
  // ch3: lines from each buyer to the coin, then back to their funders
  draw: clamp(ph.local[2] / 0.45),
  draw2: clamp((ph.local[2] - 0.45) / 0.4),
  // ch4: the line bends into the arc, the needle sweeps, the word lands
  bend: smooth(clamp(ph.local[3] / 0.28)),
  needle: ease(clamp((ph.local[3] - 0.24) / 0.36)),
  word: clamp((ph.local[3] - 0.55) / 0.15),
  search: clamp((ph.local[3] - 0.68) / 0.15),
});

/** The odds as a share of the gauge: log scale 0.01% .. 100%, as on the X-Ray. */
export const oddsFrac = (p: number) => clamp((Math.log10(Math.max(p, 0.0001) * 100) + 2) / 4);
export const oddsPct = (p: number) => {
  const v = p * 100;
  return v >= 10 ? String(Math.round(v)) : v >= 0.1 ? v.toFixed(1) : v > 0 ? v.toFixed(2) : "0";
};
export const dumpedCount = (tl: Mark[], upTo = 1) => {
  const n = Math.round(tl.length * upTo);
  let d = 0;
  for (let i = 0; i < n; i++) if (tl[i] === "d") d++;
  return d;
};

/* ---------- reading the story coin ---------- */

interface RawXray {
  mint: string;
  symbol?: string;
  createdAt?: number;
  check?: { checkedAt?: number; verdict?: Verdict; reasons?: string[]; odds?: { run?: number } | null; facts?: { venue?: string } };
  early?: Array<{ wallet: string; afterSec?: number | null; exitSec?: number | null; serial?: boolean; tags?: string[]; smart?: { name?: string } | null }>;
  creatorRecord?: { wallet?: string; launches48h?: number; dumped?: number; medianDumpMin?: number | null; last48h?: { launches: number; dumped: number } | null; timeline?: Mark[] } | null;
  bundle?: { funding?: { groups?: Array<{ funder: string; wallets: string[] }> } | null } | null;
  creator?: string;
}

/** An X-Ray read into the story, or null when it is too thin to tell one honestly. */
export function fromXray(x: RawXray, exampleAt?: number): StoryData | null {
  const c = x.check;
  const cr = x.creatorRecord;
  const run = c?.odds?.run;
  const tl = (cr?.timeline ?? []).filter((m): m is Mark => m === "d" || m === "g" || m === "a" || m === "u");
  const early = (x.early ?? []).slice(0, 8);
  if (!c?.verdict || run == null || !Number.isFinite(run) || tl.length < 20 || early.length < 2 || !x.createdAt) return null;
  const ew = new Set(early.map((e) => e.wallet));
  const shared = (x.bundle?.funding?.groups ?? [])
    .map((g) => ({ funder: g.funder, wallets: g.wallets.filter((w) => ew.has(w)) }))
    .filter((g) => g.wallets.length >= 2);
  return {
    mint: x.mint,
    symbol: x.symbol ?? "",
    venue: c.facts?.venue,
    createdAt: x.createdAt,
    verdict: c.verdict,
    run,
    reason: c.reasons?.[0],
    dev: cr?.wallet ?? x.creator ?? "",
    last48h: cr?.last48h ?? undefined,
    medianDumpMin: cr?.medianDumpMin ?? null,
    timeline: tl,
    onRecord: Math.max(tl.length, cr?.launches48h ?? 0),
    early: early.map((e) => ({ wallet: e.wallet, label: e.smart?.name, afterSec: e.afterSec ?? null, exitSec: e.exitSec ?? null, serial: !!(e.serial || e.tags?.includes("serial")) })),
    shared,
    exampleAt,
  };
}

/** A real X-Ray saved from the live node, shown with its date when the live read fails. */
export const SNAPSHOT: StoryData = fromXray(snapshot as unknown as RawXray, (snapshot as { check: { checkedAt: number } }).check.checkedAt)!;

const get = (url: string, ms = 9000) => {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal })
    .then((r) => (r.ok ? r.json() : null))
    .finally(() => clearTimeout(id));
};

/**
 * The story coin, read live: the busiest devs right now, one of their coins past its first five minutes (so it has
 * its odds) with at least two early wallets, then its full X-Ray. Null when nothing fits.
 */
export async function pickLive(north: string): Promise<StoryData | null> {
  const body = await get(`${north}/v1/chain/ruggers?limit=4`);
  const devs: Array<{ recent?: Array<{ mint: string; createdAt: number }> }> = body?.ruggers ?? [];
  const now = Date.now();
  const mints = devs.flatMap((d) => (d.recent ?? []).filter((c) => now - c.createdAt > 6 * 60_000).map((c) => c.mint)).slice(0, 10);
  for (let i = 0; i < mints.length; i += 5) {
    const checks = await Promise.all(mints.slice(i, i + 5).map((m) => get(`${north}/v1/check/${m}`).catch(() => null)));
    for (const ck of checks) {
      if (!ck?.odds || !Number.isFinite(ck.odds.run) || (ck.facts?.earlyWallets ?? 0) < 2) continue;
      const x = await get(`${north}/v1/xray/${ck.mint}`, 15000).catch(() => null);
      const s = x && fromXray(x);
      if (s) return s;
    }
  }
  return null;
}
