import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRouteContext, type RouteContext, type ServerOptions } from "./routes/context.ts";
import { end, json } from "./routes/http.ts";
import { x402Routes } from "./routes/x402.ts";
import { logRoutes, nodeRoutes, rpcRoutes } from "./routes/misc.ts";
import { boardRoutes, evolutionRoutes } from "./routes/nursery.ts";
import { agentRoutes } from "./routes/agents.ts";
import { eventRoutes, guestListRoutes, guestRoutes } from "./routes/guests.ts";
import { cabalRoutes, chainBoardRoutes, chainReadRoutes, tapeRoutes } from "./routes/chain.ts";
import { checkRoutes } from "./routes/check.ts";
import { walletRoutes } from "./routes/wallets.ts";
import { callRoutes } from "./routes/calls.ts";
import { askRoutes } from "./routes/ask.ts";
import { guestWardenRoutes, wardenRoutes } from "./routes/warden.ts";

export type { ServerOptions, VisitorPolicy } from "./routes/context.ts";

type Route = (ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string) => Promise<boolean>;

/** Every route group in the order the node tries them; the first that handles a request answers it. */
const ROUTES: Route[] = [
  x402Routes,
  callRoutes,
  nodeRoutes,
  boardRoutes,
  agentRoutes,
  logRoutes,
  guestListRoutes,
  chainReadRoutes,
  checkRoutes,
  cabalRoutes,
  walletRoutes,
  chainBoardRoutes,
  askRoutes,
  tapeRoutes,
  evolutionRoutes,
  guestRoutes,
  guestWardenRoutes,
  rpcRoutes,
  eventRoutes,
  wardenRoutes,
];

export function createNodeServer(options: ServerOptions) {
  const ctx = createRouteContext(options, () => server.address());
  const { enclosure, corsOrigin, streams, usage } = ctx;
  enclosure.log.subscribe((entry) => {
    const frame = `id: ${entry.seq}\nevent: entry\ndata: ${JSON.stringify(entry)}\n\n`;
    for (const res of streams) res.write(frame);
  });

  const heartbeat = setInterval(() => {
    for (const res of streams) res.write(": ping\n\n");
  }, 20_000);
  heartbeat.unref();

  setInterval(() => void usage.flush(), 60_000).unref();

  const server = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", corsOrigin);
    res.setHeader("access-control-allow-headers", "content-type, authorization, solana-client, payment-signature");
    res.setHeader("access-control-expose-headers", "payment-required, payment-response, x-report-sha256, x402-charged");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return end(res, 204);

    const url = new URL(req.url ?? "/", "http://node");
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/health") return void json(res, 200, { ok: true });

      for (const route of ROUTES) if (await route(ctx, req, res, url, path)) return;

      return void json(res, 404, { error: "not found" });
    } catch (error) {
      // A malformed body is the caller's mistake; anything else is ours, and its details stay in the log.
      const message = (error as Error).message;
      if (message === "invalid JSON" || message === "body too large") return void json(res, 400, { error: message });
      console.error(`[server] ${req.method} ${path}: ${(error as Error).stack ?? message}`);
      if (!res.headersSent) return void json(res, 500, { error: "internal error" });
      res.end();
    }
  });

  server.on("close", () => {
    clearInterval(heartbeat);
    for (const res of streams) res.end();
  });
  return server;
}
