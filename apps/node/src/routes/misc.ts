import type { IncomingMessage, ServerResponse } from "node:http";
import type { Enclosure, LogEntry } from "@aiagentzoo/sdk";
import { isGuestNode } from "../guests.ts";
import { fromPeer, clientIp, readJson, clampInt, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** Entries a fresh SSE subscriber receives before live updates. */
const STREAM_REPLAY = 150;
/** Open SSE connections per node; beyond this new subscribers get 503. */
const MAX_STREAMS = 500;

/** The node itself: who it is, its peers and feed, and its agents. */
export async function nodeRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, meta, guests } = ctx;
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
  return false;
}

/** The public log: pages of it, the latest artifact, and the live stream. */
export async function logRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, streams } = ctx;
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
    return true;
  }
  return false;
}

/** The swap's RPC forward. */
export async function rpcRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { corsOrigin, rpcGate } = ctx;
  // The site's swap needs a few plain RPC reads (lookup tables, balances, a signature's status); the public RPC
  // answers browsers with 403, so the node forwards these, and only these, to its own RPC. No key leaves the node.
  if (req.method === "POST" && path === "/v1/rpc") {
    const RPC_URL = process.env.SOLANA_RPC_URL ?? "";
    if (!RPC_URL) return json(res, 404, { error: "no RPC on this node" });
    // The node's own RPC quota is behind this route, so it has a gate of its own.
    const rpcWait = fromPeer(req) ? 0 : rpcGate.take(clientIp(req));
    if (rpcWait > 0) return json(res, 429, { error: "slow down", retryAfterMs: rpcWait });
    const body = (await readJson(req)) as { method?: unknown; params?: unknown; id?: unknown };
    const allowed = new Set(["getAddressLookupTable", "getTokenSupply", "getBalance", "getParsedTokenAccountsByOwner", "getTokenAccountsByOwner", "getSignatureStatuses", "getLatestBlockhash", "getAccountInfo", "getMultipleAccounts"]);
    if (typeof body?.method !== "string" || !allowed.has(body.method)) return json(res, 400, { error: "method not forwarded" });
    try {
      const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, method: body.method, params: body.params ?? [] }), signal: AbortSignal.timeout(10_000) });
      const text = await r.text();
      res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": corsOrigin });
      res.end(text);
      return true;
    } catch {
      return json(res, 502, { error: "the RPC did not answer" });
    }
  }
  return false;
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
