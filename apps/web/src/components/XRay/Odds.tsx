import OddsGauge from "../OddsGauge";
import { Check, X } from "lucide-react";
import { t } from "../../i18n";
import type { Odds } from "./types";

export const hoursOf = (min: number) => (min < 120 ? t("{m} min", { m: min }) : t("{h} h", { h: Math.round(min / 60) }));

export const pctOdds = (p: number) => (p >= 0.1 ? `${Math.round(p * 100)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : p > 0 ? "<1%" : "0%");
export const timesAvg = (x: number) => (x < 0.1 ? "<0.1×" : `${x}×`);

/** The run odds as a pill: moss when it beats the average launch twice over, plain otherwise. */
export function OddsPill({ o }: { o: Odds }) {
  if (o.settled)
    return o.settled.ran ? (
      <span className="tabular-nums inline-flex items-center rounded-full border border-[#a6e3b44d] px-3 py-1 text-[12.5px] text-[#a6e3b4]">{t("ran to {s} SOL cap", { s: o.settled.peakSol })}</span>
    ) : (
      <span className="tabular-nums inline-flex items-center rounded-full border border-white/[0.12] px-3 py-1 text-[12.5px] text-fg-3">{t("has not run in {h}", { h: hoursOf(o.settled.ageMin) })}</span>
    );
  const good = o.vsAverage >= 2;
  return (
    <span className="tabular-nums inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px]" title={t("Chance the market cap climbs past 85 SOL after minute five. The average launch: 2.7%.")} style={{ color: good ? "#a6e3b4" : "#d9dddb", borderColor: good ? "#a6e3b44d" : "rgba(255,255,255,0.12)" }}>
      {t("runs {p}", { p: pctOdds(o.run) })} <span className="text-fg-4">· {t("{x} avg", { x: timesAvg(o.vsAverage) })}</span>
    </span>
  );
}

/** The odds, with what moved them and how they were fitted: what minute five said, then what happened. */
export function OddsCard({ o }: { o: Odds }) {
  const runColor = o.settled?.ran || (!o.settled && o.vsAverage >= 2) ? "#a6e3b4" : "#d9dddb";
  const devColor = o.devDumps !== null && o.devDumps >= 0.5 ? "#ff8a7e" : "#d9dddb";
  const Outcome = ({ good, text }: { good: boolean; text: string }) => (
    <p className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px]" style={{ color: good ? "#a6e3b4" : "#ff8a7e", borderColor: good ? "#a6e3b44d" : "#ff8a7e4d", background: good ? "#a6e3b414" : "#ff8a7e14" }}>
      {good ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
      {text}
    </p>
  );
  const Pending = ({ text }: { text: string }) => <p className="tabular-nums mt-4 text-[13px] text-fg-3">{text}</p>;
  return (
    <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] font-semibold text-fg">{t("The odds")}</p>
        <span className="text-[12px] text-fg-4">{o.at === "5min" ? t("what minute five said, and what happened") : t("early read: under five minutes old")}</span>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/[0.06] sm:grid-cols-2">
        <div className="flex flex-col items-center bg-night-surface px-4 pb-5 pt-4 text-center">
          <p className="mb-3 text-[12.5px] text-fg-3">{t("Odds it runs past 85 SOL cap")}</p>
          <OddsGauge value={o.run} color={runColor} mark={0.027} size={200} />
          {o.settled?.ran ? (
            <Outcome good text={t("ran to {s} SOL, {m} min in", { s: o.settled.peakSol, m: o.settled.afterMin })} />
          ) : o.settled ? (
            <Outcome good={false} text={t("has not run in {h}", { h: hoursOf(o.settled.ageMin) })} />
          ) : (
            <Pending text={t("{x} the average launch (2.7%)", { x: timesAvg(o.vsAverage) })} />
          )}
        </div>
        <div className="flex flex-col items-center bg-night-surface px-4 pb-5 pt-4 text-center">
          <p className="mb-3 text-[12.5px] text-fg-3">{t("Odds the dev dumps later")}</p>
          {o.devDumps === null ? (
            <>
              <div className="flex h-[96px] items-end text-[30px] font-semibold leading-none text-[#ff8a7e]">{t("dumped")}</div>
              <Outcome good={false} text={t("sold half the bag in the first five minutes")} />
            </>
          ) : (
            <>
              <OddsGauge value={o.devDumps} color={devColor} size={200} />
              {o.devSettled ? (
                o.devSettled.dumped ? <Outcome good={false} text={t("dumped later, as it said")} /> : <Outcome good text={t("has not dumped in {h}", { h: hoursOf(o.devSettled.ageMin) })} />
              ) : (
                <Pending text={t("sells half the bag later")} />
              )}
            </>
          )}
        </div>
      </div>
      {o.why.length > 0 && (
        <ul className="mt-5 grid gap-x-6 gap-y-1.5 text-[14px] leading-snug sm:grid-cols-2">
          {o.why.map((w) => (
            <li key={w.says} className="flex items-start gap-2.5 text-fg-2">
              <span className="mt-[1px] w-3 shrink-0 text-center" style={{ color: w.up ? "#a6e3b4" : "#ff8a7e" }}>{w.up ? "+" : "−"}</span>
              {t(w.says)}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[12px] leading-relaxed text-fg-4">{t("The tick on the left ring is the average launch, 2.7%. Fitted on 34,183 pump.fun launches: what launches like this one went on to do. Odds, not advice: a 20% chance still fails four times in five.")}</p>
    </div>
  );
}
