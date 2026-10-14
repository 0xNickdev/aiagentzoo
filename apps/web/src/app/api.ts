import { NODE_URLS } from "../sim/live";

/** The two nodes the app talks to: north reads the chain, canyon keeps the beaver, the nursery and the board. */
export const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
export const CANYON = NODE_URLS.find((u) => u.includes("canyon")) ?? NODE_URLS[NODE_URLS.length - 1] ?? "";

export type Verdict = "promising" | "watch" | "suspicious";

export interface CreatorRecord {
  wallet: string;
  launches24h: number;
  launches48h: number;
  dumped: number;
  medianDumpMin: number | null;
  graduated: number;
  recent: Array<{ mint: string; symbol: string; createdAt: number; dumpedAfterMin: number | null; graduated: boolean }>;
}

export interface Ask {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  at: number;
  verdict: Verdict;
  confidence: number;
  why: string;
  by: "model" | "rules";
  playbookVersion: number;
  already: boolean;
  facts: {
    graduated: boolean;
    hasSocials: boolean | null;
    market: { liquidityUsd: number | null; volume24hUsd: number | null; priceChange24h: number | null; buys24h: number; sells24h: number } | null;
    chain: { creatorSold: number | null; creatorLaunches24h: number; top5Share: number | null; buyers: number; repeatBuyers: number; ageMin: number } | null;
    creator?: CreatorRecord | null;
    bundle?: { wallets: number; share: number; linked: number; funder: string | null } | null;
    url: string | null;
  };
  graded?: { outcome: "dead" | "alive" | "unknown"; hit: boolean | null };
}

export interface Moment {
  seq: number;
  at: number;
  kind: "launch" | "serial" | "dump" | "graduated" | "whale";
  mint: string;
  symbol: string;
  text: string;
  tx?: string;
}

export interface CleanLaunch {
  mint: string;
  symbol: string;
  name: string;
  ageMin: number;
  buyers: number;
  repeatBuyers: number;
  top5Share: number | null;
}

export interface Creature {
  id: string;
  name: string;
  house: string;
  temperament: string;
  diedNight: string | null;
  lifetimeSkill: number | null;
  graded: number;
  starving: boolean;
}

export interface Evolution {
  generation: number;
  nextGenerationInNights: number;
  creatures: Creature[];
  chronicle: Array<{ kind: string; text: string }>;
}

export interface BoardRow {
  id: string;
  name: string;
  kind: "resident" | "guest" | "nursery";
  score: number;
  graded: number;
  ranked: boolean;
  died?: string | null;
}

export async function get<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function ask(mint: string): Promise<{ ask?: Ask; dev?: CreatorRecord; error?: string }> {
  try {
    const r = await fetch(`${CANYON}/v1/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mint }) });
    const body = (await r.json()) as { ask?: Ask; error?: string };
    if (r.ok && body.ask) return { ask: body.ask };
    if (r.status === 404) {
      const dev = await get<CreatorRecord>(`${NORTH}/v1/chain/creator/${mint}`);
      if (dev) return { dev };
    }
    return { error: body.error ?? "Something went wrong." };
  } catch {
    return { error: "The beaver's node did not answer. Try again in a minute." };
  }
}

/** Subscribes this Telegram user to alerts on a token, proven by the signed initData. */
export async function watch(initData: string, mint: string): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch(`${CANYON}/v1/tg/watch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData, mint }) });
    const body = (await r.json()) as { ok?: boolean; error?: string };
    return r.ok ? { ok: true, message: "Watching. Alerts arrive in the bot chat." } : { ok: false, message: body.error ?? "Could not watch this token." };
  } catch {
    return { ok: false, message: "The node did not answer." };
  }
}

export const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);
export const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;
export const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
export const mintIn = (text: string) => text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;
