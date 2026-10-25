import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Enclosure, LogEntry, ZooEvent } from "@aiagentzoo/sdk";
import { Cooldown, type GuardianSession, verifyGuardian } from "./guardian.ts";
import type { PassportIndex } from "./passport.ts";
import type { BriefIndex } from "./briefs.ts";
import { GUEST_SCORES, guestRecord, WATCH_PREFIX } from "./agents/nightWatch.ts";
import type { AskDesk } from "./ask.ts";
import { badgeSvg } from "./badge.ts";
import { humansView, submitAnswers } from "./humans.ts";
import { castVote, geneView, nameNewborn, VOTE_MIN } from "./gene.ts";
import { weekOf } from "./stats.ts";
import { nightOf } from "./agents/nightWatch.ts";
import { fundersEnabled, traceFunders } from "./chain/funders.ts";
import { lineage, type LineageView } from "./chain/lineage.ts";
import { socials } from "./chain/socials.ts";
import { exchangeOf } from "./chain/exchanges.ts";
import { holderReport, holdersEnabled, poolSolOf } from "./chain/holders.ts";
import { checkToken, outsideCheck, RateGate } from "./chain/check.ts";
import { originOf } from "./chain/origin.ts";
import { FREE_DEEP_PER_MIN, FREE_PER_MIN, HOLDER_DEEP_PER_MIN, HOLDER_PER_MIN, HoldingCache, issueKey, keyFrom, walletOfKey } from "./chain/keys.ts";
import { linkCode, setWatch, verifyInitData } from "./telegram.ts";
import { balanceOf, HOLDER_MIN, isHolder, TOKEN_MINT } from "./holders.ts";
import type { BoardRow } from "./stats.ts";
import { creatureView, evolutionView } from "./agents/evolution.ts";
import { koiView } from "./agents/koi.ts";
import { type GuestTally, skillOf } from "./agents/judgement.ts";
import { type CreatorRecord, tape } from "./chain/pump.ts";
import type { HistoryStore } from "./chain/history.ts";
import { type GuestHouse, isGuestNode, publicGuest } from "./guests.ts";

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
  /** "Ask the beaver", on the node that keeps it. */
  asks?: AskDesk;
  /** The nursery, served at GET /v1/evolution on the node that keeps it. */
  evolution?: { briefAt: string };
  /** The chain's long memory on the north node: tokens and wallets for 90 days, after the tape forgets them. */
  history?: HistoryStore;
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

const MAX_BODY = 256 * 1024;
/** Entries a fresh SSE subscriber receives before live updates. */
const STREAM_REPLAY = 150;
/** Open SSE connections per node; beyond this new subscribers get 503. */
const MAX_STREAMS = 500;

