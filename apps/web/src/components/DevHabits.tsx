import { t } from "../i18n";
import { money } from "../outcome";

/** A dev's habits as the node reads them from their launches: medians, never advice. */
export interface DevPattern {
  launches: number;
  firstCapUsd: number | null;
  peakCapUsd: number | null;
  upsideX: number | null;
  peakAfterSec: number | null;
  reached20k: number | null;
  firstSellSec: number | null;
  dumpCapUsd: number | null;
  afterDumpLowPct: number | null;
  afterDumpDoubled: number | null;
  dumps: number;
}

export interface Habits {
  pattern?: DevPattern | null;
  repeats?: Array<{ symbol: string; n: number }>;
  tempo?: { perDay: number; idleDays: number };
}

const secs = (s: number) => (s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-white/[0.08] py-2 first:border-t-0">
      <span className="text-[12.5px] font-light text-fg-4">{k}</span>
      <span className={`tabular-nums text-right text-[13px] ${bad ? "text-[#ff8a7e]" : "text-fg-2"}`}>{v}</span>
    </div>
  );
}

/**
 * "Usually": what this dev's launches tend to do. How high they go and how fast, how soon the dev sells, and what
 * the coin does after. A description of the dev, not a call to buy or sell.
 */
export default function DevHabits({ h }: { h: Habits | null | undefined }) {
  if (!h) return null;
  const p = h.pattern;
  const rows: Array<{ k: string; v: string; bad?: boolean }> = [];
  if (h.repeats?.length) rows.push({ k: t("repeats tickers"), v: h.repeats.map((r) => `${r.symbol} ×${r.n}`).join(", "), bad: true });
  if (p) {
    if (p.peakCapUsd !== null) rows.push({ k: t("usually peaks at"), v: `${money(p.peakCapUsd)}${p.peakAfterSec !== null ? t(", {s} in", { s: secs(p.peakAfterSec) }) : ""}` });
    if (p.firstCapUsd !== null && p.upsideX !== null) rows.push({ k: t("first second → peak"), v: `${money(p.firstCapUsd)} → ${p.upsideX}x` });
    if (p.reached20k !== null) rows.push({ k: t("reached $20K"), v: pct(p.reached20k) });
    if (p.firstSellSec !== null) rows.push({ k: t("dev's first sale"), v: t("{s} after launch", { s: secs(p.firstSellSec) }), bad: p.firstSellSec < 60 });
    if (p.dumps && p.dumpCapUsd !== null) rows.push({ k: t("dumps at"), v: money(p.dumpCapUsd) });
    if (p.dumps && p.afterDumpLowPct !== null) rows.push({ k: t("after the dump, in 30 min"), v: `${pct(p.afterDumpLowPct)}${p.afterDumpDoubled ? t(" · doubled in {p}", { p: pct(p.afterDumpDoubled) }) : ""}`, bad: p.afterDumpLowPct <= -0.3 });
  }
  if (h.tempo) rows.push({ k: t("pace"), v: h.tempo.idleDays < 1 ? t("{n} a day · last today", { n: h.tempo.perDay }) : t("{n} a day · last {d}d ago", { n: h.tempo.perDay, d: h.tempo.idleDays }) });
  if (!rows.length) return null;
  return (
    <div className="mt-3 border-t border-white/[0.08] pt-3">
      <p className="tabular-nums text-[11.5px] [&::first-letter]:uppercase text-fg-4">
        {p ? t("usually · from {n} launches", { n: p.launches }) : t("habits")}
      </p>
      <div className="mt-1.5">
        {rows.map((r) => (
          <Row key={r.k} {...r} />
        ))}
      </div>
    </div>
  );
}
