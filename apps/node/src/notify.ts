import { createEvent, type Enclosure, signEvent } from "@aiagentzoo/sdk";
import { previousNight, type Scorecard, skillOf } from "./agents/judgement.ts";
import { nightOf } from "./agents/nightWatch.ts";
import type { GuestHouse } from "./guests.ts";

/**
 * Tells guests their calls were graded, at the webhook they registered. The re-check arrives in batches, so a
 * guest hears again whenever more of its calls are graded; a failed delivery is retried on the next round.
 * Each message is a `guest.graded` event signed by this node, so the guest can check it came from the zoo.
 */
export async function notifyGraded(enclosure: Enclosure, guests: GuestHouse, briefAt: string, now = Date.now(), post: typeof fetch = fetch): Promise<number> {
  const night = previousNight(nightOf(now, briefAt));
  const score = await enclosure.store.get<Scorecard>(`score:${night}`);
  if (!score?.guestCases) return 0;
  let sent = 0;
  for (const guest of guests.list()) {
    const cases = score.guestCases[guest.name]?.filter((c) => c.hit !== null);
    if (!guest.webhook || !cases?.length) continue;
    const key = `notified:${guest.name}:${night}`;
    if (((await enclosure.store.get<number>(key)) ?? 0) >= cases.length) continue;
    const tally = score.guests[guest.name];
    const event = signEvent(
      createEvent({
        kind: "system",
        type: "guest.graded",
        from: { node: enclosure.node.id, agent: "warden" },
        to: { node: `${guest.name}.guest`, agent: guest.name },
        payload: {
          guest: guest.name,
          night,
          hits: tally?.hits ?? 0,
          misses: tally?.misses ?? 0,
          skill: tally ? skillOf(tally) : null,
          cases: cases.map(({ mint, symbol, verdict, outcome, hit }) => ({ mint, symbol, verdict, outcome, hit })),
          notice: await guests.noticeFor(guest),
        },
      }),
      enclosure.node.identity,
    );
    try {
      const res = await post(guest.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event), redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (!res.ok) continue;
      await enclosure.store.set(key, cases.length);
      sent += 1;
    } catch {
      // Unreachable for now: the next round tries again.
    }
  }
  return sent;
}
