import type { IncomingMessage, ServerResponse } from "node:http";
import { lineage } from "../chain/lineage.ts";
import { socials } from "../chain/socials.ts";
import { holderReport, holdersEnabled } from "../chain/holders.ts";
import { solUsd } from "../chain/price.ts";
import { checkToken } from "../chain/check.ts";
import { bscTape } from "../chain/bsc.ts";
import { baseTape } from "../chain/base.ts";
import { loopOf, loopEnabled } from "../chain/loop.ts";
import { outflowsEnabled, cachedOutflows } from "../chain/outflows.ts";
import { tape } from "../chain/pump.ts";
import { route, ROUTE, norm, fromPeer, clientIp, readJson, clampInt, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** The tapes' status, tool prints and one token as the stream saw it. */
export async function chainReadRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { chainFor, tapeOf } = ctx;
  if (req.method === "GET" && path === "/v1/chain") {
    return json(res, 200, { ...tape.status(), bsc: bscTape.status(), base: baseTape.status() });
  }
  // A tool print: what it is and the launches made with it, so a reader can see the farm behind a fresh wallet.
  if (req.method === "GET" && path === "/v1/chain/tools") {
    res.setHeader("cache-control", "public, max-age=60");
    return json(res, 200, { hours: 48, tools: tape.topPrints(clampInt(url.searchParams.get("limit"), 20, 1, 100)) });
  }
  const toolKey = /^\/v1\/chain\/tool\/(s?[0-9a-f]{6})$/.exec(path);
  if (req.method === "GET" && toolKey) {
    const record = tape.printRecord(toolKey[1]!);
    if (!record) return json(res, 404, { error: "no launch with this tool print in the last two days" });
    res.setHeader("cache-control", "public, max-age=30");
    return json(res, 200, { ...record, recent: tape.printLaunches(toolKey[1]!, clampInt(url.searchParams.get("limit"), 20, 1, 100)) });
  }
  const chainToken = ROUTE.chainToken.exec(path);
  if (req.method === "GET" && chainToken) {
    const a = norm(chainToken[1]!);
    const found = tapeOf(a, url.searchParams.get("chain")).token(a);
    return found ? json(res, 200, { chain: chainFor(a, url.searchParams.get("chain")), ...found }) : json(res, 404, { error: "not on the stream" });
  }
  return false;
}

/** Cabals from the long memory and where tokens were seen on X. */
export async function cabalRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { cabals, mentions, checkGate } = ctx;
  // Cabals: the wallets that work as one hand, from the long memory.
  if (req.method === "GET" && path === "/v1/cabals") {
    if (!cabals) return json(res, 404, { error: "this node keeps no chain history; use the north node" });
    res.setHeader("cache-control", "public, max-age=300");
    return json(res, 200, { builtAt: cabals.builtAt || null, count: cabals.count(), cabals: cabals.top(clampInt(url.searchParams.get("limit"), 50, 1, 200)).map((c) => ({ ...c, members: c.members.slice(0, 8) })) });
  }
  const cabalOf = /^\/v1\/cabal\/(\d{1,9})$/.exec(path);
  if (req.method === "GET" && cabalOf) {
    if (!cabals) return json(res, 404, { error: "this node keeps no chain history; use the north node" });
    const c = cabals.get(Number(cabalOf[1]));
    if (!c) return json(res, 404, { error: "no cabal with this number" });
    res.setHeader("cache-control", "public, max-age=120");
    const live = [...cabals.live(c.id, tape).map((l) => ({ ...l, chain: "solana" as const })), ...cabals.live(c.id, bscTape).map((l) => ({ ...l, chain: "bsc" as const })), ...cabals.live(c.id, baseTape).map((l) => ({ ...l, chain: "base" as const }))].sort((a, b) => b.createdAt - a.createdAt);
    return json(res, 200, { ...c, live });
  }
  // The extension saw a token in a post: who posted it and when. Public posts, nothing about the reader.
  if (req.method === "POST" && path === "/v1/seen") {
    if (!mentions) return json(res, 404, { error: "this node keeps no mentions; use the north node" });
    const caller = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() || clientIp(req);
    if (checkGate.take(caller) > 0) return json(res, 429, { error: "slow down" });
    const body = (await readJson(req).catch(() => null)) as { mint?: unknown; handle?: unknown; url?: unknown; postAt?: unknown } | null;
    return json(res, body && mentions.note(body) ? 200 : 400, { ok: Boolean(body && mentions.note(body)) });
  }
  const mentionsOf = route("/v1/mentions/ADDR").exec(path);
  if (req.method === "GET" && mentionsOf) {
    if (!mentions) return json(res, 404, { error: "this node keeps no mentions; use the north node" });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { mint: norm(mentionsOf[1]!), mentions: mentions.of(norm(mentionsOf[1]!)) });
  }
  return false;
}

