import { type Address, type AgentDefinition, defineAgent, type SignalValidator, species } from "@aiagentzoo/sdk";
import type { Launch, Market } from "../sources.ts";

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
  /** Where the archivist writes the brief markdown, if anywhere. */
  onBrief?: (id: string, markdown: string) => void | Promise<void>;
}

export interface Observation {
  mint: string;
  symbol: string;
  name: string;
  source: "pump" | "dex-profile";
  createdAt: number | null;
  creator: string | null;
  hasSocials: boolean | null;
  complete: boolean;
  marketCapUsd: number | null;
  market: Omit<Market, "mint" | "symbol" | "name"> | null;
  seenAt: number;
  scout: string;
}

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
    },
    async onWake(ctx) {
      if (ctx.reason.type !== "signal") {
        await ctx.trace("patrol", { note: "no trail to follow" });
        return;
      }
      const event = ctx.reason.event;
      let launches: Launch[];
      let source: Observation["source"];
      if (event.type === "launches.found") {
        launches = (event.payload as { launches: Launch[] }).launches;
        source = "pump";
      } else {
        const mints = (event.payload as { mints: string[] }).mints;
        launches = mints.map((mint) => ({ mint, name: "", symbol: "?", createdAt: 0, creator: "", marketCapUsd: null, complete: false, hasSocials: true }));
        source = "dex-profile";
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
  updatedAt: number;
}

export function buildSections(night: string, obs: Observation[], now: number): Sections {
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
    promoted: obs.filter((o) => o.source === "dex-profile").slice(0, 10),
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
    "_Data: pump.fun, DexScreener. Observations, not financial advice._",
  ].join("\n");
}

function canyonAgents(cfg: NightWatchConfig): AgentDefinition[] {
  const beaver = defineAgent({
    name: "beaver",
    species: species.builder,
    budget: { steps: 10, signals: 0 },
    accepts: { observations: listOf("items", isObservation) },
    async onWake(ctx) {
      if (ctx.reason.type !== "signal") return;
      const night = nightOf(ctx.now, cfg.briefAt);
      const key = `obs:${night}`;
      const store = (await ctx.state.get<Record<string, Observation>>(key)) ?? {};
      for (const item of (ctx.reason.event.payload as { items: Observation[] }).items) {
        if (Object.keys(store).length >= 1000 && !store[item.mint]) break;
        const prev = store[item.mint];
        store[item.mint] = prev
          ? { ...prev, ...item, symbol: item.symbol !== "?" ? item.symbol : prev.symbol, name: item.name || prev.name, source: prev.source }
          : item;
      }
      await ctx.state.set(key, store);
      const sections = buildSections(night, Object.values(store), ctx.now);
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
            "You are the Archivist of AiAgentZoo. Write the 'Night in review' paragraph of a factual morning brief about new Solana tokens. " +
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
