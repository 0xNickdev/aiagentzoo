import { type Address, type AgentDefinition, defineAgent, type SignalValidator, species, type StateStore } from "@aiagentzoo/sdk";
import { cleanText, GUEST_PREFIX, type Guest, isGuestNode } from "../guests.ts";
import type { Launch, Market } from "../sources.ts";
import type { ChainFacts } from "../chain/pump.ts";
import { outcomeOf, previousNight, type Scorecard, VERDICTS } from "./judgement.ts";
import { CONTEST, type Exam, setExam } from "../contest/exam.ts";
import { FOLLOWUP_MAX, followupMints, regrade } from "../contest/regrade.ts";

/**
 * The Night Watch: the agents that feed the two contests, with no model anywhere.
 *
 *   north   Northern Edge   raven (sentinel) reads fresh launches -> hedgehog (gatherer) adds DexScreener and chain facts
 *   canyon  Stone Canyon    beaver (builder) keeps the night's tokens and the guests' reports, sets the night's exam
 *                           (contest/exam.ts) and, the next day, sends the tokens back to the hedgehog and grades them
 *                           (contest/regrade.ts)
 *
 * The marsh node (owl, otter) fed DexScreener's promoted tokens to the Morning Brief; both are gone, so it runs no agents.
 */

export type Role = "north" | "marsh" | "canyon";

export interface NightWatchConfig {
  role: Role;
  /** Node ids of the three enclosures. */
  nodes: Record<Role, string>;
  /** "HH:MM" UTC when one night ends and the next begins. */
  briefAt: string;
  /** Scan cadence for sentinels. */
  scanEveryMs: number;
  /** Most tokens the beaver keeps per night. Default 4000. */
  obsCap?: number;
  /** Scorable tokens seen before the night's exam is set. Default 40. */
  examAfter?: number;
}

export interface Observation {
  mint: string;
  symbol: string;
  name: string;
  source: "pump" | "dex-profile" | "followup";
  createdAt: number | null;
  creator: string | null;
  hasSocials: boolean | null;
  complete: boolean;
  marketCapUsd: number | null;
  market: Omit<Market, "mint" | "symbol" | "name"> | null;
  seenAt: number;
  scout: string;
  /** Guardian wallets that asked the zoo to watch this token. */
  watchedBy?: string[];
  /** The on-chain trading picture, when the north node streams pump.fun. */
  chain?: ChainFacts;
}

/** One token a guest agent reported, with its verdict and a short note. */
export interface GuestItem {
  mint: string;
  verdict: (typeof VERDICTS)[number];
  note: string;
  /** The zoo had already seen this token dead when the report arrived. */
  already?: boolean;
}

/** What a guest reported over one night. */
export interface GuestReport {
  guest: string;
  species: string;
  platform?: string;
  token: string | null;
  items: GuestItem[];
  at: number;
}

const MAX_GUEST_ITEMS = 30;
const MAX_GUESTS_PER_NIGHT = 50;

/** Guardian watchlists live in the north enclosure's state under this prefix. */
export const WATCH_PREFIX = "watch:";
export const WATCH_EVERY_MS = 60 * 60_000;

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_BATCH = 30;

const listOf =
  (field: string, check: (item: unknown) => boolean): SignalValidator =>
  (payload) => {
    const items = (payload as Record<string, unknown> | null)?.[field];
    if (!Array.isArray(items)) return `${field} must be an array`;
    if (items.length === 0 || items.length > MAX_BATCH) return `${field} must hold 1-${MAX_BATCH} items`;
    return items.every(check) ? true : `${field} contains a malformed item`;
  };

const isMint = (m: unknown) => typeof m === "string" && MINT.test(m);
const isLaunch = (l: unknown) => {
  const x = l as Partial<Launch>;
  return isMint(x?.mint) && typeof x.symbol === "string" && x.symbol.length <= 32 && typeof x.name === "string" && x.name.length <= 64;
};
const isObservation = (o: unknown) => {
  const x = o as Partial<Observation>;
  return isMint(x?.mint) && typeof x.symbol === "string" && x.symbol.length <= 32 && typeof x.seenAt === "number";
};

