import type { Enclosure } from "@aiagentzoo/sdk";
import { type Call, type Playbook, previousNight, type Scorecard } from "./agents/judgement.ts";
import { nightOf } from "./agents/nightWatch.ts";
import type { GuestHouse } from "./guests.ts";

/** The numbers the site shows up top, read from the canyon's state. */
export function canyonStats(enclosure: Enclosure, briefAt: string, model: string | null, guests?: GuestHouse) {
  return async () => {
    const night = nightOf(Date.now(), briefAt);
    const obs = (await enclosure.store.get<Record<string, unknown>>(`obs:${night}`)) ?? {};
    const calls = (await enclosure.store.get<Call[]>(`calls:${night}`)) ?? [];
    const score = await enclosure.store.get<Scorecard>(`score:${previousNight(night)}`);
    const playbook = await enclosure.store.get<Playbook>("beaver:playbook");
    const all = guests?.list() ?? [];
    return {
      night,
      tokensTonight: Object.keys(obs).length,
      callsTonight: calls.length,
      modelCallsTonight: calls.filter((c) => c.by === "model").length,
      accuracy: score?.accuracy ?? null,
      scored: score ? score.hits + score.misses : 0,
      playbookVersion: playbook?.version ?? 0,
      guests: all.length,
      clawpumpGuests: all.filter((g) => g.platform === "clawpump").length,
      model,
    };
  };
}
