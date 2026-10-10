import { type Address, type AgentDefinition, defineAgent, type SignalValidator, species, type StateStore } from "@aiagentzoo/sdk";
import { cleanText, GUEST_PREFIX, type Guest, isGuestNode } from "../guests.ts";
import type { Launch, Market } from "../sources.ts";
import {
  type Call,
  candidates,
  cleanPlaybook,
  compact,
  DEFAULT_PLAYBOOK,
  followupMints,
  judgeSystem,
  parseCalls,
  type Playbook,
  previousNight,
  REFLECT_SYSTEM,
  ruleCalls,
  type Scorecard,
  scoreNight,
  VERDICTS,
} from "./judgement.ts";

/**
 * The Night Watch: four species on three nodes assemble the Morning Brief
 * from live pump.fun and DexScreener data, with no human in the loop.
 *
 *   node-a  Northern Edge   raven (sentinel)  -> hedgehog (gatherer) -> beaver
 *   node-b  Quiet Marsh     owl (sentinel)    -> otter (gatherer)    -> beaver
 *   node-c  Stone Canyon    beaver (builder)  -> drafts sections
 *                           tortoise (archivist) publishes at dawn
 */

export type Role = "north" | "marsh" | "canyon";

export interface NightWatchConfig {
  role: Role;
  /** Node ids of the three enclosures. */
  nodes: Record<Role, string>;
  /** "HH:MM" UTC when the brief is published. */
  briefAt: string;
  /** Scan cadence for sentinels. */
  scanEveryMs: number;
  /** How often the beaver sits down to judge the night's new tokens. Default 30 min. */
  judgeEveryMs?: number;
  /** Most tokens the beaver keeps per night. Default 4000. */
  obsCap?: number;
  /** Where the archivist writes the brief markdown, if anywhere. */
  onBrief?: (id: string, markdown: string) => void | Promise<void>;
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
}

/** One token a guest agent reported, with its verdict and a short note. */
export interface GuestItem {
  mint: string;
  verdict: (typeof VERDICTS)[number];
  note: string;
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
const MAX_GUESTS_PER_BRIEF = 50;

/** Guardian watchlists live in the north enclosure's state under this prefix. */
export const WATCH_PREFIX = "watch:";
/** Hits and misses of every guest's verdicts, kept by the beaver. */
export const GUEST_SCORES = "guestscores";
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

/** The id of the night a timestamp belongs to: the date of the next brief. */
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
      "profiles.found": listOf("mints", isMint),
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
  const otter: Address = { node: cfg.nodes.marsh, agent: "otter" };
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
        await ctx.trace("scan", { fresh: 0 });
        return;
      }
      await ctx.state.set("raven:cursor", Math.max(...fresh.map((l) => l.createdAt)));
      const round = ((await ctx.state.get<number>("raven:round")) ?? 0) + 1;
      await ctx.state.set("raven:round", round);
      // Every third batch goes across the federation to the marsh.
      const target = round % 3 === 0 ? otter : "hedgehog";
      await ctx.signal(target, "launches.found", { launches: fresh });
    },
  });
  return [raven, gatherer("hedgehog", cfg)];
}

function marshAgents(cfg: NightWatchConfig): AgentDefinition[] {
  const owl = defineAgent({
    name: "owl",
    species: species.sentinel,
    schedule: { every: Math.round(cfg.scanEveryMs * 1.5) },
    budget: { steps: 10, signals: 2 },
    async onWake(ctx) {
      const seen = new Set((await ctx.state.get<string[]>("owl:seen")) ?? []);
      const mints = (await ctx.use<string[]>("dex.profiles")).filter((m) => isMint(m) && !seen.has(m)).slice(0, MAX_BATCH);
      if (mints.length === 0) {
        await ctx.trace("scan", { fresh: 0 });
        return;
      }
      await ctx.state.set("owl:seen", [...seen, ...mints].slice(-500));
      await ctx.signal("otter", "profiles.found", { mints });
    },
  });
  return [owl, gatherer("otter", cfg)];
}