const isGuestReport: SignalValidator = (payload, event) => {
  if (!isGuestNode(event.from.node)) return "guest reports come from guest enclosures";
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_GUEST_ITEMS) return `items must hold 1-${MAX_GUEST_ITEMS} tokens`;
  const ok = items.every((i) => {
    const x = i as Partial<GuestItem>;
    return isMint(x?.mint) && VERDICTS.includes(x.verdict as GuestItem["verdict"]) && (x.note === undefined || (typeof x.note === "string" && x.note.length <= 280));
  });
  return ok ? true : `each item needs a mint, a verdict (${VERDICTS.join(", ")}) and an optional note up to 280 chars`;
};

export interface GuestNight {
  night: string;
  items: Array<GuestItem & { symbol: string | null; outcome: string | null; hit: boolean | null }>;
}

/** A guest's reports over the last `nights` nights, newest first, each with its next-day result once it is in. */
export async function guestRecord(store: StateStore, guest: string, nights = 7): Promise<GuestNight[]> {
  const keys = (await store.keys("reports:")).sort().reverse().slice(0, nights);
  const out: GuestNight[] = [];
  for (const key of keys) {
    const night = key.slice("reports:".length);
    const report = (await store.get<Record<string, GuestReport>>(key))?.[guest];
    if (!report) continue;
    const scored = new Map(((await store.get<Scorecard>(`score:${night}`))?.guestCases?.[guest] ?? []).map((c) => [c.mint, c]));
    out.push({
      night,
      items: [...report.items].reverse().map((i) => {
        const c = scored.get(i.mint);
        return { ...i, symbol: c && c.symbol !== "?" ? c.symbol : null, outcome: c?.outcome ?? null, hit: c?.hit ?? null };
      }),
    });
  }
  return out;
}

