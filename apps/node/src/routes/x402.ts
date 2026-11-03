import type { IncomingMessage, ServerResponse } from "node:http";
import { ROUTE, norm, clampInt, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** Pay per report over x402: the price list, the receipts and the paid reports. */
export async function x402Routes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { x402, serverAddress } = ctx;
  // x402: pay per report in USDC on Solana, no key and no account. The paid route sells the same report the free
  // one serves, fetched from this node over loopback (which carries the peer allowance), so free limits never apply.
  if (req.method === "GET" && path === "/v1/x402") return x402 ? json(res, 200, x402.info()) : json(res, 404, { error: "x402 is off on this node" });
  if (req.method === "GET" && path === "/v1/x402/receipts") {
    if (!x402) return json(res, 404, { error: "x402 is off on this node" });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, await x402.receipts(clampInt(url.searchParams.get("limit"), 50, 1, 200)));
  }
  const paid = ROUTE.x402.exec(path);
  if (req.method === "GET" && paid) {
    if (!x402) return json(res, 404, { error: "x402 is off on this node" });
    const [, routeId, raw] = paid as unknown as [string, string, string];
    const mint = norm(raw);
    const at = serverAddress();
    const port = at && typeof at === "object" ? at.port : 8787;
    const chain = url.searchParams.get("chain");
    await x402.handle(req, res, routeId, mint, async () => {
      const r = await fetch(`http://127.0.0.1:${port}/v1/${routeId}/${mint}${chain ? `?chain=${encodeURIComponent(chain)}` : ""}`, { signal: AbortSignal.timeout(20_000) });
      return { status: r.status, body: await r.text() };
    });
    return true;
  }
  return false;
}
