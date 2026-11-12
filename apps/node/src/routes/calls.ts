import type { IncomingMessage, ServerResponse } from "node:http";
import { clampInt, json } from "./http.ts";
import type { RouteContext } from "./context.ts";
import { join } from "node:path";
import { CalloutFeed, FomoTheses } from "../chain/calls.ts";
import { CallerLedger, FOLLOW_MS, MIN_SETTLED } from "../chain/callers.ts";
import { solUsd } from "../chain/price.ts";
import { tape } from "../chain/pump.ts";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
let feed: CalloutFeed | null = null;
let fomo: FomoTheses | null = null;
let ledger: CallerLedger | null = null;

/** Started on the first request, so a node that never serves the X-Ray never polls the channel. */
function sources(): { feed: CalloutFeed | null; fomo: FomoTheses; ledger: CallerLedger | null } {
  if (!fomo) {
    fomo = new FomoTheses((process.env.FOMO_API_KEY ?? "").trim(), Number(process.env.FOMO_DAILY_CALLS) || 30);
    if (process.env.ZOO_CALLOUTS !== "off") {
      const dir = process.env.ZOO_DATA_DIR ?? join(process.cwd(), "data");
      feed = new CalloutFeed(fetch, (m) => console.warn(m), join(dir, "callouts.json"));
      feed.start();
      const calls = feed;
      // Each call set against the tape for the 24 hours after it: the caller's record is built from these.
      ledger = new CallerLedger(
        {
          callsSince: (since) => calls.since(since),
          look: (mint) => {
            const l = tape.callLook(mint);
            const usd = solUsd();
            return l ? { capUsd: l.capSol !== null && usd ? l.capSol * usd : null, alive: l.alive, dumpedAt: l.dumpedAt } : null;
          },
          buyer: (mint, wallet) => tape.buyerOf(mint, wallet),
          ready: () => solUsd() !== null && tape.live(Date.now()),
        },
        join(dir, "caller-outcomes.json"),
        (m) => console.warn(m),
      );
      ledger.start();
    }
  }
  return { feed, fomo, ledger };
}

/** The node that reads the chain follows calls from its first minute, not from the first reader. */
export function startCallers(): void {
  sources();
}

const SOURCE = "pump.fun callouts, relayed by t.me/pumpfun_lp";
const NOTE = "The wallet is the one pump.fun lists next to the caller. A call is followed for 24 hours on our tape; repeat calls on one coin are judged once.";

/** Who is calling a coin, and what happened after each caller's calls: the X-Ray's "Who's calling it" and Caller Truth. */
export async function callRoutes(_ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  if (req.method !== "GET") return false;
  if (path === "/v1/callers") {
    const s = sources();
    if (!s.ledger) return json(res, 200, { source: "off", callers: [] });
    const min = clampInt(url.searchParams.get("min"), MIN_SETTLED, 1, 100);
    const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
    const sort = url.searchParams.get("sort") ?? "settled";
    const all = s.ledger.records().filter((r) => r.settled >= min);
    const share = (n: number, of: number) => (of ? n / of : 0);
    const list = [...all];
    if (sort === "dead") list.sort((a, b) => share(b.dead, b.settled) - share(a.dead, a.settled) || b.settled - a.settled);
    else if (sort === "alive") list.sort((a, b) => share(a.dead, a.settled) - share(b.dead, b.settled) || b.settled - a.settled);
    else if (sort === "sold") list.sort((a, b) => b.soldWithinHour - a.soldWithinHour || b.settled - a.settled);
    else if (sort === "x") list.sort((a, b) => (b.medianX ?? -1) - (a.medianX ?? -1) || b.settled - a.settled);
    res.setHeader("cache-control", "public, max-age=60");
    return json(res, 200, { source: SOURCE, note: NOTE, followHours: FOLLOW_MS / 3_600_000, minSettled: min, ...s.ledger.coverage(), callers: list.slice(0, limit) });
  }
  if (path.startsWith("/v1/caller/")) {
    const wallet = path.slice("/v1/caller/".length);
    if (!MINT.test(wallet)) return json(res, 400, { error: "not a wallet address" });
    const s = sources();
    const calls = s.feed?.by(wallet) ?? [];
    if (!s.ledger || !calls.length) return json(res, 404, { error: "no callout by this wallet in the last 30 days" });
    res.setHeader("cache-control", "public, max-age=60");
    return json(res, 200, {
      source: SOURCE,
      note: NOTE,
      followHours: FOLLOW_MS / 3_600_000,
      since: s.ledger.since,
      record: s.ledger.recordOf(wallet),
      calls: calls.slice(0, 200).map((c) => ({ post: c.post, mint: c.mint, symbol: c.symbol, text: c.text, at: c.at, calledMcUsd: c.calledMcUsd, nth: c.nth, url: c.url, outcome: s.ledger!.outcomeOf(c.post) })),
    });
  }
  if (!path.startsWith("/v1/calls/")) return false;
  const mint = path.slice("/v1/calls/".length);
  if (!MINT.test(mint)) return json(res, 400, { error: "not a token address" });
  const s = sources();
  // A young coin is read newest first; an older one by likes, where the theses that mattered sit.
  const age = tape.facts(mint, Date.now(), true)?.ageMin ?? Infinity;
  const theses = await s.fomo.of(mint, age < 120 ? "recent" : "likes");
  // Each caller's wallet against the tape: did it buy this coin, when, and has it sold out since.
  const callouts = (s.feed?.of(mint) ?? []).map((c) => {
    const b = c.wallet ? tape.buyerOf(mint, c.wallet) : null;
    // What became of this caller's earlier calls, once enough of them have run their day.
    const r = c.wallet ? s.ledger?.recordOf(c.wallet) : null;
    return { ...c, walletBoughtAt: b?.at ?? null, walletSoldOut: b ? b.soldOut : null, walletExitAt: b?.exitAt ?? null, walletSeen: !!b, record: r && r.settled >= MIN_SETTLED ? r : null };
  });
  return json(res, 200, {
    mint,
    callouts,
    calloutsSource: s.feed ? SOURCE : "off",
    theses: theses.theses,
    thesesStatus: theses.status,
  });
}