/** The id of the night a timestamp belongs to: the date the night ends on, at briefAt. */
export function nightOf(ts: number, briefAt: string): string {
  const [h, m] = briefAt.split(":").map(Number) as [number, number];
  const cutoff = (h * 60 + m) * 60_000;
  const day = 86_400_000;
  const dayStart = Math.floor(ts / day) * day;
  const morning = ts - dayStart < cutoff ? dayStart : dayStart + day;
  return new Date(morning).toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function gatherer(name: string, cfg: NightWatchConfig): AgentDefinition {
  const beaver: Address = { node: cfg.nodes.canyon, agent: "beaver" };
  return defineAgent({
    name,
    species: species.gatherer,
    budget: { steps: 20, signals: 4 },
    accepts: {
      "launches.found": listOf("launches", isLaunch),
      "followup.check": listOf("mints", isMint),
      "watch.check": (payload) => {
        const owners = (payload as { owners?: unknown } | null)?.owners;
        if (!owners || typeof owners !== "object") return "owners must be an object";
        const entries = Object.entries(owners as Record<string, unknown>);
        if (entries.length === 0 || entries.length > MAX_BATCH) return `1-${MAX_BATCH} watched tokens`;
        return entries.every(([m, o]) => isMint(m) && Array.isArray(o) && o.length <= 50 && o.every((a) => typeof a === "string" && MINT.test(a)))
          ? true
          : "malformed watch list";
      },
    },
    async onWake(ctx) {
      if (ctx.reason.type !== "signal") {
        await ctx.trace("patrol", { note: "no trail to follow" });
        return;
      }
      const event = ctx.reason.event;
      let launches: Launch[];
      let source: Observation["source"];
      let watchedBy: Record<string, string[]> = {};
      if (event.type === "launches.found") {
        launches = (event.payload as { launches: Launch[] }).launches;
        source = "pump";
      } else if (event.type === "watch.check") {
        watchedBy = (event.payload as { owners: Record<string, string[]> }).owners;
        launches = Object.keys(watchedBy).map((mint) => ({ mint, name: "", symbol: "?", createdAt: 0, creator: "", marketCapUsd: null, complete: false, hasSocials: true }));
        source = "dex-profile";
      } else {
        const mints = (event.payload as { mints: string[] }).mints;
        launches = mints.map((mint) => ({ mint, name: "", symbol: "?", createdAt: 0, creator: "", marketCapUsd: null, complete: false, hasSocials: true }));
        source = event.type === "followup.check" ? "followup" : "dex-profile";
      }

      const markets = await ctx.use<Market[]>("dex.markets", { mints: launches.map((l) => l.mint) });
      const byMint = new Map(markets.map((m) => [m.mint, m]));
      // Fresh chain facts where this node streams pump.fun; otherwise whatever the sentinel attached.
      let chain: Record<string, ChainFacts> = {};
      try {
        chain = await ctx.use<Record<string, ChainFacts>>("chain.facts", { mints: launches.map((l) => l.mint), social: Object.fromEntries(launches.map((l) => [l.mint, l.hasSocials])) });
      } catch {
        // No stream here, or the tool is unavailable: the launches keep their own snapshot.
      }
      const observations: Observation[] = launches.map((l) => {
        const market = byMint.get(l.mint);
        return {
          mint: l.mint,
          symbol: (l.symbol && l.symbol !== "?" ? l.symbol : market?.symbol || "?").slice(0, 32),
          name: (l.name || market?.name || "").slice(0, 64),
          source,
          createdAt: l.createdAt || null,
          creator: l.creator || null,
          hasSocials: source === "pump" ? l.hasSocials : null,
          complete: l.complete,
          marketCapUsd: l.marketCapUsd,
          market: market ? (({ mint: _m, symbol: _s, name: _n, ...rest }) => rest)(market) : null,
          seenAt: ctx.now,
          scout: event.from.agent,
          ...(watchedBy[l.mint] ? { watchedBy: watchedBy[l.mint] } : {}),
          ...(chain[l.mint] ?? l.chain ? { chain: chain[l.mint] ?? l.chain } : {}),
        };
      });
      await ctx.trace("gathered", { count: observations.length, withMarket: markets.length, from: event.from.agent });
      for (const batch of chunk(observations, MAX_BATCH)) {
        await ctx.signal(beaver, "observations", { items: batch });
      }
    },
  });
}

function northAgents(cfg: NightWatchConfig): AgentDefinition[] {
  const raven = defineAgent({
    name: "raven",
    species: species.sentinel,
    schedule: { every: cfg.scanEveryMs },
    budget: { steps: 10, signals: 3 },
    async onWake(ctx) {
      // Once an hour, hand the guardians' watched tokens to the hedgehog.
      const lastWatch = (await ctx.state.get<number>("raven:watchAt")) ?? 0;
      if (ctx.now - lastWatch >= WATCH_EVERY_MS) {
        const owners: Record<string, string[]> = {};
        for (const key of await ctx.state.keys(WATCH_PREFIX)) {
          const owner = key.slice(WATCH_PREFIX.length);
          for (const mint of (await ctx.state.get<string[]>(key)) ?? []) (owners[mint] ??= []).push(owner);
        }
        await ctx.state.set("raven:watchAt", ctx.now);
        const mints = Object.keys(owners).slice(0, MAX_BATCH);
        if (mints.length) await ctx.signal("hedgehog", "watch.check", { owners: Object.fromEntries(mints.map((m) => [m, owners[m]!])) });
      }

      const cursor = (await ctx.state.get<number>("raven:cursor")) ?? ctx.now - cfg.scanEveryMs;
      const latest = await ctx.use<Launch[]>("pump.latest", { limit: 50 });
      const fresh = latest.filter((l) => l.createdAt > cursor).slice(0, MAX_BATCH);
      if (fresh.length === 0) {
        // Nothing new: leave no output, so quiet scans are not mistaken for a loop.
        return;
      }
      await ctx.state.set("raven:cursor", Math.max(...fresh.map((l) => l.createdAt)));
      await ctx.signal("hedgehog", "launches.found", { launches: fresh });
    },
  });
  return [raven, gatherer("hedgehog", cfg)];
}

function canyonAgents(cfg: NightWatchConfig): AgentDefinition[] {
  const hedgehog: Address = { node: cfg.nodes.north, agent: "hedgehog" };

  const beaver = defineAgent({
    name: "beaver",
    species: species.builder,
    // One signal per batch of 30 re-checks: with a single signal the night's re-checks stopped after the first batch.
    budget: { steps: 24, signals: Math.ceil(FOLLOWUP_MAX / 30) },
    accepts: { observations: listOf("items", isObservation), "guest.report": isGuestReport },
    async onWake(ctx) {
      if (ctx.reason.type !== "signal") return;
      const event = ctx.reason.event;
      const night = nightOf(ctx.now, cfg.briefAt);
      const yesterday = previousNight(night);
      const obsKey = `obs:${night}`;
      const reportsKey = `reports:${night}`;

      const items = event.type === "observations" ? (event.payload as { items: Observation[] }).items : [];
      if (items.length && items.every((o) => o.source === "followup")) {
        // The hedgehog is back with yesterday's tokens: grade the guests, the holders and the odds model on them.
        const score = await regrade(ctx.state, yesterday, items);
        await ctx.trace("calls.scored", { night: yesterday, checked: score.checked, guests: score.guests, odds: score.odds ? { dead: score.odds.dead, deadRight: score.odds.deadRight, alive: score.odds.alive, aliveRight: score.odds.aliveRight, skill: score.odds.skill } : null });
      } else if (event.type === "guest.report") {
        const name = event.from.agent;
        const guest = await ctx.state.get<Guest>(`${GUEST_PREFIX}${name}`);
        const reports = (await ctx.state.get<Record<string, GuestReport>>(reportsKey)) ?? {};
        if (!guest || (!reports[name] && Object.keys(reports).length >= MAX_GUESTS_PER_NIGHT)) return;
        const store = (await ctx.state.get<Record<string, Observation>>(obsKey)) ?? {};
        const byMint = new Map((reports[name]?.items ?? []).map((i) => [i.mint, i]));
        for (const item of (event.payload as { items: GuestItem[] }).items) {
          byMint.delete(item.mint);
          const seen = store[item.mint];
          byMint.set(item.mint, {
            mint: item.mint,
            verdict: item.verdict,
            note: cleanText(item.note ?? "", 200),
            ...(seen && outcomeOf(seen) === "dead" ? { already: true } : {}),
          });
        }
        reports[name] = { guest: name, species: guest.species, platform: guest.platform ?? "custom", token: guest.token, items: [...byMint.values()].slice(-MAX_GUEST_ITEMS), at: ctx.now };
        await ctx.state.set(reportsKey, reports);
      } else if (items.length) {
        const store = (await ctx.state.get<Record<string, Observation>>(obsKey)) ?? {};
        for (const item of items) {
          if (Object.keys(store).length >= (cfg.obsCap ?? 4000) && !store[item.mint]) break;
          const prev = store[item.mint];
          store[item.mint] = prev
            ? {
                ...prev,
                ...item,
                symbol: item.symbol !== "?" ? item.symbol : prev.symbol,
                name: item.name || prev.name,
                source: prev.source,
                watchedBy: [...new Set([...(prev.watchedBy ?? []), ...(item.watchedBy ?? [])])],
              }
            : item;
        }
        await ctx.state.set(obsKey, store);
        // Tonight's exam, once enough tokens are in: the same tokens for every holder and for the odds model.
        if (!(await ctx.state.get<Exam>(CONTEST.exam(night)))) {
          const exam = await setExam(ctx.state, night, Object.values(store), ctx.now, { after: cfg.examAfter });
          if (exam) await ctx.trace("contest.exam", { night, mints: exam.tokens.map((t) => t.mint) });
        }
      }

      // Once a night, send yesterday's exam and the guests' verdicts back out to see how they turned out.
      if ((await ctx.state.get<string>("beaver:followedUp")) !== yesterday) {
        const pastReports = Object.values((await ctx.state.get<Record<string, GuestReport>>(`reports:${yesterday}`)) ?? {});
        const exam = (await ctx.state.get<Exam>(CONTEST.exam(yesterday)))?.tokens.map((t) => t.mint) ?? [];
        const mints = followupMints(exam, pastReports, FOLLOWUP_MAX);
        await ctx.state.set("beaver:followedUp", yesterday);
        for (let i = 0; i < mints.length; i += 30) await ctx.signal(hedgehog, "followup.check", { mints: mints.slice(i, i + 30) });
      }
    },
  });
  return [beaver];
}

export function nightWatch(cfg: NightWatchConfig): AgentDefinition[] {
  switch (cfg.role) {
    case "north":
      return northAgents(cfg);
    case "marsh":
      // Retired: the owl and the otter only fed the Morning Brief. The node may keep running; it hosts no agents.
      return [];
    case "canyon":
      return canyonAgents(cfg);
  }
}
