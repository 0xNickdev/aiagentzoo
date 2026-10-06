import type { Schedule } from "./agent.js";

const DAY = 24 * 60 * 60 * 1000;

/** Next time (ms since epoch) strictly after `from` that the schedule fires. */
export function nextRun(schedule: Schedule, from: number): number {
  if ("every" in schedule) {
    if (!(schedule.every >= 1000)) throw new Error("schedule.every must be at least 1000 ms");
    return from + schedule.every;
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(schedule.dailyAt);
  if (!match) throw new Error(`dailyAt "${schedule.dailyAt}" must be HH:MM`);
  const offset = (schedule.utcOffsetMinutes ?? 0) * 60_000;
  const minuteOfDay = Number(match[1]) * 60 + Number(match[2]);
  const localNow = from + offset;
  const dayStart = Math.floor(localNow / DAY) * DAY;
  let candidate = dayStart + minuteOfDay * 60_000;
  if (candidate <= localNow) candidate += DAY;
  return candidate - offset;
}
