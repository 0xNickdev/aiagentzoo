import type { AddressInfo } from "node:net";
import type { ServerResponse } from "node:http";
import type { Enclosure } from "@aiagentzoo/sdk";
import { Cooldown } from "../guardian.ts";
import type { PassportIndex } from "../passport.ts";
import type { BriefIndex } from "../briefs.ts";
import type { AskDesk } from "../ask.ts";
import { lineage } from "../chain/lineage.ts";
import { exchangeOf, launcherOf } from "../chain/exchanges.ts";
import { type Chain, isEvm, RateGate } from "../chain/check.ts";
import { bscTape } from "../chain/bsc.ts";
import { baseTape } from "../chain/base.ts";
import type { WalletTag } from "../chain/tags.ts";
import type { CabalIndex } from "../chain/cabals.ts";
import { labels } from "../chain/labels.ts";
import type { SideWallets } from "../chain/sidewallets.ts";
import { handleOf, type Mentions } from "../chain/mentions.ts";
import { traceOutflows, outflowsEnabled, cachedOutflows, type Destination } from "../chain/outflows.ts";
import { FREE_DEEP_PER_MIN, FREE_PER_MIN, HOLDER_DEEP_PER_MIN, HOLDER_PER_MIN, HoldingCache } from "../chain/keys.ts";
import { isHolder } from "../holders.ts";
import { CHAIN_OF_VENUE, type CreatorRecord, tape, type Venue } from "../chain/pump.ts";
import type { HistoryStore } from "../chain/history.ts";
import type { GuestHouse } from "../guests.ts";
import type { X402Lane } from "../x402.ts";

/** A first-seconds wallet that sniped this many launches in two days is a bot: its transfers are its float, not a launch's proceeds. */
const BOT_SNIPES = 150;

export interface ServerOptions {
  enclosure: Enclosure;
  /** Bearer token for warden-only routes. Unset disables them. */
  adminToken?: string;
  /** Allowed CORS origin for the public, read-only routes. */
  corsOrigin?: string;
  /** Present the node as a member of a named federation. */
  meta?: Record<string, unknown>;
  /** Agent passports derived from the log. */
  passports?: PassportIndex;
  /** Public wake button. Disabled when unset. */
  visitor?: VisitorPolicy;
  /** Published Morning Briefs. */
  briefs?: BriefIndex;
  /** Guardian watchlists. Enabled on the node whose sentinel reads them. */
  watchlist?: { perGuardian: number; maxGuardians: number; perHolder?: number };
  /** Guest enclosures for outside agents. Disabled when unset. */
  guests?: GuestHouse;
  /** Live numbers for the site, served at GET /v1/stats. */
  stats?: () => Promise<unknown>;
  /** Every graded agent on one scale, served at GET /v1/leaderboard. */
  board?: () => Promise<unknown>;
  /** The beaver's night-by-night record, served at GET /v1/beaver/record. */
  beaverHistory?: () => Promise<unknown>;
  /** Agent of the week standings, served at GET /v1/agent-of-the-week. */
  weekly?: () => Promise<unknown>;
  buybacks?: () => Promise<unknown>;
  /** "Ask the beaver", on the node that keeps it. */
  asks?: AskDesk;
  /** The nursery, served at GET /v1/evolution on the node that keeps it. */
  evolution?: { briefAt: string };
  /** The chain's long memory on the north node: tokens and wallets for 90 days, after the tape forgets them. */
  history?: HistoryStore;
  /** Cabals read from that memory: wallets that launch, snipe and fund together. */
  cabals?: CabalIndex;
  /** Who funded the first-second wallets, traced in the background: a KOL's side wallets show. */
  sideWallets?: SideWallets;
  /** Where tokens were seen on X, as the extension reports it. */
  mentions?: Mentions;
  /** Pay-per-report over HTTP 402 in USDC on Solana; absent when x402 is off. */
  x402?: X402Lane | null;
}

export interface VisitorPolicy {
  /** Agents visitors may wake. Keep this to cheap, harmless species. */
  agents: string[];
  /** Minimum gap between any two public wake-ups of the same agent. */
  agentCooldownMs: number;
  /** Per anonymous visitor (by IP). */
  visitorCooldownMs: number;
  /** Per signed-in guardian wallet. */
  guardianCooldownMs: number;
}

/** Per-server request caches the routes refresh in place. */
export interface RouteCache {
  checkRecord: { at: number; body: unknown } | null;
  feedCache: { at: number; body: unknown } | null;
}

/**
 * Everything the routes share: the node's options, its rate gates, the helpers that read across tapes and the long
 * memory, the live stream subscribers and the usage tally. One per server.
 */
