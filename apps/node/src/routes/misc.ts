import type { IncomingMessage, ServerResponse } from "node:http";
import { isGuestNode } from "../guests.ts";
import { clampInt, json } from "./http.ts";
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

/** The public log: pages of it, and the live stream. */
export async function logRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, streams } = ctx;
  if (req.method === "GET" && path === "/v1/log") {
    const after = clampInt(url.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = clampInt(url.searchParams.get("limit"), 200, 1, 1000);
    return json(res, 200, await enclosure.log.since(after, limit));
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

/** What each retired public endpoint answers instead: 410 Gone with a short reason, so an old client fails clearly. */
const RETIRED: Array<[RegExp, string]> = [
  [/^\/v1\/(evolution|koi|gene)(\/.*)?$/, "the nursery, the koi and the gene vote were retired on 2026-11-20; the contests live on at /v1/humans and /v1/agent-of-the-week"],
  [/^\/v1\/(ask|asks)(\/.*)?$/, "ask the beaver was retired on 2026-11-20; use the x-ray at /v1/xray/<mint>"],
  [/^\/v1\/briefs(\/.*)?$/, "the Morning Brief was retired on 2026-11-20"],
  [/^\/v1\/artifacts(\/.*)?$/, "the brief's artifacts were retired on 2026-11-20"],
  [/^\/v1\/rpc$/, "the RPC forward was retired on 2026-11-20"],
];
/** A 0x address anywhere in a path: BNB Chain and Base were read until 2026-11-20, Solana only since. */
const EVM_IN_PATH = /\/0x[0-9a-fA-F]{40}(\/|$)/;

/** Retired endpoints and EVM addresses: a clear 410 instead of a 404 or a wrong answer. */
export async function goneRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  if (!path.startsWith("/v1/")) return false;
  if (EVM_IN_PATH.test(path)) return json(res, 410, { error: "Solana only: BNB Chain and Base are no longer read. Paste a Solana token or wallet address.", gone: true, chain: "solana" });
  for (const [pattern, reason] of RETIRED) if (pattern.test(path)) return json(res, 410, { error: reason, gone: true });
  return false;
}