export function createNodeServer({ enclosure, adminToken, corsOrigin = "*", meta = {}, passports, visitor, briefs, watchlist, guests, stats, board, beaverHistory, weekly, asks, evolution, history }: ServerOptions) {
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
  const holderGate = new RateGate(HOLDER_PER_MIN);
  const deepGate = new RateGate(FREE_DEEP_PER_MIN);
  const holderDeepGate = new RateGate(HOLDER_DEEP_PER_MIN);
  const keyGate = new RateGate(1);
  const holding = new HoldingCache((w) => isHolder(w));
  let checkRecord: { at: number; body: unknown } | null = null;
  const guardianCooldown = new Cooldown(visitor?.guardianCooldownMs ?? 0);
  const streams = new Set<ServerResponse>();
  enclosure.log.subscribe((entry) => {
    const frame = `id: ${entry.seq}\nevent: entry\ndata: ${JSON.stringify(entry)}\n\n`;
    for (const res of streams) res.write(frame);
  });

  const heartbeat = setInterval(() => {
    for (const res of streams) res.write(": ping\n\n");
  }, 20_000);
  heartbeat.unref();

  // How much the X-Ray is actually used, by day: calls served and the distinct callers that made them (hashed, never the raw address).
  const h12 = (v: string) => { let h = 0x811c9dc5; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
  const usage = {
    mem: new Map<string, { xrays: number; checks: number; callers: Set<string> }>(),
    dirty: new Set<string>(),
    day: () => new Date().toISOString().slice(0, 10),
    async bump(deep: boolean, caller: string) {
      if (caller === "peer") return;
      const d = usage.day();
      let u = usage.mem.get(d);
      if (!u) {
        const saved = await enclosure.store.get<{ xrays: number; checks: number; callers: string[] }>(`usage:${d}`);
        u = { xrays: saved?.xrays ?? 0, checks: saved?.checks ?? 0, callers: new Set(saved?.callers ?? []) };
        usage.mem.set(d, u);
      }
      if (deep) u.xrays += 1; else u.checks += 1;
      if (u.callers.size < 200_000) u.callers.add(h12(caller));
      usage.dirty.add(d);
    },
    async flush() {
      for (const d of usage.dirty) {
        const u = usage.mem.get(d)!;
        await enclosure.store.set(`usage:${d}`, { xrays: u.xrays, checks: u.checks, callers: [...u.callers] });
      }
      usage.dirty.clear();
    },
    async view() {
      await usage.flush();
      const rows = [];
      let xrays = 0, checks = 0; const users = new Set<string>();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        const u = usage.mem.get(d) ?? (await enclosure.store.get<{ xrays: number; checks: number; callers: string[] }>(`usage:${d}`));
        const list = u ? (u.callers instanceof Set ? [...u.callers] : u.callers) : [];
        rows.push({ day: d, xrays: u?.xrays ?? 0, checks: u?.checks ?? 0, users: list.length });
        xrays += u?.xrays ?? 0; checks += u?.checks ?? 0;
        for (const c of list) users.add(c);
      }
      return { days: rows, last7: { xrays, checks, users: users.size } };
    },
  };
  setInterval(() => void usage.flush(), 60_000).unref();

  const server = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", corsOrigin);
    res.setHeader("access-control-allow-headers", "content-type, authorization");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return end(res, 204);

    const url = new URL(req.url ?? "/", "http://node");
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true });

      if (req.method === "GET" && path === "/v1/node") {
        const head = await enclosure.log.head();
        const ledger = enclosure.ledger;
        return json(res, 200, {
          id: enclosure.node.id,
          name: enclosure.name,
          publicKey: enclosure.node.identity.publicKey,
          retired: enclosure.isRetired,
          head: head ? { seq: head.seq, hash: head.hash } : null,
          peers: enclosure.peers.list().filter((p) => !isGuestNode(p.id)).map(({ id, url: peerUrl, publicKey }) => ({ id, url: peerUrl, publicKey })),
          feed: ledger
            ? {
                keeper: ledger.balance(enclosure.keeper),
                stake: ledger.stakeOf(enclosure.node.id),
                burned: ledger.burned(),
                params: ledger.params,
              }
            : null,
          guests: guests ? guests.list().length : null,
          ...meta,
        });
      }

      if (req.method === "GET" && path === "/v1/agents") return json(res, 200, enclosure.snapshot());

      const badge = /^\/v1\/badge\/([A-Za-z0-9_.-]{1,64})\.svg$/.exec(path);
      if (req.method === "GET" && badge) {
        if (!board) return json(res, 404, { error: "no leaderboard on this node" });
        const b = (await board()) as { minGraded: number; rows: BoardRow[] };
        const key = badge[1]!.toLowerCase();
        const row = b.rows.find((r) => [r.id, r.id.replace(/^(guest|nursery):/, ""), r.name].some((k) => k.toLowerCase() === key)) ?? null;
        res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300" });
        return res.end(badgeSvg(row, row?.name ?? badge[1]!, b.minGraded));
      }
      if (req.method === "GET" && path === "/v1/humans") {
        if (!evolution) return json(res, 404, { error: "no nursery on this node" });
        const w = url.searchParams.get("wallet");
        return json(res, 200, await humansView(enclosure.store, evolution.briefAt, w && SOLANA_ADDRESS.test(w) ? w : null));
      }
      if (req.method === "POST" && path === "/v1/humans/answer") {
        if (!evolution) return json(res, 404, { error: "no nursery on this node" });
        const body = (await readJson(req).catch(() => null)) as { guardian?: GuardianSession; answers?: unknown } | null;
        const check = verifyGuardian(body?.guardian as GuardianSession);
        if (!check.ok) return json(res, 401, { error: "sign in with your wallet first" });
        if (!(await isHolder(check.address))) return json(res, 403, { error: `hold ${HOLDER_MIN.toLocaleString("en-US")} $ZOOAGENCY to play` });
        const result = await submitAnswers(enclosure.store, check.address, body?.answers, evolution.briefAt);
        return result.ok ? json(res, 200, result) : json(res, result.status, { error: result.reason });
      }
      if (req.method === "GET" && path === "/v1/gene") {
        if (!evolution) return json(res, 404, { error: "no nursery on this node" });
        const w = url.searchParams.get("wallet");
        return json(res, 200, await geneView(enclosure.store, evolution.briefAt, w && SOLANA_ADDRESS.test(w) ? w : null));
      }
      if (req.method === "POST" && (path === "/v1/gene/vote" || path === "/v1/gene/name")) {
        if (!evolution) return json(res, 404, { error: "no nursery on this node" });
        const body = (await readJson(req).catch(() => null)) as { guardian?: GuardianSession; pick?: unknown; name?: unknown } | null;
        const check = verifyGuardian(body?.guardian as GuardianSession);
        if (!check.ok) return json(res, 401, { error: "sign in with your wallet first" });
        if (path === "/v1/gene/name") {
          const named = await nameNewborn(enclosure.store, check.address, String(body?.name ?? ""));
          return named.ok ? json(res, 200, named) : json(res, named.status, { error: named.reason });
        }
        // One vote per wallet, weighed by its balance; the week's close reads every balance again.
        const balance = await balanceOf(check.address);
        if (balance === null) return json(res, 503, { error: "could not read your balance, try again in a minute" });
        if (balance < VOTE_MIN) return json(res, 403, { error: `hold ${VOTE_MIN.toLocaleString("en-US")} $ZOOAGENCY to vote` });
        const week = weekOf(nightOf(Date.now(), evolution.briefAt));
        const cast = await castVote(enclosure.store, week, check.address, String(body?.pick ?? ""), balance);
        return cast.ok ? json(res, 200, { ok: true, weight: balance }) : json(res, cast.status, { error: cast.reason });
      }
      if (req.method === "GET" && path === "/v1/agent-of-the-week") {
        return weekly ? json(res, 200, await weekly()) : json(res, 404, { error: "no contest on this node" });
      }
      if (req.method === "GET" && path === "/v1/beaver/record") {
        return beaverHistory ? json(res, 200, await beaverHistory()) : json(res, 404, { error: "the beaver is not on this node" });
      }
      if (req.method === "GET" && path === "/v1/leaderboard") {
        return board ? json(res, 200, await board()) : json(res, 404, { error: "no leaderboard on this node" });
      }
      if (req.method === "GET" && path === "/v1/stats") {
        return stats ? json(res, 200, await stats()) : json(res, 404, { error: "no stats on this node" });
      }

      const passport = /^\/v1\/agents\/([a-z0-9-]+)$/.exec(path);
      if (req.method === "GET" && passport) {
        const found = passports?.get(passport[1]!);
        return found ? json(res, 200, found) : json(res, 404, { error: "no such agent" });
      }

      if (req.method === "GET" && path === "/v1/briefs") {
        return json(res, 200, briefs?.list() ?? []);
      }
      const brief = /^\/v1\/briefs\/(morning-brief-\d{4}-\d{2}-\d{2})$/.exec(path);
      if (req.method === "GET" && brief) {
        const entry = await briefs?.get(brief[1]!);
        return entry ? json(res, 200, entry) : json(res, 404, { error: "no such brief" });
      }

      const watchOf = /^\/v1\/watchlist\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      if (req.method === "GET" && watchOf) {
        if (!watchlist) return json(res, 404, { error: "no watchlist on this node" });
        return json(res, 200, { owner: watchOf[1], mints: (await enclosure.store.get<string[]>(`${WATCH_PREFIX}${watchOf[1]}`)) ?? [] });
      }
      if (req.method === "POST" && path === "/v1/watchlist") {
        if (!watchlist) return json(res, 404, { error: "no watchlist on this node" });
        const body = (await readJson(req)) as { guardian?: GuardianSession; mint?: string; action?: "add" | "remove" };
        const check = verifyGuardian(body.guardian as GuardianSession);
        if (!check.ok) return json(res, 401, { error: check.reason });
        if (typeof body.mint !== "string" || !SOLANA_ADDRESS.test(body.mint)) return json(res, 400, { error: "not a Solana token address" });
        const key = `${WATCH_PREFIX}${check.address}`;
        const current = (await enclosure.store.get<string[]>(key)) ?? [];
        let next = current;
        if (body.action === "remove") {
          next = current.filter((m) => m !== body.mint);
        } else if (!current.includes(body.mint)) {
          const cap = (await isHolder(check.address)) ? Math.max(watchlist.perGuardian, watchlist.perHolder ?? 10) : watchlist.perGuardian;
          if (current.length >= cap) {
            return json(res, 409, { error: `up to ${cap} tokens per guardian${cap === watchlist.perGuardian ? `; holders of $ZOOAGENCY watch ${watchlist.perHolder ?? 10}` : ""}` });
          }
          if (current.length === 0 && (await enclosure.store.keys(WATCH_PREFIX)).length >= watchlist.maxGuardians) {
            return json(res, 409, { error: "the watch is full, try again later" });
          }
          next = [...current, body.mint];
        }
        if (next.length) await enclosure.store.set(key, next);
        else await enclosure.store.delete(key);
        return json(res, 200, { owner: check.address, mints: next });
      }

      const visit = /^\/v1\/visitor\/wake\/([a-z0-9-]+)$/.exec(path);
      if (req.method === "POST" && visit) {
        const agent = visit[1]!;
        if (!visitor || !visitor.agents.includes(agent)) return json(res, 403, { error: "visitors cannot wake this agent" });
        const body = (await readJson(req)) as { guardian?: GuardianSession };
        let by = "visitor";
        let caller = clientIp(req);
        let callerLimit = visitorCooldown;
        if (body.guardian) {
          const check = verifyGuardian(body.guardian);
          if (!check.ok) return json(res, 401, { error: check.reason });
          by = `guardian:${check.address}`;
          caller = check.address;
          callerLimit = guardianCooldown;
        }
        const callerWait = callerLimit.wait(caller);
        if (callerWait > 0) return json(res, 429, { error: "slow down", retryAfterMs: callerWait });
        const agentWait = agentCooldown.wait(agent);
        if (agentWait > 0) return json(res, 429, { error: `${agent} was just woken`, retryAfterMs: agentWait });
        callerLimit.hit(caller);
        agentCooldown.hit(agent);
        void enclosure.wake(agent, { type: "manual", note: by });
        return json(res, 202, { woke: agent, by });
      }

      if (req.method === "GET" && path === "/v1/log") {
        const after = clampInt(url.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = clampInt(url.searchParams.get("limit"), 200, 1, 1000);
        return json(res, 200, await enclosure.log.since(after, limit));
      }

      if (req.method === "GET" && path === "/v1/artifacts/latest") {
        const latest = await latestArtifact(enclosure);
        return latest ? json(res, 200, latest) : json(res, 404, { error: "no artifact yet" });
      }

      if (req.method === "GET" && path === "/v1/stream") {
        if (streams.size >= MAX_STREAMS) return json(res, 503, { error: "too many live subscribers, retry shortly" });
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        // Resume from Last-Event-ID / ?after when given; otherwise replay only the most recent entries.
        const resume = req.headers["last-event-id"] ?? url.searchParams.get("after");
        const head = (await enclosure.log.head())?.seq ?? 0;
        const after = resume !== null && resume !== undefined
          ? clampInt(String(resume), 0, 0, Number.MAX_SAFE_INTEGER)
          : Math.max(0, head - STREAM_REPLAY);
        for (const entry of await enclosure.log.since(after, 1000)) {
          res.write(`id: ${entry.seq}\nevent: entry\ndata: ${JSON.stringify(entry)}\n\n`);
        }
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      }

      if (req.method === "GET" && path === "/v1/guests") {
        if (!guests) return json(res, 404, { error: "no guest enclosures on this node" });
        const scores = (await enclosure.store.get<Record<string, GuestTally>>(GUEST_SCORES)) ?? {};
        return json(res, 200, {
          policy: guests.policy,
          guests: guests.list().map((g) => {
            const score = scores[g.name];
            return { ...publicGuest(g), score: score ? { ...score, skill: skillOf(score) } : null };
          }),
        });
      }
      if (req.method === "GET" && path === "/v1/chain") {
        return json(res, 200, tape.status());
      }
      const chainToken = /^\/v1\/chain\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      if (req.method === "GET" && chainToken) {
        const found = tape.token(chainToken[1]!);
        return found ? json(res, 200, found) : json(res, 404, { error: "not on the stream" });
      }
      // The pre-trade check agents call before buying a pump.fun token: no model, answers in milliseconds.
      if (req.method === "GET" && path === "/v1/check/record") {
        if (tape.lastEventAt === 0) return json(res, 404, { error: "this node does not read the chain; use the north node" });
        if (!checkRecord || Date.now() - checkRecord.at > 10 * 60_000) checkRecord = { at: Date.now(), body: tape.checkRecord() };
        res.setHeader("cache-control", "public, max-age=300");
        return json(res, 200, checkRecord.body);
      }
      // A holder's key for the check: sign in with the wallet, get a key once. Only its hash is kept.
      if (req.method === "POST" && path === "/v1/check/key") {
        if (tape.lastEventAt === 0) return json(res, 404, { error: "this node does not read the chain; use the north node" });
        const body = (await readJson(req).catch(() => null)) as { guardian?: GuardianSession } | null;
        const signed = verifyGuardian(body?.guardian as GuardianSession);
        if (!signed.ok) return json(res, 401, { error: "sign in with your wallet first" });
        const wait = keyGate.take(signed.address);
        if (wait > 0) return json(res, 429, { error: "one new key a minute", retryAfterMs: wait });
        if (!(await isHolder(signed.address).catch(() => false))) {
          return json(res, 403, { error: `hold ${HOLDER_MIN.toLocaleString("en-US")} $ZOOAGENCY for a key; the free tier needs none`, min: HOLDER_MIN, mint: TOKEN_MINT });
        }
        const key = await issueKey(enclosure.store, signed.address);
        return json(res, 200, { key, wallet: signed.address, perMinute: HOLDER_PER_MIN, deepPerMinute: HOLDER_DEEP_PER_MIN, note: "shown once: keep it safe. A new key replaces this one." });
      }
      const checkOf = /^\/v1\/check\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      const xrayOf = /^\/v1\/xray\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      if (req.method === "GET" && (checkOf || xrayOf)) {
        if (tape.lastEventAt === 0) return json(res, 404, { error: "this node does not read the chain; use the north node" });
        // A key lifts the limits while its wallet still holds; without one, everyone gets the free tier.
        const key = keyFrom(req.headers, url.searchParams);
        let wallet: string | null = null;
        if (key) {
          wallet = await walletOfKey(enclosure.store, key);
          if (!wallet) return json(res, 401, { error: "unknown or replaced key" });
        }
        // The bot on a sibling node asks for all its users at once: it gets the holder allowance.
        const peer = fromPeer(req);
        const holder = peer || (wallet ? await holding.holds(wallet) : false);
        // Behind the site's proxy every caller shares its address, so the free gate keys on the first forwarded hop.
        const first = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
        const caller = peer ? "peer" : holder ? `key:${wallet}` : first || clientIp(req);
        // The x-ray reads Solana for holders and funders, so it always counts as a deep read.
        const deep = Boolean(xrayOf) || url.searchParams.get("holders") === "1";
        const tier = holder
          ? { tier: "holder" as const, perMinute: HOLDER_PER_MIN, deepPerMinute: HOLDER_DEEP_PER_MIN }
          : { tier: "free" as const, perMinute: FREE_PER_MIN, deepPerMinute: FREE_DEEP_PER_MIN };
        const wait = (holder ? holderGate : checkGate).take(caller) || (deep ? (holder ? holderDeepGate : deepGate).take(caller) : 0);
        if (wait > 0) {
          res.setHeader("retry-after", String(Math.ceil(wait / 1000)));
          const what = deep ? `${tier.deepPerMinute} deep reads` : `${tier.perMinute} checks`;
          return json(res, 429, { error: `slow down: ${what} a minute on the ${tier.tier} tier`, retryAfterMs: wait, access: tier, ...(holder ? {} : { more: "https://zooaiagency.com/connect#api" }) });
        }
        void usage.bump(deep, caller);
        const mint = (checkOf ?? xrayOf)![1]!;
        const stream = { live: tape.connected && Date.now() - tape.lastEventAt < 60_000, lastEventSecAgo: Math.round((Date.now() - tape.lastEventAt) / 1000) };
        let found = tape.token(mint);
        // Older than the tape: the long memory has what it saw of the token, as it stood when last written.
        const past = !found && history ? history.report(mint) : null;
        const within = <T>(p: Promise<T>, ms = 4_000) => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
        // Who holds it now and who paid for the creator cost RPC calls: holders only on request, never longer than four seconds.
        const pool = deep && found && holdersEnabled() ? tape.poolOf(mint) : null;
        const [holders, , poolSol] = await Promise.all([
          deep && (found || past) && holdersEnabled() ? within(holderReport(mint, fetch, Date.now(), found?.creator ?? past?.creator ?? null)) : Promise.resolve(undefined),
          deep && found && fundersEnabled() && !lineage.view(found.creator) ? within(lineage.trace(found.creator)) : Promise.resolve(null),
          // The pool's SOL as it is now, not as the last trade the tape saw left it.
          pool ? within(poolSolOf(pool)) : Promise.resolve(null),
        ]);
        if (poolSol !== null && poolSol !== undefined) {
          tape.notePoolSol(mint, poolSol);
          found = tape.token(mint);
        }
        let funding: LineageView | null | undefined;
        if (found && fundersEnabled()) {
          funding = lineage.view(found.creator);
          if (!funding) lineage.enqueue(found.creator, true);
        }
        if (past) funding = (fundersEnabled() ? lineage.view(past.creator) : null) ?? (past.funder ? { creator: past.creator, funder: past.funder, funderIsHot: exchangeOf(past.funder) != null, funderLabel: exchangeOf(past.funder), siblings: [], siblingLaunches48h: 0, siblingDumped48h: 0, tracedAt: past.recordedAt } : null);
        const linked = found || past ? socials.forMint(mint) : [];
        const check = checkToken(mint, found ?? past, { stream, ...(deep && (found || past) ? { holders: holders ?? null } : {}), ...(funding !== undefined ? { lineage: funding } : {}), socials: linked });
        res.setHeader("cache-control", "no-store");
        const memory = past ? { fromHistory: true, historySince: history!.since(), recordedAt: past.recordedAt } : {};
        const image = socials.image(mint);
        if (!image) socials.want(mint);
        // Launched before the stream's window: read where it came from, who holds it now and its dev's kept record,
        // only for a full X-Ray (or ?holders=1), which has its own rate limit, so plain checks cost no RPC calls.
        if (!found && !past && deep && holdersEnabled()) {
          const origin = await within(originOf(mint), 6_000);
          if (origin) {
            const holdersNow = await within(holderReport(mint, fetch, Date.now(), origin.creator));
            const kept = history?.wallet(origin.creator, 20) ?? null;
            const dev = kept ? { launches: kept.launches, dumped: kept.dumped } : null;
            const outside = outsideCheck(mint, { symbol: origin.symbol, createdAt: origin.createdAt, holders: holdersNow, dev }, { stream });
            let funded: LineageView | null = null;
            if (fundersEnabled()) {
              funded = lineage.view(origin.creator);
              if (!funded) lineage.enqueue(origin.creator, true);
            }
            if (checkOf) return json(res, 200, { ...outside, ...(image ? { image } : {}), outsideStream: true, createdAt: origin.createdAt, access: tier });
            return json(res, 200, {
              mint,
              symbol: origin.symbol ?? "",
              name: origin.name ?? "",
              creator: origin.creator,
              createdAt: origin.createdAt,
              check: outside,
              early: [],
              creatorRecord: null,
              devHistory: kept ? { launches: kept.launches, dumped: kept.dumped, tokens: kept.tokens.slice(0, 8) } : null,
              funding: funded,
              bundle: { wallets: [], funding: null },
              socials: [],
              outsideStream: true,
              access: tier,
            });
          }
        }
        if (checkOf) return json(res, 200, { ...check, ...(image ? { image } : {}), ...memory, access: tier });
        if (past) {
          const bundle = past.bundle.length >= 2 ? await within(traceFunders(mint, past.bundle.map((b) => b.wallet))) : null;
          return json(res, 200, {
            mint,
            symbol: past.symbol,
            name: past.name,
            creator: past.creator,
            createdAt: past.createdAt,
            check,
            early: past.early,
            creatorRecord: preferHistory(past.creatorRecord, past.creator),
            funding: funding ?? null,
            bundle: { wallets: past.bundle, funding: bundle },
            socials: linked,
            ...memory,
            access: tier,
          });
        }
        if (!found) return json(res, 404, { error: history ? "not a launch the stream saw (pump.fun, LaunchLab, Meteora)" : "not a launch the stream saw in the last two days (pump.fun, LaunchLab, Meteora)", check });
        const bundle = found.bundle.length >= 2 ? await within(traceFunders(found.mint, found.bundle.map((b) => b.wallet))) : null;
        return json(res, 200, {
          mint,
          symbol: found.symbol,
          name: found.name,
          creator: found.creator,
          createdAt: found.createdAt,
          check,
          early: tape.earlyOf(mint),
          creatorRecord: preferHistory(found.creatorRecord, found.creator),
          funding: funding ?? null,
          bundle: { wallets: found.bundle, funding: bundle },
          socials: linked,
          access: tier,
        });
      }
      const creatorOf = /^\/v1\/chain\/creator\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      if (req.method === "GET" && creatorOf) {
        const found = preferHistory(tape.creator(creatorOf[1]!), creatorOf[1]!);
        return found ? json(res, 200, found) : json(res, 404, { error: "no launches from this wallet in the last two days" });
      }
      // The wallet dossier from the long memory: what it did as a dev, a first-second buyer, a bundler and a crew member.
      const dossierOf = /^\/v1\/wallet\/([1-9A-HJ-NP-Za-km-z]{32,44})\/history$/.exec(path);
      if (req.method === "GET" && dossierOf) {
        if (!history) return json(res, 404, { error: "this node keeps no chain history; use the north node" });
        const caller = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() || clientIp(req);
        const wait = fromPeer(req) ? 0 : checkGate.take(caller);
        if (wait > 0) return json(res, 429, { error: "slow down: too many lookups a minute on the free tier", retryAfterMs: wait });
        const found = history.wallet(dossierOf[1]!, clampInt(url.searchParams.get("limit"), 50, 1, 200));
        if (!found) return json(res, 404, { error: "this wallet did not launch, snipe or bundle a launch the zoo has kept" });
        res.setHeader("cache-control", "no-store");
        return json(res, 200, { ...found, historySince: history.since(), keptDays: 90 });
      }
      const sniperOf = /^\/v1\/chain\/sniper\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      if (req.method === "GET" && sniperOf) {
        const found = tape.sniper(sniperOf[1]!);
        return found ? json(res, 200, found) : json(res, 404, { error: "this wallet sniped no launch in the last two days" });
      }
      // One page per wallet: what it did as a dev, as a first-second buyer and as the one who pays for devs.
      const walletOf = /^\/v1\/wallet\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      if (req.method === "GET" && walletOf) {
        const w = walletOf[1]!;
        const caller = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() || clientIp(req);
        const wait = fromPeer(req) ? 0 : checkGate.take(caller);
        if (wait > 0) return json(res, 429, { error: "slow down: too many lookups a minute on the free tier", retryAfterMs: wait });
        const dev = tape.creatorProfile(w);
        let funding: LineageView | null = null;
        if (dev && fundersEnabled()) {
          funding = lineage.view(w);
          if (!funding) lineage.enqueue(w, true);
        }
        const funded = lineage.funded(w);
        const sniper = tape.sniper(w);
        // The accounts this dev's own tokens link to in their metadata: typed by the dev, so a lead, not proof of who it is.
        const seen = new Set<string>();
        const accounts = dev
          ? dev.launches.flatMap((l) => socials.forMint(l.mint)).filter((a) => !seen.has(a.social.url) && seen.add(a.social.url)).slice(0, 10)
          : [];
        if (!dev && !sniper && !funded.creators.length) return json(res, 404, { error: "this wallet did not launch, snipe or fund a launch the stream saw in the last two days" });
        res.setHeader("cache-control", "no-store");
        return json(res, 200, { wallet: w, dev, funding, funded, sniper, accounts, checkedAt: Date.now() });
      }
      const bundleOf = /^\/v1\/chain\/bundle\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      if (req.method === "GET" && bundleOf) {
        const t = tape.token(bundleOf[1]!);
        if (!t) return json(res, 404, { error: "not on the stream" });
        const funding = t.bundle.length >= 2 ? await traceFunders(t.mint, t.bundle.map((b) => b.wallet)) : null;
        return json(res, 200, { mint: t.mint, bundleWallets: t.facts.bundleWallets, bundleShare: t.facts.bundleShare, wallets: t.bundle, funding, fundingEnabled: fundersEnabled() });
      }
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
      if (req.method === "GET" && path === "/v1/chain/funding") {
        res.setHeader("cache-control", "public, max-age=60");
        return json(res, 200, lineage.funderStats());
      }
      if (req.method === "GET" && path === "/v1/chain/ruggers") {
        return json(res, 200, { hours: 48, ruggers: tape.ruggers(clampInt(url.searchParams.get("limit"), 20, 1, 50)) });
      }
      if (req.method === "GET" && path === "/v1/chain/clean") {
        const wide = url.searchParams.get("wide") === "1";
        return json(res, 200, { keptMinutes: wide ? [15, 360] : [10, 180], launches: tape.clean(clampInt(url.searchParams.get("limit"), 20, 1, 50), Date.now(), wide) });
      }
      if (req.method === "POST" && path === "/v1/tg/link") {
        if (!process.env.TELEGRAM_BOT_TOKEN) return json(res, 404, { error: "no telegram bot on this node" });
        const body = (await readJson(req).catch(() => null)) as { guardian?: GuardianSession } | null;
        const check = verifyGuardian(body?.guardian as GuardianSession);
        if (!check.ok) return json(res, 401, { error: "sign in with your wallet first" });
        return json(res, 200, { code: await linkCode(enclosure.store, check.address), holder: await isHolder(check.address) });
      }
      if (req.method === "POST" && path === "/v1/tg/watch") {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token || !asks) return json(res, 404, { error: "no telegram bot on this node" });
        const body = (await readJson(req).catch(() => null)) as { initData?: string; mint?: string } | null;
        const user = verifyInitData(String(body?.initData ?? ""), token);
        if (user === null) return json(res, 401, { error: "open this from the Telegram bot" });
        if (typeof body?.mint !== "string" || !SOLANA_ADDRESS.test(body.mint)) return json(res, 400, { error: "not a Solana token address" });
        // In a private chat with the bot the chat id is the user id, so alerts land there.
        const result = await setWatch(enclosure.store, user, body.mint, true);
        return result.ok ? json(res, 200, { ok: true }) : json(res, 409, { error: result.reason });
      }
      if (req.method === "POST" && path === "/v1/ask") {
        if (!asks) return json(res, 404, { error: "the beaver is not on this node" });
        const body = (await readJson(req).catch(() => null)) as { mint?: unknown; guardian?: GuardianSession } | null;
        // A signed-in wallet that holds $ZOOAGENCY asks on its own, larger allowance.
        let who = clientIp(req);
        if (body?.guardian) {
          const check = verifyGuardian(body.guardian);
          if (check.ok && (await isHolder(check.address))) who = `holder:${check.address}`;
        }
        const result = await asks.ask(body?.mint, who);
        return result.ok ? json(res, 200, { ask: result.ask, reused: result.reused }) : json(res, result.status, { error: result.reason });
      }
      const askOf = /^\/v1\/ask\/([0-9a-f]{10})$/.exec(path);
      if (req.method === "GET" && askOf) {
        if (!asks) return json(res, 404, { error: "the beaver is not on this node" });
        const found = await asks.get(askOf[1]!);
        return found ? json(res, 200, found) : json(res, 404, { error: "no such question" });
      }
      const holderOf = /^\/v1\/holder\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      if (req.method === "GET" && holderOf) {
        const balance = await balanceOf(holderOf[1]!);
        return json(res, 200, { wallet: holderOf[1], balance, min: HOLDER_MIN, holder: (balance ?? 0) >= HOLDER_MIN, mint: TOKEN_MINT });
      }
      if (req.method === "GET" && path === "/v1/asks") {
        if (!asks) return json(res, 404, { error: "the beaver is not on this node" });
        return json(res, 200, await asks.recent(clampInt(url.searchParams.get("limit"), 24, 1, 100)));
      }
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
      // The koi's record and tonight's picks; it lives where the nursery does.
      if (req.method === "GET" && path === "/v1/koi") {
        if (!evolution) return json(res, 404, { error: "no koi on this node" });
        return json(res, 200, await koiView(enclosure.store, evolution.briefAt));
      }
      if (req.method === "GET" && path === "/v1/evolution") {
        if (!evolution) return json(res, 404, { error: "no nursery on this node" });
        const view = await evolutionView(enclosure.store, evolution.briefAt);
        return view ? json(res, 200, view) : json(res, 404, { error: "no nursery on this node" });
      }
      const creatureOf = /^\/v1\/evolution\/(c\d{1,6})$/.exec(path);
      if (req.method === "GET" && creatureOf) {
        const view = await creatureView(enclosure.store, creatureOf[1]!);
        return view ? json(res, 200, view) : json(res, 404, { error: "no such creature" });
      }
      const reportsOf = /^\/v1\/guests\/([a-z0-9-]+)\/reports$/.exec(path);
      if (req.method === "GET" && reportsOf) {
        if (!guests?.get(reportsOf[1]!)) return json(res, 404, { error: "no such guest" });
        return json(res, 200, { guest: reportsOf[1], nights: await guestRecord(enclosure.store, reportsOf[1]!) });
      }
      const guestOf = /^\/v1\/guests\/([a-z0-9-]+)$/.exec(path);
      if (req.method === "GET" && guestOf) {
        const found = guests?.get(guestOf[1]!);
        return found ? json(res, 200, publicGuest(found)) : json(res, 404, { error: "no such guest" });
      }
      if (req.method === "POST" && path === "/v1/guests") {
        if (!guests) return json(res, 404, { error: "no guest enclosures on this node" });
        const result = await guests.register((await readJson(req)) as ZooEvent);
        return result.ok
          ? json(res, 200, { admitted: true, guest: publicGuest(result.value), notice: await guests.noticeFor(result.value) })
          : json(res, result.status, { admitted: false, reason: result.reason });
      }
      // Warden only: what every guest hears back from now on (an empty text stops it).
      if (req.method === "POST" && path === "/v1/guests/notice") {
        if (!authorized(req, adminToken)) return json(res, 401, { error: "warden token required" });
        if (!guests) return json(res, 404, { error: "no guest enclosures on this node" });
        const body = (await readJson(req)) as { text?: unknown };
        return json(res, 200, { notice: await guests.setNotice(typeof body.text === "string" ? body.text : "") });
      }
      const evict = /^\/v1\/guests\/([a-z0-9-]+)\/evict$/.exec(path);
      if (req.method === "POST" && evict) {
        if (!authorized(req, adminToken)) return json(res, 401, { error: "warden token required" });
        const body = (await readJson(req)) as { reason?: string };
        const gone = await guests?.evict(evict[1]!, body.reason ?? "evicted by warden");
        return gone ? json(res, 200, { evicted: evict[1] }) : json(res, 404, { error: "no such guest" });
      }

      if (req.method === "POST" && path === "/v1/events") {
        const event = (await readJson(req)) as ZooEvent;
        if (typeof event?.from?.node === "string" && isGuestNode(event.from.node)) {
          if (!guests) return json(res, 403, { accepted: false, reason: "no guest enclosures on this node" });
          const result = await guests.receive(event);
          // Every answer to a guest carries the zoo's message for the people behind it.
          const guest = guests.get(event.from.agent);
          const notice = guest ? await guests.noticeFor(guest) : null;
          return result.ok ? json(res, 200, { ...result.value, notice }) : json(res, result.status, { accepted: false, reason: result.reason, notice });
        }
        const result = await enclosure.deliver(event);
        return json(res, 200, result);
      }

      const wake = /^\/v1\/agents\/([a-z0-9-]+)\/wake$/.exec(path);
      if (req.method === "POST" && wake) {
        if (!authorized(req, adminToken)) return json(res, 401, { error: "warden token required" });
        void enclosure.wake(wake[1]!, { type: "manual", note: "warden" });
        return json(res, 202, { woke: wake[1] });
      }

      if (req.method === "POST" && path === "/v1/warden/retire") {
        if (!authorized(req, adminToken)) return json(res, 401, { error: "warden token required" });
        const body = (await readJson(req)) as { reason?: string };
        await enclosure.retire(body.reason ?? "retired by warden");
        return json(res, 200, { retired: true });
      }

      return json(res, 404, { error: "not found" });
    } catch (error) {
      return json(res, 400, { error: (error as Error).message });
    }
  });

  server.on("close", () => {
    clearInterval(heartbeat);
    for (const res of streams) res.end();
  });
  return server;
}

async function latestArtifact(enclosure: Enclosure): Promise<LogEntry | undefined> {
  let latest: LogEntry | undefined;
  let after = 0;
  for (;;) {
    const page = await enclosure.log.since(after, 1000);
    if (page.length === 0) return latest;
    for (const entry of page) if (entry.event.kind === "artifact") latest = entry;
    after = page[page.length - 1]!.seq;
  }
}

/**
 * The caller's IP for rate limiting. Behind a proxy the client controls the
 * left-most X-Forwarded-For values, so trust X-Real-IP or the right-most hop
 * (added by our own proxy) instead.
 */
/**
 * A sibling node on the private network (the bot on canyon asking north): no proxy in between, so no forwarding
 * headers, and a private source address. Anything from the internet comes through the platform's proxy with them.
 */
function fromPeer(req: IncomingMessage): boolean {
  if (req.headers["x-forwarded-for"] || req.headers["x-real-ip"]) return false;
  const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|f[cd][0-9a-f]{2}:)/i.test(ip);
}

function clientIp(req: IncomingMessage): string {
  const real = String(req.headers["x-real-ip"] ?? "").trim();
  if (real) return real;
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] || req.socket.remoteAddress || "unknown";
}

function authorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return false;
  const given = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function end(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}
