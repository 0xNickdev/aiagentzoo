import type { IncomingMessage, ServerResponse } from "node:http";
import { type GuardianSession, verifyGuardian } from "../guardian.ts";
import { WATCH_PREFIX } from "../agents/nightWatch.ts";
import { isHolder } from "../holders.ts";
import { SOLANA_ADDRESS, clientIp, readJson, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** Agent passports, Morning Briefs, guardian watchlists and the public wake button. */
export async function agentRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, passports, visitor, briefs, watchlist, agentCooldown, visitorCooldown, guardianCooldown } = ctx;
  const passport = /^\/v1\/agents\/([a-z0-9-]+)$/.exec(path);
  if (req.method === "GET" && passport) {
    const found = passports?.get(passport[1]!);
    return found ? json(res, 200, found) : json(res, 404, { error: "no such agent" });
  }

  if (req.method === "GET" && path === "/v1/briefs") {
    return json(res, 200, briefs?.list() ?? []);
  }
  const brief = /^\/v1\/briefs\/(morning-brief-\d{4}-\d{2}-\d{2})$/.exec(path);
  if (req.method === "GET" && brief) {
    const entry = await briefs?.get(brief[1]!);
    return entry ? json(res, 200, entry) : json(res, 404, { error: "no such brief" });
  }

  const watchOf = /^\/v1\/watchlist\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
  if (req.method === "GET" && watchOf) {
    if (!watchlist) return json(res, 404, { error: "no watchlist on this node" });
    return json(res, 200, { owner: watchOf[1], mints: (await enclosure.store.get<string[]>(`${WATCH_PREFIX}${watchOf[1]}`)) ?? [] });
  }
  if (req.method === "POST" && path === "/v1/watchlist") {
    if (!watchlist) return json(res, 404, { error: "no watchlist on this node" });
    const body = (await readJson(req)) as { guardian?: GuardianSession; mint?: string; action?: "add" | "remove" };
    const check = verifyGuardian(body.guardian as GuardianSession);
    if (!check.ok) return json(res, 401, { error: check.reason });
    if (typeof body.mint !== "string" || !SOLANA_ADDRESS.test(body.mint)) return json(res, 400, { error: "not a Solana token address" });
    const key = `${WATCH_PREFIX}${check.address}`;
    const current = (await enclosure.store.get<string[]>(key)) ?? [];
    let next = current;
    if (body.action === "remove") {
      next = current.filter((m) => m !== body.mint);
    } else if (!current.includes(body.mint)) {
      const cap = (await isHolder(check.address)) ? Math.max(watchlist.perGuardian, watchlist.perHolder ?? 10) : watchlist.perGuardian;
      if (current.length >= cap) {
        return json(res, 409, { error: `up to ${cap} tokens per guardian${cap === watchlist.perGuardian ? `; holders of $ZOOAGENCY watch ${watchlist.perHolder ?? 10}` : ""}` });
      }
      if (current.length === 0 && (await enclosure.store.keys(WATCH_PREFIX)).length >= watchlist.maxGuardians) {
        return json(res, 409, { error: "the watch is full, try again later" });
      }
      next = [...current, body.mint];
    }
    if (next.length) await enclosure.store.set(key, next);
    else await enclosure.store.delete(key);
    return json(res, 200, { owner: check.address, mints: next });
  }

  const visit = /^\/v1\/visitor\/wake\/([a-z0-9-]+)$/.exec(path);
  if (req.method === "POST" && visit) {
    const agent = visit[1]!;
    if (!visitor || !visitor.agents.includes(agent)) return json(res, 403, { error: "visitors cannot wake this agent" });
    const body = (await readJson(req)) as { guardian?: GuardianSession };
    let by = "visitor";
    let caller = clientIp(req);
    let callerLimit = visitorCooldown;
    if (body.guardian) {
      const check = verifyGuardian(body.guardian);
      if (!check.ok) return json(res, 401, { error: check.reason });
      by = `guardian:${check.address}`;
      caller = check.address;
      callerLimit = guardianCooldown;
    }
    const callerWait = callerLimit.wait(caller);
    if (callerWait > 0) return json(res, 429, { error: "slow down", retryAfterMs: callerWait });
    const agentWait = agentCooldown.wait(agent);
    if (agentWait > 0) return json(res, 429, { error: `${agent} was just woken`, retryAfterMs: agentWait });
    callerLimit.hit(caller);
    agentCooldown.hit(agent);
    void enclosure.wake(agent, { type: "manual", note: by });
    return json(res, 202, { woke: agent, by });
  }
  return false;
}