/** Holders, reused socials, usage, builders, paymasters, outflows, ruggers, the live feed and clean launches. */
export async function chainBoardRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { history, deepGate, outflowsOf, usage, cache } = ctx;
  const holdersOf = /^\/v1\/chain\/holders\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
  if (req.method === "GET" && holdersOf) {
    if (!holdersEnabled()) return json(res, 404, { error: "no RPC configured on this node" });
    const report = await holderReport(holdersOf[1]!);
    return report ? json(res, 200, report) : json(res, 404, { error: "no holders found" });
  }
  // X accounts, X communities and Telegram groups reused across launches, the most-dumped first.
  if (req.method === "GET" && path === "/v1/chain/socials") {
    return json(res, 200, { hours: 48, read: socials.size, accounts: socials.reused(clampInt(url.searchParams.get("limit"), 30, 1, 100)) });
  }
  if (req.method === "GET" && path === "/v1/usage") {
    return json(res, 200, await usage.view());
  }
  if (req.method === "GET" && path === "/v1/chain/builders") {
    return json(res, 200, { builders: tape.builders(clampInt(url.searchParams.get("limit"), 20, 1, 50)) });
  }
  const pmOf = /^\/v1\/chain\/paymaster\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
  if (req.method === "GET" && pmOf) {
    const caller = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() || clientIp(req);
    if (!fromPeer(req)) { const w = deepGate.take(caller); if (w > 0) return json(res, 429, { error: "slow down", retryAfterMs: w }); }
    const funder = pmOf[1]!;
    const devs = lineage.devsOf(funder);
    if (!devs.size) return json(res, 404, { error: "this wallet has not been seen funding any dev the zoo traced" });
    if (!loopEnabled()) return json(res, 200, { funder, devs: devs.size, loop: null, note: "no RPC configured for the reverse trace" });
    return json(res, 200, (await loopOf(funder, devs)) ?? { funder, devs: devs.size, loop: null });
  }
  // Where the SOL went after the dump: the dev's and its selling wallets' transfers out in the day after the launch.
  const outOf = /^\/v1\/chain\/outflows\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
  if (req.method === "GET" && outOf) {
    const mint = outOf[1]!;
    if (!tape.token(mint) && !history?.has(mint)) return json(res, 404, { error: "not a launch the zoo kept" });
    if (!outflowsEnabled()) return json(res, 200, { mint, flows: null, note: "no RPC configured for the trace" });
    // A trace someone else already paid for answers free.
    if (!cachedOutflows(mint) && !fromPeer(req)) {
      const caller = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() || clientIp(req);
      const w = deepGate.take(caller);
      if (w > 0) return json(res, 429, { error: "slow down", retryAfterMs: w });
    }
    const report = await outflowsOf(mint);
    res.setHeader("cache-control", "no-store");
    // The dev's own history unread is a failed trace, not "nothing sent": say so instead of showing an empty map.
    if (report && !report.wallets[0]?.read) return json(res, 200, { mint, flows: null, note: "the trace could not read the dev's transfers right now" });
    return json(res, 200, report ?? { mint, flows: null });
  }
  if (req.method === "GET" && path === "/v1/chain/paymasters") {
    res.setHeader("cache-control", "public, max-age=60");
    return json(res, 200, { paymasters: lineage.topFunders(clampInt(url.searchParams.get("limit"), 50, 1, 200), clampInt(url.searchParams.get("min"), 3, 2, 50)) });
  }
  if (req.method === "GET" && path === "/v1/chain/funding") {
    res.setHeader("cache-control", "public, max-age=60");
    return json(res, 200, lineage.funderStats());
  }
  if (req.method === "GET" && path === "/v1/chain/ruggers") {
    // Every tape's worst devs in one list, each with its chain; ?chain= keeps one.
    const limit = clampInt(url.searchParams.get("limit"), 20, 1, 50);
    const only = url.searchParams.get("chain");
    const tapes = [[tape, "solana"], [bscTape, "bsc"], [baseTape, "base"]] as const;
    const ruggers = tapes
      .filter(([, c]) => !only || only === c)
      .flatMap(([tp, c]) => tp.ruggers(limit).map((r) => ({ ...r, chain: c })))
      .sort((a, b) => b.dumped - a.dumped || b.launches48h - a.launches48h)
      .slice(0, limit);
    return json(res, 200, { hours: 48, ruggers });
  }
  // The live feed: pump.fun's new, soon and migrated boards with the known scams taken out (avoid never shown).
  if (req.method === "GET" && path === "/v1/chain/feed") {
    const now = Date.now();
    if (!cache.feedCache || now - cache.feedCache.at > 3_000) {
      const c = tape.feedCandidates(now);
      const stream = { live: tape.live(now), lastEventSecAgo: Math.round((now - tape.lastEventAt) / 1000) };
      const row = (mint: string) => {
        const t = tape.token(mint);
        if (!t) return null;
        const check = checkToken(mint, t, { now, stream });
        if (check.verdict === "avoid" || check.verdict === "unknown") return null;
        const f = t.facts;
        const image = socials.image(mint);
        // The coins on screen get their picture read now, not when the queue gets to them.
        if (!image) socials.fetchNow(mint, now);
        // pump.fun's curve: 30 SOL and 1.073B tokens virtual at the start, so the cap in SOL follows from the SOL in it.
        const capSol = f.graduated ? null : Math.round(((30 + (f.curveSol ?? 0)) ** 2 / 32.19) * 10) / 10;
        return {
          mint,
          symbol: t.symbol,
          name: t.name,
          createdAt: t.createdAt,
          ...(image ? { image } : {}),
          verdict: check.verdict,
          score: check.score,
          reason: check.reasons[0] ?? null,
          buyers: f.buyers,
          buys: f.buys,
          sells: f.sells,
          devSoldPct: f.creatorSold === null ? null : Math.round(f.creatorSold * 100),
          curveSol: f.curveSol,
          progress: f.graduated ? 1 : Math.min(1, Math.round(((f.curveSol ?? 0) / 85) * 100) / 100),
          capSol,
          poolSol: f.poolSol,
          graduated: f.graduated,
        };
      };
      const pick = (list: string[]) => list.map(row).filter(Boolean).slice(0, 40);
      cache.feedCache = { at: now, body: { stream, solUsd: solUsd(), new: pick(c.fresh), soon: pick(c.soon), migrated: pick(c.migrated) } };
    }
    res.setHeader("cache-control", "public, max-age=3");
    return json(res, 200, cache.feedCache.body);
  }
  if (req.method === "GET" && path === "/v1/chain/clean") {
    const wide = url.searchParams.get("wide") === "1";
    return json(res, 200, { keptMinutes: wide ? [15, 360] : [10, 180], launches: tape.clean(clampInt(url.searchParams.get("limit"), 20, 1, 50), Date.now(), wide) });
  }
  return false;
}