export interface Sections {
  night: string;
  observed: number;
  launches: number;
  graduated: Observation[];
  topVolume: Observation[];
  wentToZero: Observation[];
  suspicious: Array<Observation & { reasons: string[] }>;
  promoted: Observation[];
  /** Tokens guardians asked the zoo to watch, with who asked. */
  watched: Observation[];
  /** Reports from outside agents living in guest enclosures. */
  guests: GuestReport[];
  /** The beaver's own verdicts, with reasons. */
  calls: Call[];
  /** How yesterday's calls turned out and the playbook the beaver judges by now. */
  learned: { score: Scorecard | null; playbook: Playbook };
  updatedAt: number;
}

export interface Thinking {
  calls: Call[];
  score: Scorecard | null;
  playbook: Playbook;
}

export function buildSections(
  night: string,
  obs: Observation[],
  now: number,
  guests: GuestReport[] = [],
  thinking: Thinking = { calls: [], score: null, playbook: DEFAULT_PLAYBOOK },
): Sections {
  const usd = (n: number | null | undefined) => n ?? 0;
  const pump = obs.filter((o) => o.source === "pump");
  const suspicious = obs
    .map((o) => {
      const reasons: string[] = [];
      const m = o.market;
      if (o.hasSocials === false) reasons.push("no socials");
      if (m && m.sells24h > 0 && m.sells24h > m.buys24h * 3) reasons.push("sells outnumber buys 3:1");
      if (m && usd(m.liquidityUsd) > 0 && usd(m.volume24hUsd) > usd(m.liquidityUsd) * 50) reasons.push("volume 50x liquidity");
      return { ...o, reasons };
    })
    .filter((o) => o.reasons.length >= 2)
    .slice(0, 10);
  return {
    night,
    observed: obs.length,
    launches: pump.length,
    graduated: obs.filter((o) => o.complete).slice(0, 10),
    topVolume: [...obs].filter((o) => o.market).sort((a, b) => usd(b.market!.volume24hUsd) - usd(a.market!.volume24hUsd)).slice(0, 10),
    wentToZero: obs.filter((o) => o.market && (usd(o.market.priceChange24h) <= -90 || (o.market.liquidityUsd !== null && o.market.liquidityUsd < 100))).slice(0, 10),
    suspicious,
    promoted: obs.filter((o) => o.source === "dex-profile" && !o.watchedBy?.length).slice(0, 10),
    watched: obs.filter((o) => o.watchedBy?.length).slice(0, 100),
    guests: [...guests].sort((a, b) => a.at - b.at).slice(0, MAX_GUESTS_PER_BRIEF),
    calls: [...thinking.calls]
      .sort((a, b) => VERDICTS.indexOf(b.verdict) - VERDICTS.indexOf(a.verdict) || b.confidence - a.confidence)
      .slice(0, 20),
    learned: { score: thinking.score, playbook: thinking.playbook },
    updatedAt: now,
  };
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const row = (o: Observation) =>
  `| ${o.symbol.replaceAll("|", "")} | \`${o.mint.slice(0, 6)}…${o.mint.slice(-4)}\` | ${money(o.market?.volume24hUsd)} | ${money(o.market?.liquidityUsd)} | ${pct(o.market?.priceChange24h)} |`;
const table = (items: Observation[]) =>
  items.length ? ["| Token | Mint | Vol 24h | Liquidity | 24h |", "|---|---|---|---|---|", ...items.map(row)].join("\n") : "_Nothing this night._";

function learnedText(learned: Sections["learned"] | undefined): string {
  if (!learned) return "_Nothing to learn from yet._";
  const { score, playbook } = learned;
  const lines: string[] = [];
  if (score && score.hits + score.misses > 0) {
    lines.push(
      `Yesterday's calls, re-checked on DexScreener: ${score.hits} right, ${score.misses} wrong (${Math.round((score.accuracy ?? 0) * 100)}% accuracy).`,
    );
  } else {
    lines.push("No scored calls from yesterday yet.");
  }
  lines.push("", `The beaver now judges by playbook v${playbook.version}:`, "", ...playbook.text.split("\n").map((l) => `> ${l}`));
  return lines.join("\n");
}

export function renderBrief(s: Sections, review: string): string {
  return [
    `# Morning Brief — ${s.night}`,
    "",
    `Assembled overnight by the Night Watch: ${s.observed} tokens observed, ${s.launches} fresh pump.fun launches. No human in the loop.`,
    "",
    "## Night in review",
    review,
    "",
    "## Top volume",
    table(s.topVolume),
    "",
    "## Graduated from the bonding curve",
    table(s.graduated),
    "",
    "## Went to zero",
    table(s.wentToZero),
    "",
    "## Suspicious",
    s.suspicious.length ? s.suspicious.map((o) => `- **${o.symbol}** \`${o.mint}\` — ${o.reasons.join(", ")}`).join("\n") : "_Nothing flagged._",
    "",
    "## Freshly promoted on DexScreener",
    table(s.promoted),
    "",
    "## Guardian watch",
    s.watched?.length
      ? s.watched.map((o) => `- **${o.symbol}** \`${o.mint}\` — vol ${money(o.market?.volume24hUsd)}, liq ${money(o.market?.liquidityUsd)}, 24h ${pct(o.market?.priceChange24h)} · watched by ${(o.watchedBy ?? []).map((a) => `${a.slice(0, 4)}…${a.slice(-4)}`).join(", ")}`).join("\n")
      : "_No tokens on guardian watch yet._",
    "",
    "## The pack's calls",
    s.calls?.length
      ? s.calls.map((c) => `- ${c.verdict} **${c.symbol.replaceAll("|", "")}** \`${c.mint}\` (${Math.round(c.confidence * 100)}%, ${c.by}) — ${c.why}`).join("\n")
      : "_No calls this night._",
    "",
    "## What the pack learned",
    learnedText(s.learned),
    "",
    "## From the guest enclosures",
    s.guests?.length
      ? s.guests
          .map((g) =>
            [
              `**${g.guest}** (${g.platform === "clawpump" ? "ClawPump wing, " : ""}${g.species}${g.token ? `, token \`${g.token}\`` : ""})`,
              ...g.items.map((i) => `- ${i.verdict} \`${i.mint}\`${i.note ? ` — ${i.note}` : ""}`),
            ].join("\n"),
          )
          .join("\n\n")
      : "_No guest reports this night._",
    "",
    "_Data: pump.fun, DexScreener; guest reports are the guests' own and signed by their wallets. Observations, not financial advice._",
  ].join("\n");
}

