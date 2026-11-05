import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "./http.ts";
import type { RouteContext } from "./context.ts";
import { join } from "node:path";
import { CalloutFeed, FomoTheses } from "../chain/calls.ts";
import { tape } from "../chain/pump.ts";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
let feed: CalloutFeed | null = null;
let fomo: FomoTheses | null = null;

/** Started on the first request, so a node that never serves the X-Ray never polls the channel. */
function sources(): { feed: CalloutFeed | null; fomo: FomoTheses } {
  if (!fomo) {
    fomo = new FomoTheses((process.env.FOMO_API_KEY ?? "").trim(), Number(process.env.FOMO_DAILY_CALLS) || 30);
    if (process.env.ZOO_CALLOUTS !== "off") {
      const dir = process.env.ZOO_DATA_DIR ?? join(process.cwd(), "data");
      feed = new CalloutFeed(fetch, (m) => console.warn(m), join(dir, "callouts.json"));
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
  // A young coin is read newest first; an older one by likes, where the theses that mattered sit.
  const age = tape.facts(mint, Date.now(), true)?.ageMin ?? Infinity;
  const theses = await s.fomo.of(mint, age < 120 ? "recent" : "likes");
  // Each caller's wallet against the tape: did it buy this coin, when, and has it sold out since.
  const callouts = (s.feed?.of(mint) ?? []).map((c) => {
    const b = c.wallet ? tape.buyerOf(mint, c.wallet) : null;
    return { ...c, walletBoughtAt: b?.at ?? null, walletSoldOut: b ? b.soldOut : null, walletSeen: !!b };
  });
  return json(res, 200, {
    mint,
    callouts,
    calloutsSource: s.feed ? "pump.fun callouts, relayed by t.me/pumpfun_lp" : "off",
    theses: theses.theses,
    thesesStatus: theses.status,
  });
}
