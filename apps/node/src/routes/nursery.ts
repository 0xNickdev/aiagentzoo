import type { IncomingMessage, ServerResponse } from "node:http";
import { type GuardianSession, verifyGuardian } from "../guardian.ts";
import { badgeSvg } from "../badge.ts";
import { humansView, submitAnswers } from "../humans.ts";
import { castVote, geneView, nameNewborn, VOTE_MIN } from "../gene.ts";
import { weekOf } from "../stats.ts";
import { nightOf } from "../agents/nightWatch.ts";
import { balanceOf, HOLDER_MIN, isHolder } from "../holders.ts";
import type { BoardRow } from "../stats.ts";
import { creatureView, evolutionView } from "../agents/evolution.ts";
import { koiView } from "../agents/koi.ts";
import { SOLANA_ADDRESS, readJson, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** The site's boards and the nursery's games: badges, humans, genes, contests, leaderboard, buybacks, stats. */
export async function boardRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, stats, board, beaverHistory, weekly, evolution, buybacks } = ctx;
  const badge = /^\/v1\/badge\/([A-Za-z0-9_.-]{1,64})\.svg$/.exec(path);
  if (req.method === "GET" && badge) {
    if (!board) return json(res, 404, { error: "no leaderboard on this node" });
    const b = (await board()) as { minGraded: number; rows: BoardRow[] };
    const key = badge[1]!.toLowerCase();
    const row = b.rows.find((r) => [r.id, r.id.replace(/^(guest|nursery):/, ""), r.name].some((k) => k.toLowerCase() === key)) ?? null;
    res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300" });
    res.end(badgeSvg(row, row?.name ?? badge[1]!, b.minGraded));
    return true;
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
  // The swap fee loop, run by run: fees in, the tenth that bought $ZOOAGENCY, the rest swept to the treasury.
  if (req.method === "GET" && path === "/v1/buybacks") {
    return buybacks ? json(res, 200, await buybacks()) : json(res, 404, { error: "no fee loop on this node" });
  }

  if (req.method === "GET" && path === "/v1/stats") {
    return stats ? json(res, 200, await stats()) : json(res, 404, { error: "no stats on this node" });
  }
  return false;
}

/** The koi and the nursery's creatures. */
export async function evolutionRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, evolution } = ctx;
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
  return false;
}
