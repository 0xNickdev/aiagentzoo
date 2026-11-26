import type { IncomingMessage, ServerResponse } from "node:http";
import { type GuardianSession, verifyGuardian } from "../guardian.ts";
import { HOLDER_MIN, TOKEN_MINT } from "../holders.ts";
import { curveCap, FROZEN, PUBLIC_DELAY_MS, type Signal } from "../chain/radar.ts";
import { tape } from "../chain/pump.ts";
import { clampInt, clientIp, fromPeer, json, readJson } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** A signal as served, with where the coin stands now (the tape's cap; null once the tape has forgotten it). */
const withNow = (s: Signal) => {
  const f = tape.facts(s.mint);
  const cap = f ? (f.graduated ? tape.capNow(s.mint) : curveCap(f.curveSol)) : null;
  const capNow = cap == null ? null : Math.round(cap * 10) / 10;
  return { ...s, capNow, xNow: capNow == null ? null : Math.round((capNow / Math.max(s.capAtSignal, 1e-9)) * 100) / 100 };
};

/**
 * Who may see live signals: a sibling node (the bot on canyon), or a signed-in wallet holding the token.
 * The session comes in a POST body as everywhere else on the site, or for a GET as base64 JSON in `x-guardian`.
 */
async function access(req: IncomingMessage, guardian: GuardianSession | undefined, holds: (w: string) => Promise<boolean>): Promise<{ ok: true } | { ok: false; state: "sign-in" | "holders" }> {
  if (fromPeer(req)) return { ok: true };
  if (!guardian) return { ok: false, state: "sign-in" };
  const signed = verifyGuardian(guardian);
  if (!signed.ok) return { ok: false, state: "sign-in" };
  return (await holds(signed.address).catch(() => false)) ? { ok: true } : { ok: false, state: "holders" };
}

function guardianHeader(req: IncomingMessage): GuardianSession | undefined {
  const raw = req.headers["x-guardian"];
  if (typeof raw !== "string" || raw.length > 4096) return undefined;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as GuardianSession;
  } catch {
    return undefined;
  }
}

/**
 * GET or POST /v1/radar: the runner radar's signals and their record. Holders see signals the moment they fire;
 * everyone else gets 403 with the same list held back an hour, so the page still shows what the radar said and
 * what came of it. `delay` (minutes) asks for an older cut; it can only add to the public hour, never take from it.
 */
export async function radarRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  if (path !== "/v1/radar" || (req.method !== "GET" && req.method !== "POST")) return false;
  const radar = ctx.radar;
  if (!radar) return json(res, 404, { error: "this node does not run the radar; use the north node" });
  const peer = fromPeer(req);
  const wait = peer ? 0 : ctx.checkGate.take(clientIp(req));
  if (wait > 0) return json(res, 429, { error: "slow down", retryAfterMs: wait });
  const body = req.method === "POST" ? ((await readJson(req).catch(() => null)) as { guardian?: GuardianSession } | null) : null;
  const who = await access(req, body?.guardian ?? guardianHeader(req), (w) => ctx.holding.holds(w));
  const now = Date.now();
  const asked = clampInt(url.searchParams.get("delay"), 0, 0, 7 * 24 * 60) * 60_000;
  const delay = who.ok ? asked : Math.max(asked, PUBLIC_DELAY_MS);
  const limit = clampInt(url.searchParams.get("limit"), 200, 1, 2000);
  const since = clampInt(url.searchParams.get("since"), 0, 0, Number.MAX_SAFE_INTEGER);
  const signals = radar.signals(now, delay).filter((s) => s.at > since).slice(0, limit).map(withNow);
  const out = {
    access: who.ok ? "live" : "delayed",
    delayMin: Math.round(delay / 60_000),
    model: { frozenAt: FROZEN.frozenAt, tiers: { strong: "top 0.5% of the runner or graduation model", watch: "top 1% of either" } },
    stats: radar.stats(now),
    today: { scored: radar.scored.day === new Date(now).toISOString().slice(0, 10) ? radar.scored.n : 0, signals: radar.signals(now).filter((s) => s.at >= Date.parse(new Date(now).toISOString().slice(0, 10))).length },
    signals,
  };
  res.setHeader("cache-control", "no-store");
  if (who.ok) return json(res, 200, out);
  return json(res, 403, {
    error: who.state === "sign-in" ? "live signals are for holders: sign in with your wallet" : `live signals are for holders of ${HOLDER_MIN.toLocaleString("en-US")} $ZOOAGENCY`,
    state: who.state,
    min: HOLDER_MIN,
    mint: TOKEN_MINT,
    ...out,
  });
}
