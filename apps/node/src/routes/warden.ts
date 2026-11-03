import type { IncomingMessage, ServerResponse } from "node:http";
import { lineage } from "../chain/lineage.ts";
import { replayMint } from "../chain/replay.ts";
import { authorized, readJson, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** Warden-only guest and memory routes: the guest notice, replays and evictions. */
export async function guestWardenRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { adminToken, guests, history } = ctx;
  // Warden only: what every guest hears back from now on (an empty text stops it).
  if (req.method === "POST" && path === "/v1/guests/notice") {
    if (!authorized(req, adminToken)) return json(res, 401, { error: "warden token required" });
    if (!guests) return json(res, 404, { error: "no guest enclosures on this node" });
    const body = (await readJson(req)) as { text?: unknown };
    return json(res, 200, { notice: await guests.setNotice(typeof body.text === "string" ? body.text : "") });
  }
  // Warden only: read a token the stream never saw from the chain into the long memory, so the X-Ray can read it.
  const replay = /^\/v1\/admin\/replay\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
  if (req.method === "POST" && replay) {
    if (!authorized(req, adminToken)) return json(res, 401, { error: "warden token required" });
    if (!history) return json(res, 404, { error: "no long memory on this node" });
    const q = url.searchParams;
    const hours = Math.min(48, Math.max(1, Number(q.get("hours")) || 6));
    const maxTxs = Math.min(40_000, Math.max(100, Number(q.get("max")) || 8_000));
    const log = (m: string) => console.log(`[replay] ${m}`);
    const run = replayMint(replay[1]!, history, { hours, maxTxs, funderOf: (c) => lineage.funderOf(c), log }).then(
      (r) => {
        log(`${replay[1]}: done ${JSON.stringify(r)}`);
        return r;
      },
      (error: unknown) => {
        log(`${replay[1]}: failed: ${error instanceof Error ? error.message : String(error)}`);
        return { error: "replay failed" };
      },
    );
    // A long replay outlives the caller's patience: ?wait=0 answers at once and the work goes on, logged.
    if (q.get("wait") === "0") return json(res, 202, { started: true, mint: replay[1], hours, maxTxs });
    const result = await run;
    return json(res, "error" in result ? 422 : 200, result);
  }
  const evict = /^\/v1\/guests\/([a-z0-9-]+)\/evict$/.exec(path);
  if (req.method === "POST" && evict) {
    if (!authorized(req, adminToken)) return json(res, 401, { error: "warden token required" });
    const body = (await readJson(req)) as { reason?: string };
    const gone = await guests?.evict(evict[1]!, body.reason ?? "evicted by warden");
    return gone ? json(res, 200, { evicted: evict[1] }) : json(res, 404, { error: "no such guest" });
  }
  return false;
}

/** Warden-only node routes: waking an agent and retiring the node. */
export async function wardenRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, adminToken } = ctx;
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
  return false;
}
