import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "./http.ts";
import type { RouteContext } from "./context.ts";
import { CalloutFeed, FomoTheses } from "../chain/calls.ts";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
let feed: CalloutFeed | null = null;
let fomo: FomoTheses | null = null;

/** Started on the first request, so a node that never serves the X-Ray never polls the channel. */
function sources(): { feed: CalloutFeed | null; fomo: FomoTheses } {
  if (!fomo) {
    fomo = new FomoTheses((process.env.FOMO_API_KEY ?? "").trim(), Number(process.env.FOMO_DAILY_BUDGET) || 300);
    if (process.env.ZOO_CALLOUTS !== "off") {
      feed = new CalloutFeed(fetch, (m) => console.warn(m));
      feed.start();
    }
  }
  return { feed, fomo };
}

/** Who is calling a coin: pump.fun callouts and FOMO theses, for the X-Ray's "Who's calling it". */
export async function callRoutes(_ctx: RouteContext, req: IncomingMessage, res: ServerResponse, _url: URL, path: string): Promise<boolean> {
  if (req.method !== "GET" || !path.startsWith("/v1/calls/")) return false;
  const mint = path.slice("/v1/calls/".length);
  if (!MINT.test(mint)) return json(res, 400, { error: "not a token address" });
  const s = sources();
  const theses = await s.fomo.of(mint);
  return json(res, 200, {
    mint,
    callouts: s.feed?.of(mint) ?? [],
    calloutsSource: s.feed ? "pump.fun callouts, relayed by t.me/pumpfun_lp" : "off",
    theses: theses.theses,
    thesesStatus: theses.status,
  });
}
