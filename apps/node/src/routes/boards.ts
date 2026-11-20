import type { IncomingMessage, ServerResponse } from "node:http";
import { type GuardianSession, verifyGuardian } from "../guardian.ts";
import { badgeSvg } from "../badge.ts";
import { humansView, submitAnswers } from "../humans.ts";
import { HOLDER_MIN, isHolder } from "../holders.ts";
import type { BoardRow } from "../stats.ts";
import { SOLANA_ADDRESS, readJson, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** The site's boards and both contests: badges, humans vs the odds model, agent of the week, leaderboard, buybacks, stats. */
export async function boardRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, stats, board, oddsHistory, weekly, contest, buybacks } = ctx;
  const badge = /^\/v1\/badge\/([A-Za-z0-9_.-]{1,64})\.svg$/.exec(path);
  if (req.method === "GET" && badge) {
    if (!board) return json(res, 404, { error: "no leaderboard on this node" });
    const b = (await board()) as { minGraded: number; rows: BoardRow[] };
    const key = badge[1]!.toLowerCase();
    const row = b.rows.find((r) => [r.id, r.id.replace(/^guest:/, ""), r.name].some((k) => k.toLowerCase() === key)) ?? null;
    res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300" });
    res.end(badgeSvg(row, row?.name ?? badge[1]!, b.minGraded));
    return true;
  }
  if (req.method === "GET" && path === "/v1/humans") {
    if (!contest) return json(res, 404, { error: "no contest on this node" });
    const w = url.searchParams.get("wallet");
    return json(res, 200, await humansView(enclosure.store, contest.briefAt, w && SOLANA_ADDRESS.test(w) ? w : null));
  }
  if (req.method === "POST" && path === "/v1/humans/answer") {
    if (!contest) return json(res, 404, { error: "no contest on this node" });
    const body = (await readJson(req).catch(() => null)) as { guardian?: GuardianSession; answers?: unknown } | null;
    const check = verifyGuardian(body?.guardian as GuardianSession);
    if (!check.ok) return json(res, 401, { error: "sign in with your wallet first" });
    if (!(await isHolder(check.address))) return json(res, 403, { error: `hold ${HOLDER_MIN.toLocaleString("en-US")} $ZOOAGENCY to play` });
    const result = await submitAnswers(enclosure.store, check.address, body?.answers, contest.briefAt);
    return result.ok ? json(res, 200, result) : json(res, result.status, { error: result.reason });
  }
  if (req.method === "GET" && path === "/v1/agent-of-the-week") {
    return weekly ? json(res, 200, await weekly()) : json(res, 404, { error: "no contest on this node" });
  }
  // The odds model's record on the nightly exam. /v1/beaver/record is its old address: the beaver judges no more.
  if (req.method === "GET" && (path === "/v1/odds/record" || path === "/v1/beaver/record")) {
    return oddsHistory ? json(res, 200, await oddsHistory()) : json(res, 404, { error: "no contest on this node" });
  }
  if (req.method === "GET" && path === "/v1/leaderboard") {
    return board ? json(res, 200, await board()) : json(res, 404, { error: "no leaderboard on this node" });
  }
  // The swap fee loop, run by run: fees in, the tenth that bought $ZOOAGENCY, the rest swept to the treasury.
  if (req.method === "GET" && path === "/v1/buybacks") {
    return buybacks ? json(res, 200, await buybacks()) : json(res, 404, { error: "no fee loop on this node" });
  }

  if (req.method === "GET" && path === "/v1/stats") {
    return stats ? json(res, 200, await stats()) : json(res, 404, { error: "no stats on this node" });
  }
  return false;
}