/** Moments, the pulse and the zoo token's swaps. */
export async function tapeRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  if (req.method === "GET" && path === "/v1/chain/moments") {
    const q = url.searchParams;
    const pick = (k: string) => (q.get(k) ?? "").trim().slice(0, 64) || undefined;
    return json(res, 200, {
      keptHours: 48,
      moments: tape.momentsMatching({ symbol: pick("symbol"), mint: pick("mint"), kind: pick("kind"), limit: clampInt(q.get("limit"), 100, 1, 500) }).map((m) => {
        const image = socials.image(m.mint);
        if (!image) socials.want(m.mint);
        const venue = tape.venueOf(m.mint);
        return { ...m, ...(venue ? { venue } : {}), ...(image ? { image } : {}) };
      }),
    });
  }
  if (req.method === "GET" && path === "/v1/chain/pulse") {
    const after = clampInt(url.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
    const now = Date.now();
    return json(res, 200, { live: tape.live(now), perMinute: tape.perMinute(now), events: tape.pulseAfter(after) });
  }
  // Trades on the zoo's own token, for the buy bot.
  const swapsOf = /^\/v1\/chain\/swaps\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
  if (req.method === "GET" && swapsOf) {
    const after = clampInt(url.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
    return json(res, 200, { live: tape.live(), swaps: tape.followedAfter(swapsOf[1]!, after) });
  }
  return false;
}
