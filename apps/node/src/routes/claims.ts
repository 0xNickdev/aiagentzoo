import type { IncomingMessage, ServerResponse } from "node:http";
import { claimsOf } from "../claims/claims.ts";
import { clientIp, fromPeer, json, route } from "./http.ts";
import type { RouteContext } from "./context.ts";

const PATH = route("/v1/claims/ADDR");

/**
 * The GitHub a token links to and whether its DexScreener profile is paid. It opens pages strangers chose, so it runs
 * only on the marsh, the node that holds no wallet and no paid keys.
 */
export async function claimsRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, _url: URL, path: string): Promise<boolean> {
  const mint = req.method === "GET" ? PATH.exec(path)?.[1] : undefined;
  if (!mint) return false;
  if (process.env.ZOO_ROLE !== "marsh") return json(res, 404, { error: "this node does not read claims; use the marsh node" });
  const wait = fromPeer(req) ? 0 : ctx.checkGate.take(clientIp(req));
  if (wait > 0) return json(res, 429, { error: "slow down", retryAfterMs: wait });
  const claims = await claimsOf(mint);
  if (!claims) return json(res, 503, { error: "busy, try again in a minute" });
  res.setHeader("cache-control", "public, max-age=60");
  return json(res, 200, claims);
}
