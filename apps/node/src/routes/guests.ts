import type { IncomingMessage, ServerResponse } from "node:http";
import type { ZooEvent } from "@aiagentzoo/sdk";
import { GUEST_SCORES, guestRecord } from "../agents/nightWatch.ts";
import { type GuestTally, skillOf } from "../agents/judgement.ts";
import { isGuestNode, publicGuest } from "../guests.ts";
import { readJson, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** The guest enclosures and their scores. */
export async function guestListRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, guests } = ctx;
  if (req.method === "GET" && path === "/v1/guests") {
    if (!guests) return json(res, 404, { error: "no guest enclosures on this node" });
    const scores = (await enclosure.store.get<Record<string, GuestTally>>(GUEST_SCORES)) ?? {};
    return json(res, 200, {
      policy: guests.policy,
      guests: guests.list().map((g) => {
        const score = scores[g.name];
        return { ...publicGuest(g), score: score ? { ...score, skill: skillOf(score) } : null };
      }),
    });
  }
  return false;
}

/** One guest: its page, its reports, and registering a new one. */
export async function guestRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, guests } = ctx;
  const reportsOf = /^\/v1\/guests\/([a-z0-9-]+)\/reports$/.exec(path);
  if (req.method === "GET" && reportsOf) {
    if (!guests?.get(reportsOf[1]!)) return json(res, 404, { error: "no such guest" });
    return json(res, 200, { guest: reportsOf[1], nights: await guestRecord(enclosure.store, reportsOf[1]!) });
  }
  const guestOf = /^\/v1\/guests\/([a-z0-9-]+)$/.exec(path);
  if (req.method === "GET" && guestOf) {
    const found = guests?.get(guestOf[1]!);
    return found ? json(res, 200, publicGuest(found)) : json(res, 404, { error: "no such guest" });
  }
  if (req.method === "POST" && path === "/v1/guests") {
    if (!guests) return json(res, 404, { error: "no guest enclosures on this node" });
    const result = await guests.register((await readJson(req)) as ZooEvent);
    return result.ok
      ? json(res, 200, { admitted: true, guest: publicGuest(result.value), notice: await guests.noticeFor(result.value) })
      : json(res, result.status, { admitted: false, reason: result.reason });
  }
  return false;
}

/** Events from peers and guests. */
export async function eventRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, guests } = ctx;
  if (req.method === "POST" && path === "/v1/events") {
    const event = (await readJson(req)) as ZooEvent;
    if (typeof event?.from?.node === "string" && isGuestNode(event.from.node)) {
      if (!guests) return json(res, 403, { accepted: false, reason: "no guest enclosures on this node" });
      const result = await guests.receive(event);
      // Every answer to a guest carries the zoo's message for the people behind it.
      const guest = guests.get(event.from.agent);
      const notice = guest ? await guests.noticeFor(guest) : null;
      return result.ok ? json(res, 200, { ...result.value, notice }) : json(res, result.status, { accepted: false, reason: result.reason, notice });
    }
    const result = await enclosure.deliver(event);
    return json(res, 200, result);
  }
  return false;
}
