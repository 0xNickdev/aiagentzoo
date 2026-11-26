import type { IncomingMessage, ServerResponse } from "node:http";
import { checkBuild, realBuildDeps, type BuildDeps } from "../claims/build.ts";
import { claimsOf } from "../claims/claims.ts";
import { type GuardianSession, verifyGuardian } from "../guardian.ts";
import { HOLDER_MIN, TOKEN_MINT } from "../holders.ts";
import { clientIp, fromPeer, json, readJson, route } from "./http.ts";
import type { RouteContext } from "./context.ts";

const PATH = route("/v1/claims/ADDR");
const BUILD = route("/v1/claims/ADDR/build");

/** Who may ask for a build check: a sibling node, or a signed-in wallet that holds the token. Pro, once it opens, joins here. */
export async function buildCaller(req: IncomingMessage, body: { guardian?: GuardianSession } | null, holds: (wallet: string) => Promise<boolean>): Promise<{ ok: true; caller: string } | { ok: false; status: number; body: object }> {
  if (fromPeer(req)) return { ok: true, caller: "peer" };
  const signed = verifyGuardian(body?.guardian as GuardianSession);
  if (!signed.ok) return { ok: false, status: 401, body: { error: "sign in with your wallet first", state: "sign-in" } };
  if (!(await holds(signed.address).catch(() => false))) return { ok: false, status: 403, body: { error: `the code check is for holders of ${HOLDER_MIN.toLocaleString("en-US")} $ZOOAGENCY`, state: "holders", min: HOLDER_MIN, mint: TOKEN_MINT } };
  return { ok: true, caller: `wallet:${signed.address}` };
}

/**
 * The GitHub a token links to and whether its DexScreener profile is paid. It opens pages strangers chose, so it runs
 * only on the marsh, the node that holds no wallet and no paid keys.
 */
export async function claimsRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, _url: URL, path: string, buildDeps: () => BuildDeps = realBuildDeps): Promise<boolean> {
  const buildOf = req.method === "POST" ? BUILD.exec(path)?.[1] : undefined;
  const mint = req.method === "GET" ? PATH.exec(path)?.[1] : undefined;
  if (!mint && !buildOf) return false;
  if (process.env.ZOO_ROLE !== "marsh") return json(res, 404, { error: "this node does not read claims; use the marsh node" });
  const wait = fromPeer(req) ? 0 : ctx.checkGate.take(clientIp(req));
  if (wait > 0) return json(res, 429, { error: "slow down", retryAfterMs: wait });
  if (buildOf) {
    const body = (await readJson(req).catch(() => null)) as { guardian?: GuardianSession } | null;
    const who = await buildCaller(req, body, (w) => ctx.holding.holds(w));
    if (!who.ok) return json(res, who.status, who.body);
    const r = await checkBuild(buildOf, who.caller, buildDeps());
    if ("error" in r) return json(res, r.state === "limit" ? 429 : r.state === "busy" || r.state === "unread" || r.state === "off" ? 503 : r.state === "failed" ? 502 : 422, r);
    return json(res, 200, r);
  }
  const claims = await claimsOf(mint!);
  if (!claims) return json(res, 503, { error: "busy, try again in a minute" });
  res.setHeader("cache-control", "public, max-age=60");
  return json(res, 200, claims);
}