function canyonAgents(cfg: NightWatchConfig): AgentDefinition[] {
  const judgeEveryMs = cfg.judgeEveryMs ?? 30 * 60_000;
  const hedgehog: Address = { node: cfg.nodes.north, agent: "hedgehog" };

  const beaver = defineAgent({
    name: "beaver",
    species: species.builder,
    budget: { steps: 24, signals: 1, modelTokens: 24_000 },
    accepts: { observations: listOf("items", isObservation), "guest.report": isGuestReport },
    async onWake(ctx) {
      if (ctx.reason.type !== "signal") return;
      const event = ctx.reason.event;
      const night = nightOf(ctx.now, cfg.briefAt);
      const obsKey = `obs:${night}`;
      const reportsKey = `reports:${night}`;
      const callsKey = `calls:${night}`;
      const store = (await ctx.state.get<Record<string, Observation>>(obsKey)) ?? {};
      const reports = (await ctx.state.get<Record<string, GuestReport>>(reportsKey)) ?? {};
      let calls = (await ctx.state.get<Call[]>(callsKey)) ?? [];
      let playbook = (await ctx.state.get<Playbook>("beaver:playbook")) ?? DEFAULT_PLAYBOOK;
      const yesterday = previousNight(night);
      let score = (await ctx.state.get<Scorecard>(`score:${yesterday}`)) ?? null;

      const items = event.type === "observations" ? (event.payload as { items: Observation[] }).items : [];
      if (items.length && items.every((o) => o.source === "followup")) {
        // The hedgehog is back with yesterday's tokens: score the calls, then rewrite the playbook.
        const pastCalls = (await ctx.state.get<Call[]>(`calls:${yesterday}`)) ?? [];
        const pastReports = Object.values((await ctx.state.get<Record<string, GuestReport>>(`reports:${yesterday}`)) ?? {});
        score = scoreNight(yesterday, pastCalls, pastReports, items);
        await ctx.state.set(`score:${yesterday}`, score);
        await ctx.trace("calls.scored", { night: yesterday, hits: score.hits, misses: score.misses, accuracy: score.accuracy, guests: score.guests });
        // Guests earn a track record from the same checks: one ledger of hits and misses per guest.
        const ledger = (await ctx.state.get<Record<string, { hits: number; misses: number }>>(GUEST_SCORES)) ?? {};
        for (const [name, g] of Object.entries(score.guests)) {
          const prev = ledger[name] ?? { hits: 0, misses: 0 };
          ledger[name] = { hits: prev.hits + g.hits, misses: prev.misses + g.misses };
        }
        if (Object.keys(score.guests).length) await ctx.state.set(GUEST_SCORES, ledger);
        if (score.hits + score.misses > 0 && playbook.night !== yesterday) {
          try {
            const result = await ctx.think({
              system: REFLECT_SYSTEM,
              prompt: `Your current playbook, v${playbook.version}:\n${playbook.text}\n\nYesterday: ${score.hits} right, ${score.misses} wrong. The scored cases follow.`,
              untrusted: score.cases.filter((c) => c.hit !== null),
              maxTokens: 1200,
            });
            const text = cleanPlaybook(result.text);
            if (text.length >= 40) {
              playbook = { version: playbook.version + 1, text, night: yesterday, accuracy: score.accuracy, updatedAt: ctx.now };
              await ctx.state.set("beaver:playbook", playbook);
              await ctx.trace("playbook.updated", { version: playbook.version, night: yesterday, accuracy: score.accuracy, text });
            }
          } catch (error) {
            // No model or no budget: the scorecard is still on the record, the playbook stays.
            await ctx.trace("playbook.kept", { reason: (error as Error).message.slice(0, 300) });
          }
        }
      } else if (event.type === "guest.report") {
        const name = event.from.agent;
        const guest = await ctx.state.get<Guest>(`${GUEST_PREFIX}${name}`);
        if (!guest || (!reports[name] && Object.keys(reports).length >= MAX_GUESTS_PER_BRIEF)) return;
        const byMint = new Map((reports[name]?.items ?? []).map((i) => [i.mint, i]));
        for (const item of (event.payload as { items: GuestItem[] }).items) {
          byMint.delete(item.mint);
          byMint.set(item.mint, { mint: item.mint, verdict: item.verdict, note: cleanText(item.note ?? "", 200) });
        }
        reports[name] = { guest: name, species: guest.species, platform: guest.platform ?? "custom", token: guest.token, items: [...byMint.values()].slice(-MAX_GUEST_ITEMS), at: ctx.now };
        await ctx.state.set(reportsKey, reports);
      } else {
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
      }

      // Once a night, send yesterday's calls back out to see how they turned out.
      if ((await ctx.state.get<string>("beaver:followedUp")) !== yesterday) {
        const pastCalls = (await ctx.state.get<Call[]>(`calls:${yesterday}`)) ?? [];
        const pastReports = Object.values((await ctx.state.get<Record<string, GuestReport>>(`reports:${yesterday}`)) ?? {});
        const mints = followupMints(pastCalls, pastReports);
        await ctx.state.set("beaver:followedUp", yesterday);
        if (mints.length) await ctx.signal(hedgehog, "followup.check", { mints });
      }

      // Judge the night's new tokens, at most every judgeEveryMs.
      const judgedAt = (await ctx.state.get<number>("beaver:judgedAt")) ?? 0;
      if (ctx.now - judgedAt >= judgeEveryMs) {
        const asked = candidates(Object.values(store), new Set(calls.map((c) => c.mint)));
        if (asked.length) {
          let fresh: Call[] = [];
          try {
            const result = await ctx.think({
              system: judgeSystem(playbook),
              prompt: `Judge these ${asked.length} tokens.`,
              untrusted: asked.map(compact),
              maxTokens: 2000,
            });
            fresh = parseCalls(result.text, asked, ctx.now);
            if (fresh.length === 0) await ctx.trace("judge.unparsed", { asked: asked.length, reply: result.text.slice(0, 300) });
          } catch (error) {
            fresh = ruleCalls(asked, ctx.now);
            await ctx.trace("judge.fallback", { reason: (error as Error).message.slice(0, 300), ruleCalls: fresh.length });
          }
          calls = [...calls, ...fresh].slice(-200);
          await ctx.state.set(callsKey, calls);
          await ctx.state.set("beaver:judgedAt", ctx.now);
          if (fresh.length) {
            await ctx.trace("calls.made", {
              count: fresh.length,
              by: fresh[0]!.by,
              playbook: playbook.version,
              calls: fresh.map(({ mint, verdict, confidence, why }) => ({ mint, verdict, confidence, why })),
            });
          }
        }
      }

      const sections = buildSections(night, Object.values(store), ctx.now, Object.values(reports), { calls, score, playbook });
      await ctx.artifact.draft(`brief:${night}`, sections);
    },
  });

  const tortoise = defineAgent({
    name: "tortoise",
    species: species.archivist,
    schedule: { dailyAt: cfg.briefAt },
    budget: { steps: 5, modelTokens: 12_000 },
    async onWake(ctx) {
      // At dawn the night that is ending is the one dated today.
      const night = nightOf(ctx.now - 60_000, cfg.briefAt);
      const draft = (await ctx.artifact.drafts(`brief:${night}`))[0]?.content as Sections | undefined;
      if (!draft) {
        await ctx.trace("brief.skipped", { night, reason: "no drafts" });
        return;
      }
      let review = `${draft.observed} tokens observed; ${draft.graduated.length} graduated, ${draft.wentToZero.length} went to zero, ${draft.suspicious.length} flagged.`;
      try {
        const result = await ctx.think({
          system:
            "You are the Archivist of ZOOAI AGENCY. Write the 'Night in review' paragraph of a factual morning brief about new Solana tokens. " +
            "3-5 sentences, plain English, numbers over adjectives, no hype, no investment advice, no names of people.",
          prompt: "Summarise the night from these aggregated sections.",
          untrusted: draft,
          maxTokens: 600,
        });
        if (result.text) review = result.text;
      } catch {
        // No model configured or budget exhausted: the factual one-liner stands.
      }
      const markdown = renderBrief(draft, review);
      await ctx.artifact.publish(`morning-brief-${night}`, { night, markdown, sections: draft });
      await cfg.onBrief?.(`morning-brief-${night}`, markdown);
    },
  });
  return [beaver, tortoise];
}

export function nightWatch(cfg: NightWatchConfig): AgentDefinition[] {
  switch (cfg.role) {
    case "north":
      return northAgents(cfg);
    case "marsh":
      return marshAgents(cfg);
    case "canyon":
      return canyonAgents(cfg);
  }
}
