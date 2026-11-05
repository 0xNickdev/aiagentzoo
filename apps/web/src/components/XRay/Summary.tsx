import { useState } from "react";
import { lang, t, tChain } from "../../i18n";
import { pctFine } from "../../format";
import type { XRayReport } from "./types";
import { TONE } from "./shared";
import { pctMove, usdShort, type Market } from "./Market";
import { callsLine, type Calls } from "./Calls";
import type { Tab } from "./Report";

/**
 * The first thing on the report: what the chain shows about this coin and who is already inside, with where it trades
 * now. It does not tell anyone to buy or not; it lays the patterns out, and every line opens the tab that proves it.
 */
export function Summary({ r, market, calls, open }: { r: XRayReport; market: Market | null; calls: Calls | null; open: (t: Tab) => void }) {
  const c = r.check;
  const f = c.facts;
  const tone = TONE[c.verdict];
  const [all, setAll] = useState(false);
  const reasons = all ? c.reasons : c.reasons.slice(0, 3);
  const took = r.early.reduce((n, e) => n + e.bought, 0);
  const holds = r.early.reduce((n, e) => n + e.held, 0);
  const line = callsLine(r, calls);
  // The dev's record says what they usually do; this says what they have done on this coin so far, right beside it.
  const devNow = (() => {
    if (!f || r.outsideStream) return null;
    const age = f.ageMin < 60 ? t("{m} min in", { m: f.ageMin }) : f.ageMin < 48 * 60 ? t("{h} h in", { h: Math.round(f.ageMin / 60) }) : t("{d} d in", { d: Math.round(f.ageMin / 1440) });
    const sold = f.creatorSoldPct;
    const holds = c.holders?.creatorHoldsPct;
    const held = holds !== null && holds !== undefined ? t("holds {p}%", { p: holds }) : null;
    if (sold === null || sold === undefined) return t("On this one: {a}, the dev never bought.", { a: age });
    if (sold >= 99) return t("On this one: {a}, already sold their whole bag.", { a: age });
    if (sold >= 50) return t("On this one: {a}, already sold {p}% of their bag{h}.", { a: age, p: sold, h: held ? `, ${held}` : "" });
    if (sold > 0) return t("On this one: {a}, sold {p}% so far{h}.", { a: age, p: sold, h: held ? `, ${held}` : "" });
    return t("On this one: {a}, has not sold{h}.", { a: age, h: held ? `, ${held}` : "" });
  })();
  const isDevRecord = (x: string) => /dumped \d+ of their \d+ launches/.test(x);

  const inside: Array<{ k: string; v: string; tab: Tab; bad: boolean }> = [];
  if (r.early.length) inside.push({ k: t("first 5 seconds"), v: t("{n} wallets took {p}, hold {h}", { n: r.early.length, p: pctFine(took), h: pctFine(holds) }), tab: "five", bad: took >= 0.25 && holds >= 0.1 });
  if (f?.bundlers) inside.push({ k: t("bundles"), v: t("{n} wallets hold {p}%", { n: f.bundlers, p: f.bundlersHeldPct ?? 0 }), tab: "bundles", bad: (f.bundlersHeldPct ?? 0) >= 20 });
  if (c.holders && c.holders.top10Pct > 0) inside.push({ k: t("top 10"), v: t("hold {p}%", { p: c.holders.top10Pct }), tab: "holders", bad: c.holders.top10Pct >= 50 || c.holders.topWalletPct >= 20 });
  if (c.holders?.creatorHoldsPct !== null && c.holders?.creatorHoldsPct !== undefined) inside.push({ k: t("the dev"), v: t("holds {p}%", { p: c.holders.creatorHoldsPct }), tab: "dev", bad: c.holders.creatorHoldsPct >= 10 });
  if (line) inside.push({ k: t("callers"), v: line.text, tab: "calls", bad: line.bad });

  return (
    <div className="relative border-b border-white/[0.07] px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-fg-4">{t("What the chain shows")}</p>
        {market && market.mcapUsd !== null && (
          <p className="tabular-nums text-[12.5px] text-fg-3">
            <span className="text-fg">{t("mcap {m}", { m: usdShort(market.mcapUsd) })}</span>
            {market.m5 !== null && <span className={market.m5 >= 0 ? "text-[#a6e3b4]" : "text-[#ff8a7e]"}> · 5m {pctMove(market.m5)}</span>}
            {market.h1 !== null && <span className={market.h1 >= 0 ? "text-[#a6e3b4]" : "text-[#ff8a7e]"}> · 1h {pctMove(market.h1)}</span>}
            {market.volH24 !== null && <span> · {t("vol 24h {v}", { v: usdShort(market.volH24) })}</span>}
          </p>
        )}
      </div>

      {c.reasons.length ? (
        <ul className="mt-2.5 space-y-1.5">
          {reasons.map((x) => (
            <li key={x} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-fg">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.color, boxShadow: `0 0 8px ${tone.color}80` }} />
              <span className="[&::first-letter]:uppercase">
                {tChain(x)}
                {isDevRecord(x) && devNow && <span className="text-fg-3">{". "}{devNow}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 text-[14.5px] text-fg">
          {r.outsideStream ? t("Launched before our stream: what happened at launch is not on record, only who holds it now.") : t("No red flags on the chain so far.")}
        </p>
      )}
      {c.reasons.length > 3 && (
        <button type="button" onClick={() => setAll(!all)} className="tabular-nums mt-1.5 text-[12.5px] text-fg-3 hover:text-white">
          {all ? t("show fewer") : t("+ {n} more", { n: c.reasons.length - 3 })}
        </button>
      )}

      {inside.length > 0 && (
        <div className="mt-3.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-fg-4">{t("Who is inside")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {inside.map((x) => (
              <button
                key={x.k}
                type="button"
                onClick={() => open(x.tab)}
                className={`tabular-nums rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition hover:border-white/25 ${x.bad ? "border-[#ff8a7e]/30 bg-[#ff8a7e]/[0.06]" : "border-white/[0.08] bg-white/[0.02]"}`}
              >
                <span className="text-fg-4">{x.k}</span> <span className={x.bad ? "text-[#ff8a7e]" : "text-fg-2"}>{x.v}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {c.notes.length > 0 && !r.outsideStream && <p className="mt-3 text-[12px] leading-relaxed text-fg-4">{c.notes.map(tChain).join(" · ")}</p>}
      {r.outsideStream && (
        <p className="mt-3 text-[12px] leading-relaxed text-fg-4">
          {t("Launched {day}, before our stream's window.", { day: new Date(r.createdAt).toLocaleDateString(lang() === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) })}
        </p>
      )}
    </div>
  );
}
