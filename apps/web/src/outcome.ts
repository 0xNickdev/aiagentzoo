import { t } from "./i18n";

/** One of a dev's launches as the node reports it. Records from before the dev's take was counted lack the optional ones. */
export interface LaunchOutcome {
  dumpedAfterMin: number | null;
  dumpedAfterSec?: number | null;
  devTookSol?: number | null;
  leftHolding?: number | null;
  alive?: boolean | null;
  graduated: boolean;
}

/** 40 -> 40s, 130 -> 2 min, 7300 -> 2 h. */
const span = (sec: number) => (sec < 120 ? `${sec}s` : sec < 2 * 3600 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)} h`);

/**
 * How a launch went for the people who bought it, in two parts: `head` (sold in 40s, graduated, dev holding) and
 * `tail` (took +1.3 SOL · 23 left holding · dead). "Dumped after 0 min" said nothing: nearly every dump is in the
 * first minute, so seconds, what the dev took and who was left holding tell launches apart.
 */
export function launchOutcome(x: LaunchOutcome): { head: string; tail: string; dumped: boolean } {
  const tail: string[] = [];
  let head: string;
  if (x.dumpedAfterMin !== null) {
    const sec = x.dumpedAfterSec ?? null;
    head = sec !== null ? t("sold in {s}", { s: span(sec) }) : x.dumpedAfterMin === 0 ? t("sold within a minute") : t("dumped after {m} min", { m: x.dumpedAfterMin });
    if (x.devTookSol !== null && x.devTookSol !== undefined && Math.abs(x.devTookSol) >= 0.05) {
      tail.push(x.devTookSol > 0 ? t("took +{n} SOL", { n: x.devTookSol.toFixed(x.devTookSol >= 10 ? 0 : 1) }) : t("sold at a loss"));
    }
    if (x.leftHolding) tail.push(t("{n} left holding", { n: x.leftHolding }));
  } else head = x.graduated ? t("graduated") : t("dev holding");
  if (x.alive === false) tail.push(t("dead"));
  return { head, tail: tail.join(" · "), dumped: x.dumpedAfterMin !== null };
}
