import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Enclosure, LogEntry, ZooEvent } from "@aiagentzoo/sdk";
import { Cooldown, type GuardianSession, verifyGuardian } from "./guardian.ts";
import type { PassportIndex } from "./passport.ts";
import type { BriefIndex } from "./briefs.ts";
import { WATCH_PREFIX } from "./agents/nightWatch.ts";

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
  watchlist?: { perGuardian: number; maxGuardians: number };
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

export function createNodeServer({ enclosure, adminToken, corsOrigin = "*", meta = {}, passports, visitor, briefs, watchlist }: ServerOptions) {
  const agentCooldown = new Cooldown(visitor?.agentCooldownMs ?? 0);
  const visitorCooldown = new Cooldown(visitor?.visitorCooldownMs ?? 0);
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
          peers: enclosure.peers.list().map(({ id, url: peerUrl, publicKey }) => ({ id, url: peerUrl, publicKey })),
          feed: ledger
            ? {
                keeper: ledger.balance(enclosure.keeper),
                stake: ledger.stakeOf(enclosure.node.id),
                burned: ledger.burned(),
                params: ledger.params,
              }
            : null,
          ...meta,
        });
      }

      if (req.method === "GET" && path === "/v1/agents") return json(res, 200, enclosure.snapshot());

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
          if (current.length >= watchlist.perGuardian) return json(res, 409, { error: `up to ${watchlist.perGuardian} tokens per guardian` });
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

      if (req.method === "POST" && path === "/v1/events") {
        const event = (await readJson(req)) as ZooEvent;
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
