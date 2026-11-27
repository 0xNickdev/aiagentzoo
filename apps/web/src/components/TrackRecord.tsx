import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { t } from "../i18n";
import { Panel } from "./site/Panel";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";

export interface RecordRow {
  mint: string;
  symbol: string;
  at: number;
  capAtSignal: number;
  peakCap: number;
  multiple: number;
  graduated: boolean;
  tier: "strong" | "watch";
  live: boolean;
}
interface Rates {
  n: number;
  graduated: number;
  x2: number;
  x5: number;
  x10: number;
  medianX: number | null;
}
export interface RadarRecord {
  builtAt: number;
  frozenAt: number;
  gradedAfterHours: number;
  top: RecordRow[];
  picks: Rates & { strong: number; watch: number };
  base: Rates;
}

/** The public track record from north, read once; it is rebuilt there every hour. */
export function useRadarRecord(): RadarRecord | null {
  const [rec, setRec] = useState<RadarRecord | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${NORTH}/v1/radar/record`)
      .then((r) => (r.ok ? (r.json() as Promise<RadarRecord>) : null))
      .then((b) => live && b && Array.isArray(b.top) && setRec(b))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return rec;
}

const sol = (v: number) => `${v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1)} SOL`;
const times = (v: number) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}x`;
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const pct = (k: number, n: number) => {
  if (!n) return "0%";
  const v = (100 * k) / n;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)}%`;
};

const Grad = () => <span className="inline-block rounded-[4px] border border-white px-[5px] text-[10.5px] leading-4 text-white">{t("graduated")}</span>;

function Big({ r }: { r: RecordRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-line bg-night-raised/40 p-3.5">
      <div className="flex items-baseline gap-2">
        <a href={`/xray?mint=${r.mint}`} className="truncate text-[16px] font-medium tracking-[-0.02em] text-white hover:underline">
          ${r.symbol || r.mint.slice(0, 6)}
        </a>
        {r.graduated && <Grad />}
        <span className="ml-auto shrink-0 text-[12px] text-faint tabular-nums">{day(r.at)}</span>
      </div>
      <div>
        <div className="text-[40px] font-semibold leading-none tracking-[-0.05em] text-white tabular-nums sm:text-[48px]">{times(r.multiple)}</div>
        <div className="mt-1.5 text-[12px] text-dim">{t("from signal to peak")}</div>
      </div>
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="min-w-0 truncate text-fg-2 tabular-nums">
          {sol(r.capAtSignal)} → {sol(r.peakCap)}
        </span>
        <a href={`/xray?mint=${r.mint}`} className="ml-auto shrink-0 text-dim hover:text-white">
          {t("X-Ray ↗")}
        </a>
      </div>
    </div>
  );
}

/** The best runners since the freeze, from signal to peak, and the plain numbers over every graded pick. */
export function TrackRecord({ rec }: { rec: RadarRecord | null }) {
  if (!rec) return null;
  const p = rec.picks;
  const b = rec.base;
  const big = rec.top.slice(0, 6);
  const rest = rec.top.slice(6);
  return (
    <Panel title={t("Track record")} meta={t("since {d}, graded at {h} h", { d: day(rec.frozenAt), h: rec.gradedAfterHours })} className="lg:col-span-12">
      {p.n > 0 && (
        <p className="mb-3 max-w-[100ch] text-[13px] leading-[1.6] text-fg-2">
          {t("{n} graded picks: {g} graduated, {x2} reached 2x, {x5} reached 5x and {x10} reached 10x from signal to peak. A random five-minute reading: {bg} graduated, {b2} reached 2x, {b10} reached 10x.", {
            n: p.n.toLocaleString("en-US"),
            g: pct(p.graduated, p.n),
            x2: pct(p.x2, p.n),
            x5: pct(p.x5, p.n),
            x10: pct(p.x10, p.n),
            bg: pct(b.graduated, b.n),
            b2: pct(b.x2, b.n),
            b10: pct(b.x10, b.n),
          })}
        </p>
      )}
      {big.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {big.map((r) => (
            <Big key={r.mint} r={r} />
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-[12.5px] text-faint">{t("No graded pick has run 3x yet.")}</p>
      )}
      {rest.length > 0 && (
        <div className="mt-3 border-t border-line">
          {rest.map((r) => (
            <div key={r.mint} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-b border-line py-2 text-[12.5px] last:border-0 sm:grid-cols-[minmax(0,1fr)_70px_minmax(0,200px)_90px_auto]">
              <span className="flex min-w-0 items-baseline gap-2">
                <a href={`/xray?mint=${r.mint}`} className="truncate font-medium text-white hover:underline">
                  ${r.symbol || r.mint.slice(0, 6)}
                </a>
                {r.graduated && <Grad />}
              </span>
              <span className="hidden text-faint tabular-nums sm:block">{day(r.at)}</span>
              <span className="hidden truncate text-right text-fg-2 tabular-nums sm:block">
                {sol(r.capAtSignal)} → {sol(r.peakCap)}
              </span>
              <span className="text-right font-medium text-white tabular-nums">{times(r.multiple)}</span>
              <a href={`/xray?mint=${r.mint}`} className="text-right text-dim hover:text-white">
                {t("X-Ray ↗")}
              </a>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[12px] leading-[1.55] text-dim">{t("Multiples are from signal to peak. The peak is the highest cap after the signal, not a price anyone sold at; most signals still fall.")}</p>
    </Panel>
  );
}

/** Three runners under the countdown: small, as proof the model has run before it opens. */
export function TopRunners({ rec }: { rec: RadarRecord | null }) {
  const top = rec?.top.slice(0, 3) ?? [];
  if (!top.length) return null;
  return (
    <div className="mb-8 mt-6 flex w-full max-w-[560px] flex-col items-center gap-2">
      <span className="text-[12px] text-dim">{t("Best picks of the silent trial, from signal to peak")}</span>
      <div className="flex w-full flex-wrap justify-center gap-2">
        {top.map((r) => (
          <a key={r.mint} href={`/xray?mint=${r.mint}`} className="flex items-baseline gap-2 rounded-[8px] border border-line bg-night-surface/80 px-3 py-1.5 text-[12.5px] hover:border-line-2">
            <span className="font-medium text-white">${r.symbol || r.mint.slice(0, 6)}</span>
            <span className="font-semibold text-white tabular-nums">{times(r.multiple)}</span>
            <span className="text-faint tabular-nums">{day(r.at)}</span>
          </a>
        ))}
      </div>
      <span className="text-[11.5px] text-faint">{t("The peak is the highest cap after the signal, not a price anyone sold at; most signals still fall.")}</span>
    </div>
  );
}