export function createRouteContext(options: ServerOptions, serverAddress: () => AddressInfo | string | null) {
  const { enclosure, corsOrigin = "*", meta = {}, visitor, history, cabals, sideWallets, mentions } = options;
  const agentCooldown = new Cooldown(visitor?.agentCooldownMs ?? 0);
  const visitorCooldown = new Cooldown(visitor?.visitorCooldownMs ?? 0);
  // The creator check: generous per caller, since agents behind one proxy share an address.
  const checkGate = new RateGate(FREE_PER_MIN);
  // A creator's two days on the tape, unless the long memory has seen more of their launches: then its counts, back to
  // its first day. The two-day numbers stay in last48h; the check's own verdict still reads the two days.
  const preferHistory = (rec: CreatorRecord | null, wallet: string) => {
    const h = history?.creatorTotals(wallet);
    if (!h || h.launches <= (rec?.launches48h ?? 0)) return rec;
    return {
      ...(rec ?? { wallet, launches24h: 0 }),
      launches48h: h.launches,
      dumped: Math.max(h.dumped, rec?.dumped ?? 0),
      medianDumpMin: h.medianDumpMin ?? rec?.medianDumpMin ?? null,
      graduated: Math.max(h.graduated, rec?.graduated ?? 0),
      recent: (rec?.recent.length ?? 0) >= h.recent.length ? rec!.recent : h.recent,
      last48h: rec ? { launches: rec.launches48h, dumped: rec.dumped } : { launches: 0, dumped: 0 },
      counted: "history" as const,
      historySince: history!.since(),
    };
  };
  /** A wallet's 90-day roles from the long memory, for its tags; nothing on nodes without one. */
  const kept = (wallet: string) => history?.wallet(wallet, 1) ?? null;
  /**
   * Which chain an address is on. Base58 is Solana. A 0x address is BNB Chain or Base, and its shape cannot say which:
   * the tape that has it (as a token, a creator or a sniper) decides, then the venue the long memory kept it under,
   * then the caller's `?chain=`; BNB Chain otherwise, the first EVM chain the zoo read.
   */
  const chainFor = (address: string, hint?: string | null): Chain => {
    if (!isEvm(address)) return "solana";
    for (const [t, c] of [[bscTape, "bsc"], [baseTape, "base"]] as const) if (t.token(address) || t.creator(address) || t.sniper(address)) return c;
    const venue = history?.venueOf(address) ?? history?.walletVenue(address);
    if (venue && venue in CHAIN_OF_VENUE) return CHAIN_OF_VENUE[venue as Venue];
    return hint === "base" || hint === "bsc" ? hint : "bsc";
  };
  /** The tape that reads the chain an address lives on. */
  const tapeOf = (address: string, hint?: string | null) => {
    const c = chainFor(address, hint);
    return c === "bsc" ? bscTape : c === "base" ? baseTape : tape;
  };
  /**
   * Where the token was seen on X, and the one thing worth saying about it: a KOL whose wallet (or side wallet)
   * bought in the first seconds and who posted it later. Written into the check's notes, never a reason.
   */
  const shills = (mint: string, early: Array<{ afterSec?: number; kol?: { x: string | null }; kolSide?: { x: string | null } }>, createdAt: number, check: { notes: string[] }) => {
    const seen = mentions?.of(mint, 20) ?? [];
    for (const e of early) {
      const h = handleOf((e.kol ?? e.kolSide)?.x);
      if (!h) continue;
      const post = seen.find((m) => m.handle === h);
      const boughtAt = createdAt + (e.afterSec ?? 0) * 1000;
      if (post && post.postAt > boughtAt) check.notes.push(`@${h}'s ${e.kol ? "wallet" : "side wallet"} bought in the first ${e.afterSec ?? 0}s and posted it ${Math.max(1, Math.round((post.postAt - boughtAt) / 60_000))} min later`);
    }
    return { mentions: seen };
  };
  /** Tags plus the cabal each wallet belongs to, and who it is said to be: a KOL, a smart-money wallet. */
  const withCabal = <T extends { wallet: string; tags: WalletTag[] }>(list: T[]) =>
    list.map((w) => {
      const kol = labels.kol(w.wallet);
      const smart = labels.smartOf(w.wallet);
      const side = !kol ? (sideWallets?.kolOf(w.wallet) ?? null) : null;
      const tags = [...w.tags.filter((x) => x !== "new" || (!kol && !smart && !side)), ...(kol ? ["kol" as const] : []), ...(side ? ["kolside" as const] : []), ...(smart ? ["smart" as const] : [])];
      return { ...w, tags, ...(cabals ? { cabal: cabals.of(w.wallet) } : {}), ...(kol ? { kol } : {}), ...(side ? { kolSide: side } : {}), ...(smart ? { smart } : {}) };
    });
  /**
   * Where a Solana launch's dev and its selling wallets sent SOL in the day after it. The dev first, then the
   * first-seconds wallets that sold most, the dev's own before strangers; sniper bots that trade nonstop are left out.
   */
  const outflowsOf = (mint: string) => {
    if (!outflowsEnabled()) return Promise.resolve(null);
    const cached = cachedOutflows(mint);
    if (cached) return Promise.resolve(cached);
    const found = tape.token(mint);
    const past = !found && history ? history.report(mint) : null;
    if (!found && !past) return Promise.resolve(null);
    const { creator, createdAt } = (found ?? past)!;
    const early = found ? (tape.earlyOf(mint) ?? []) : past!.early;
    const roleOf = (e: { crew: boolean; serial: boolean; ring: boolean; bundle: boolean }) => (e.crew ? "crew" : e.serial || e.ring ? "snipers" : e.bundle ? "bundle" : null);
    const sold = early.filter((e) => e.wallet !== creator && roleOf(e) && e.bought - e.held > 0.005).sort((a, b) => b.bought - b.held - (a.bought - a.held));
    const bot = (e: { crew: boolean; snipes48h: number }) => !e.crew && e.snipes48h >= BOT_SNIPES;
    const sellers = sold.filter((e) => !bot(e)).slice(0, 5).map((e) => ({ wallet: e.wallet, role: roleOf(e)! }));
    const funder = lineage.funderOf(creator) ?? past?.funder ?? null;
    const name = (to: string): Destination => {
      const ex = exchangeOf(to) ?? launcherOf(to);
      if (ex) return { kind: "exchange", label: ex };
      const cabal = cabals?.of(to) ?? null;
      const inCabal = cabal !== null ? { cabal } : {};
      if (funder && to === funder) return { kind: "funder", label: null, ...inCabal };
      const rec = tape.creator(to);
      const kept = history?.wallet(to, 1);
      // A KOL who launches coins too: the trail should say both.
      const launched = rec || (kept && kept.launches > 0) ? { launches: Math.max(rec?.launches48h ?? 0, kept?.launches ?? 0), dumped: Math.max(rec?.dumped ?? 0, kept?.dumped ?? 0) } : null;
      const kol = labels.kol(to);
      if (kol) return { kind: "kol", label: kol.name ?? null, ...(launched ?? {}), ...inCabal };
      if (launched) return { kind: "dev", label: null, ...launched, ...inCabal };
      const devs = lineage.devsOf(to).size;
      if (devs) return { kind: "paymaster", label: null, devs, ...inCabal };
      return { kind: "wallet", label: null, ...inCabal };
    };
    const isDev = (w: string) => w !== creator && (tape.creator(w) != null || (history?.wallet(w, 1)?.launches ?? 0) > 0);
    return traceOutflows(mint, createdAt, [{ wallet: creator, role: "dev" }, ...sellers], name, isDev, fetch, Date.now(), sold.filter(bot).length).catch(() => null);
  };
  const holderGate = new RateGate(HOLDER_PER_MIN);
  const deepGate = new RateGate(FREE_DEEP_PER_MIN);
  const holderDeepGate = new RateGate(HOLDER_DEEP_PER_MIN);
  const keyGate = new RateGate(1);
  // The swap's RPC reads: generous, since every site visitor may arrive through one proxy address.
  const rpcGate = new RateGate(600);
  const holding = new HoldingCache((w) => isHolder(w));
  const guardianCooldown = new Cooldown(visitor?.guardianCooldownMs ?? 0);
  const streams = new Set<ServerResponse>();

  // How much the X-Ray is actually used, by day: calls served and the distinct callers that made them (hashed, never the raw address).
  const h12 = (v: string) => { let h = 0x811c9dc5; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
  const usage = {
    mem: new Map<string, { xrays: number; checks: number; callers: Set<string>; by: Record<string, { xrays: number; checks: number }>; who: Record<string, [number, number]> }>(),
    dirty: new Set<string>(),
    day: () => new Date().toISOString().slice(0, 10),
    async bump(deep: boolean, caller: string, chain = "solana", source = "api") {
      if (caller === "peer") return;
      const d = usage.day();
      let u = usage.mem.get(d);
      if (!u) {
        const saved = await enclosure.store.get<{ xrays: number; checks: number; callers: string[]; by?: Record<string, { xrays: number; checks: number }>; who?: Record<string, [number, number]> }>(`usage:${d}`);
        u = { xrays: saved?.xrays ?? 0, checks: saved?.checks ?? 0, callers: new Set(saved?.callers ?? []), by: saved?.by ?? {}, who: saved?.who ?? {} };
        usage.mem.set(d, u);
      }
      if (deep) u.xrays += 1; else u.checks += 1;
      // The same count split by chain, kept since 2026-11-13: earlier days have no split.
      const c = (u.by[chain] ??= { xrays: 0, checks: 0 });
      if (deep) c.xrays += 1; else c.checks += 1;
      const h = h12(caller);
      if (u.callers.size < 200_000) u.callers.add(h);
      // Who made the calls, kept since 2026-11-14: x-rays and checks per hashed caller and where they came from
      // (the site, the extension, a holder's key, or the bare API), so one bot is not read as a crowd.
      const k = `${source}|${h}`;
      const w = u.who[k] ?? (u.callers.size < 200_000 ? (u.who[k] = [0, 0]) : null);
      if (w) w[deep ? 0 : 1] += 1;
      usage.dirty.add(d);
    },
    async flush() {
      for (const d of usage.dirty) {
        const u = usage.mem.get(d)!;
        await enclosure.store.set(`usage:${d}`, { xrays: u.xrays, checks: u.checks, callers: [...u.callers], by: u.by, who: u.who });
      }
      usage.dirty.clear();
    },
    async view() {
      await usage.flush();
      const rows = [];
      let xrays = 0, checks = 0; const users = new Set<string>();
      // Calls by source and the share the busiest callers made, from one or more days of `who`.
      const split = (who: Record<string, [number, number]>) => {
        const bySource: Record<string, { xrays: number; checks: number; users: number }> = {};
        const per = new Map<string, [number, number]>();
        for (const [k, [x, c]] of Object.entries(who)) {
          const [src, h] = k.split("|") as [string, string];
          const t = (bySource[src] ??= { xrays: 0, checks: 0, users: 0 });
          t.xrays += x; t.checks += c; t.users += 1;
          const p = per.get(h) ?? [0, 0];
          per.set(h, [p[0] + x, p[1] + c]);
        }
        const share = (i: 0 | 1, n: number) => {
          const all = [...per.values()].map((v) => v[i]).sort((a, b) => b - a);
          const total = all.reduce((a, b) => a + b, 0);
          return total ? Math.round((all.slice(0, n).reduce((a, b) => a + b, 0) / total) * 100) / 100 : 0;
        };
        return { bySource, top: { xrays1: share(0, 1), xrays10: share(0, 10), checks1: share(1, 1), checks10: share(1, 10) } };
      };
      const who7: Record<string, [number, number]> = {};
      const byChain: Record<string, { xrays: number; checks: number }> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        const u = usage.mem.get(d) ?? (await enclosure.store.get<{ xrays: number; checks: number; callers: string[]; by?: Record<string, { xrays: number; checks: number }>; who?: Record<string, [number, number]> }>(`usage:${d}`));
        const list = u ? (u.callers instanceof Set ? [...u.callers] : u.callers) : [];
        const who = u?.who && Object.keys(u.who).length ? u.who : null;
        rows.push({ day: d, xrays: u?.xrays ?? 0, checks: u?.checks ?? 0, users: list.length, ...(u?.by && Object.keys(u.by).length ? { byChain: u.by } : {}), ...(who ? split(who) : {}) });
        for (const [k, v] of Object.entries(who ?? {})) {
          const t = (who7[k] ??= [0, 0]);
          t[0] += v[0]; t[1] += v[1];
        }
        for (const [k, v] of Object.entries(u?.by ?? {})) {
          const t = (byChain[k] ??= { xrays: 0, checks: 0 });
          t.xrays += v.xrays;
          t.checks += v.checks;
        }
        xrays += u?.xrays ?? 0; checks += u?.checks ?? 0;
        // Of this day's callers, how many had been here on an earlier day of the week shown.
        const back = list.filter((c) => users.has(c)).length;
        if (rows.length > 1) (rows[rows.length - 1] as { returning?: number }).returning = back;
        for (const c of list) users.add(c);
      }
      return { days: rows, last7: { xrays, checks, users: users.size, byChain, ...(Object.keys(who7).length ? split(who7) : {}) } };
    },
  };
  const cache: RouteCache = { checkRecord: null, feedCache: null };
  return {
    ...options,
    corsOrigin,
    meta,
    agentCooldown,
    visitorCooldown,
    guardianCooldown,
    checkGate,
    holderGate,
    deepGate,
    holderDeepGate,
    keyGate,
    rpcGate,
    holding,
    preferHistory,
    kept,
    chainFor,
    tapeOf,
    shills,
    withCabal,
    outflowsOf,
    streams,
    usage,
    cache,
    serverAddress,
  };
}

export type RouteContext = ReturnType<typeof createRouteContext>;
