import { useEffect, useRef, useState, type ReactNode } from "react";
import { chainOf, unitOf } from "../../chain";
import { pick, t, tChain } from "../../i18n";
import { pctFine, short } from "../../format";
import { money } from "../../outcome";
import { BOT_URL, ZOOAGENCY_CLAWPUMP_URL, ZOOAGENCY_MINT } from "../../links";
import { FEE_BPS, swapEnabled } from "../../swap";
import Swap from "../Swap";
import { factorsOf } from "../Factors";
import { KIND, kindOf } from "../XRayRadar";
import type { Early, XRayReport } from "./types";
import { ageOf, capOf, splitReasons, TONE, venueLabel, VWORD } from "./shared";
import { pctMove, usdShort } from "./Market";
import { TERMINALS, TradeOnEvm } from "./Trade";
import { drawXRay } from "./shareCard";
import { HOLDER_MIN, PRICES, startCheckout, useFreeDeepCheck, type Period } from "./access";
import { Kv, Pn, oddsPct, type Ctx } from "./ui";

const AVG = 0.027;
/** pump.fun's curve graduates at about 85 SOL. */
const GRAD_SOL = 85;

const sym = (r: XRayReport) => r.symbol.replace(/^\$/, "") || "token";

/* ------------------------------------------------------------------ verdict */


/** The first number in a reason, with "of N" after it, stands out: "481 of their 481", "98%". */
function marked(text: string): ReactNode {
  const m = /\d[\d,.]*%?(?:\s+of\s+(?:their\s+)?\d[\d,.]*%?)?/.exec(text);
  if (!m) return text;
  return (
    <>
      {text.slice(0, m.index)}
      <em>{m[0]}</em>
      {text.slice(m.index + m[0].length)}
    </>
  );
}

/** "22 Oct": the day the long memory starts counting. */
const sinceDay = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function VerdictPanel({ r, market }: Ctx) {
  const c = r.check;
  const f = c.facts;
  const rec = r.creatorRecord;
  const tone = TONE[c.verdict];
  const vw = VWORD[c.verdict] ?? VWORD.unknown;
  const lede =
    rec && rec.dumped >= 2 && !r.outsideStream
      ? t(rec.counted === "history" && rec.historySince ? "The wallet behind this coin launched {n} coins since {s} and dumped {d} of them{m}." : "The wallet behind this coin launched {n} coins in two days and dumped {d} of them{m}.", {
          n: rec.launches48h.toLocaleString("en-US"),
          s: rec.historySince ? sinceDay(rec.historySince) : "",
          d: rec.dumped.toLocaleString("en-US"),
          m: rec.medianDumpMin === null ? "" : rec.medianDumpMin <= 1 ? t(", usually within a minute") : rec.medianDumpMin < 120 ? t(", usually {m} min after launch", { m: rec.medianDumpMin }) : t(", usually {h} h after launch", { h: Math.round(rec.medianDumpMin / 60) }),
        })
      : r.outsideStream
        ? t("Launched before our stream: what happened at launch is not on record, only who holds it now and the dev's kept record.")
        : !c.reasons.length
          ? t("No red flags on the chain so far.")
          : null;
  // What the dev has done on this coin so far, beside their record.
  const devNow = (() => {
    if (!f || r.outsideStream) return null;
    const sold = f.creatorSoldPct;
    if (sold === null || sold === undefined) return t("on this one the dev never bought");
    if (sold >= 99) return t("on this one they already sold the whole bag");
    if (sold > 0) return t("on this one they sold {p}% so far", { p: sold });
    return t("on this one they have not sold");
  })();
  const isDevRecord = (x: string) => /dumped \d+ of their \d+ launches/.test(x);
  const venue = r.pool ? "PumpSwap" : venueLabel(f);
  return (
    <Pn id="ov" span="x-s5" title={t("Verdict")} meta={<>{c.odds?.at === "5min" ? t("at 5 min") : c.odds ? t("early read") : ageOf(r)} · {t("re-checked tomorrow by hedgehog")}</>}>
      <div className="x-vtop">
        <span className="x-nm">{r.name || sym(r)}</span>
        <span>${sym(r)}</span>
        <span className="x-chip">{venue} · {ageOf(r)}</span>
        {f?.graduated && <span className="x-chip">{f.poolSol != null ? t("graduated · pool {s} {u}", { s: f.poolSol < 1 ? f.poolSol.toFixed(2) : Math.round(f.poolSol), u: unitOf(r.mint) }) : t("graduated")}</span>}
        {f?.mayhem && <span className="x-chip x-w">{t("Mayhem mode")}</span>}
        {market?.mcapUsd != null && !r.pool?.taken && (
          <span className="x-chip">
            {t("mcap {m}", { m: usdShort(market.mcapUsd) })}
            {market.m5 !== null && <span className={market.m5 >= 0 ? "x-up" : "x-d"}> · 5m {pctMove(market.m5)}</span>}
          </span>
        )}
      </div>
      <BirthNote r={r} />
      <div className="x-vword">
        <h1 data-x="vword" className={vw.long ? "x-long" : ""} style={{ color: tone.color }}>
          {t(vw.w)}
        </h1>
        <span>
          {t("read from")}
          <br />
          {t("the chain")}
        </span>
      </div>
      {lede && <p className="x-lede">{lede}</p>}
      {c.verdict === "caution" && <CautionReasons reasons={c.reasons} devNow={devNow} isDevRecord={isDevRecord} />}
      {c.verdict !== "caution" && c.reasons.length > 0 && (
        <ol className="x-rs">
          {c.reasons.map((x, i) => (
            <li key={x} data-x="reason">
              <b>{String(i + 1).padStart(2, "0")}</b>
              <span>
                {marked(tChain(x))}
                {isDevRecord(x) && devNow ? `; ${devNow}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      {c.notes.length > 0 && (
        <ul className="x-notes">
          {c.notes.map((n) => (
            <li key={n}>{tChain(n)}</li>
          ))}
        </ul>
      )}
    </Pn>
  );
}

/**
 * Caution is most coins with buyers, so it reads as the bot says it: the coin's story, what is worse than usual, and
 * in one line what most coins with buyers carry.
 */
function CautionReasons({ reasons, devNow, isDevRecord }: { reasons: string[]; devNow: string | null; isDevRecord: (x: string) => boolean }) {
  const { story, worse, common } = splitReasons(reasons);
  return (
    <>
      {story.map((x) => (
        <p key={x} className="x-lede">
          {tChain(x)}
        </p>
      ))}
      <p className="x-rh">{worse.length ? t("Worse than usual") : t("Worse than usual: nothing found")}</p>
      {worse.length > 0 && (
        <ol className="x-rs">
          {worse.map((x, i) => (
            <li key={x} data-x="reason">
              <b>{String(i + 1).padStart(2, "0")}</b>
              <span>
                {marked(tChain(x))}
                {isDevRecord(x) && devNow ? `; ${devNow}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      {common.length > 0 && (
        <p className="x-rc">
          <span>{t("Common on coins with buyers:")}</span> {common.join(pick(", ", "，"))}
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ odds gauge */

const CX = 150;
const CY = 158;
const R = 122;
/** Position on the log scale 0.01% .. 100%, as a fraction of the half circle. */
const fr = (p: number) => Math.min(1, Math.max(0, (Math.log10(Math.max(p, 0.0001) * 100) + 2) / 4));
const pt = (f: number, r: number): [number, number] => {
  const a = Math.PI * (1 - f);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};
const arc = (f0: number, f1: number, r: number) => {
  const a = pt(f0, r);
  const b = pt(f1, r);
  return `M${a[0].toFixed(2)} ${a[1].toFixed(2)} A${r} ${r} 0 0 1 ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
};

/**
 * Where a tick's label sits: inside the arc, clear of its tick. Near the two ends the ticks run almost flat, so a
 * centred label would sit on the tick: there it is anchored to its inner side instead.
 */
const tickLabel = (f: number): { x: number; y: number; anchor: "start" | "middle" | "end" } => {
  const cos = Math.cos(Math.PI * (1 - f));
  const side = Math.abs(cos) > 0.75;
  const [x, y] = pt(f, side ? R - 19 : R - 27);
  return { x, y: y + (side ? 3.5 : 4), anchor: side ? (cos < 0 ? "start" : "end") : "middle" };
};

function Gauge({ run, avg, color }: { run: number; avg: number; color: string }) {
  const ticks: ReactNode[] = [];
  for (let d = -2; d < 2; d++)
    for (let m = 1; m < 10; m++) {
      const v = m * 10 ** d;
      const maj = m === 1;
      const f = fr(v / 100);
      const a = pt(f, R - 2);
      const b = pt(f, R - (maj ? 13 : 6));
      ticks.push(<line key={`t${v}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={maj ? "#aab2ad" : "#2f3833"} strokeWidth={maj ? 1.3 : 1} />);
      if (maj) {
        const tp = tickLabel(f);
        ticks.push(
          <text key={`l${v}`} x={tp.x} y={tp.y} textAnchor={tp.anchor} fill="#7d8681" fontSize={10} fontFamily="Geist Mono, monospace">
            {v < 1 ? v : v.toFixed(0)}%
          </text>,
        );
      }
    }
  const e = pt(1, R - 2);
  const e2 = pt(1, R - 13);
  const el = tickLabel(1);
  const fa = fr(avg);
  const av = pt(fa, R + 3);
  const av2 = pt(fa, R + 15);
  const avt = pt(fa, R + 24);
  const fv = fr(run);
  const np = pt(fv, R + 11);
  const ne = pt(fv, R - 11);
  const hp = pt(fv, R);
  return (
    <svg viewBox="0 0 300 175" role="img" aria-label={t("Chance to run past 85 SOL: {p} percent; average launch {a} percent", { p: oddsPct(run), a: oddsPct(avg) })}>
      <path d={arc(0, 1, R)} fill="none" stroke="#18201c" strokeWidth={1.5} />
      <path d={arc(0, fa, R + 8)} fill="none" stroke="#3a1d1a" strokeWidth={3} />
      {ticks}
      <line x1={e[0]} y1={e[1]} x2={e2[0]} y2={e2[1]} stroke="#aab2ad" strokeWidth={1.3} />
      <text x={el.x} y={el.y} textAnchor={el.anchor} fill="#7d8681" fontSize={10} fontFamily="Geist Mono, monospace">
        100%
      </text>
      <line x1={av[0]} y1={av[1]} x2={av2[0]} y2={av2[1]} stroke="#e6e9e7" strokeWidth={1.5} />
      <text x={avt[0] + 2} y={avt[1]} textAnchor={fa > 0.6 ? "end" : "start"} fill="#e6e9e7" fontSize={10.5} fontFamily="Geist, sans-serif">
        {t("avg {p}%", { p: oddsPct(avg) })}
      </text>
      {fv > 0.002 && <path data-x="gfill" d={arc(0, fv, R)} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />}
      <line x1={np[0]} y1={np[1]} x2={ne[0]} y2={ne[1]} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <circle cx={hp[0]} cy={hp[1]} r={3.5} fill="#080b0a" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

const hoursOf = (min: number) => (min < 120 ? t("{m} min", { m: min }) : t("{h} h", { h: Math.round(min / 60) }));

const sinceOf = (min: number) => (min < 2880 ? hoursOf(min) : t("{d} d", { d: Math.round(min / 1440) }));

/** What minute five said the dev would do, and what the dev did: a forecast a dev has outlived is not a warning. */
function DevOdds({ o }: { o: NonNullable<Ctx["r"]["check"]["odds"]> }) {
  const sans = { fontFamily: "var(--sans)" };
  if (o.devDumps === null) return <i className="x-d" style={sans}>{t("did, by min 5")}</i>;
  const p = oddsPct(o.devDumps);
  if (!o.devSettled) return <i className={o.devDumps >= 0.5 ? "x-d" : ""}>{p}%</i>;
  return (
    <i className={o.devSettled.dumped ? "x-d" : ""} style={sans}>
      {o.devSettled.dumped ? t("{p}% at min 5 · it did", { p }) : t("{p}% at min 5 · hasn't in {h}", { p, h: sinceOf(o.devSettled.ageMin) })}
    </i>
  );
}

export function OddsPanel({ r }: Ctx) {
  const c = r.check;
  const o = c.odds;
  if (!o) {
    const rows = factorsOf(r);
    const bad = rows.filter((x) => x.bad).length;
    return (
      <Pn span="x-s3" title={t("Odds")} meta={t("runs past 85 SOL")}>
        <p className="x-note">
          {r.outsideStream
            ? t("Odds are read at minute five of a launch; this coin launched before our stream.")
            : t("Odds are fitted on pump.fun launches; this one launched on {v}, so there is no number to give.", { v: r.pool ? "PumpSwap" : venueLabel(c.facts) })}
        </p>
        <Kv
          rows={[
            [t("Factors that look bad"), `${bad} / ${rows.length}`, bad ? "d" : ""],
            [t("Verdict"), t(TONE[c.verdict].label.toLowerCase())],
            c.holders && c.holders.top10Pct > 0 ? [t("Top 10 hold"), `${c.holders.top10Pct}%`, c.holders.top10Pct >= 50 ? "d" : ""] : null,
          ]}
        />
      </Pn>
    );
  }
  const avg = o.average ?? AVG;
  const color = o.run < avg ? "#ff5a4f" : c.verdict === "pass" ? "#f4f5f4" : "#e6e9e7";
  return (
    <Pn span="x-s3" title={t("Odds")} meta={o.at === "5min" ? t("as of minute 5 · passes {s} market cap", { s: capOf(GRAD_SOL, o.solUsd) }) : t("so far · passes {s} market cap", { s: capOf(GRAD_SOL, o.solUsd) })}>
      <div className="x-gwrap">
        <Gauge run={o.run} avg={avg} color={color} />
        <div className="x-read">
          <div className="x-n">
            <span data-x="oddsN">{oddsPct(o.run)}</span>
            <small>%</small>
          </div>
          <div className="x-t">
            {t("average launch {a}%", { a: oddsPct(avg) })}
            {o.vsAverage > 0 ? ` · ${o.vsAverage < 0.1 ? "<0.1" : o.vsAverage}× ${t("avg")}` : ""}
          </div>
        </div>
        <div className="x-why">
          {o.why.map((w) => (
            <div key={w.says}>
              <span>{tChain(w.says)}</span>
              <i className={w.up ? "x-up" : "x-d"}>{w.up ? "+" : "−"}</i>
            </div>
          ))}
          <div>
            <span>{t("Dev sells half the bag later")}</span>
            <DevOdds o={o} />
          </div>
          {o.settled && (
            <div>
              <span>{t("What happened since")}</span>
              <i className={o.settled.ran ? "x-up" : "x-d"} style={{ fontFamily: "var(--sans)" }}>{o.settled.ran ? t("ran to {s}", { s: capOf(o.settled.peakSol, o.solUsd) }) : t("no run in {h}", { h: hoursOf(o.settled.ageMin) })}</i>
            </div>
          )}
        </div>
      </div>
    </Pn>
  );
}

/* ------------------------------------------------------------------ right now */

function Tile({ k, v, unit, tone, meter, color }: { k: string; v: string; unit?: string; tone?: "d" | "w" | "up" | ""; meter: number; color: string }) {
  return (
    <div className="x-tile">
      <span className="x-k">{k}</span>
      <span className={`x-v ${tone ? `x-${tone}` : ""}`}>
        {v}
        {unit && <small>{unit}</small>}
      </span>
      <div className="x-meter" style={{ color }}>
        <i style={{ width: `${Math.max(0, Math.min(100, meter * 100))}%` }} />
      </div>
    </div>
  );
}
const COL = { d: "var(--danger)", w: "var(--warn)", up: "var(--lit)", "": "var(--fg-3)" } as const;

export function RightNowPanel({ r }: Ctx) {
  const c = r.check;
  const f = c.facts;
  const h = c.holders;
  if (!f || r.outsideStream) {
    const cells: Array<[string, string, string, number, "d" | "w" | ""]> = [];
    if (h && h.top10Pct > 0) {
      cells.push([t("Top 10 hold"), String(h.top10Pct), "%", h.top10Pct / 100, h.top10Pct >= 50 ? "d" : ""]);
      cells.push([t("Largest wallet"), String(h.topWalletPct), "%", h.topWalletPct / 100, h.topWalletPct >= 20 ? "d" : ""]);
    }
    if (h?.creatorHoldsPct != null) cells.push([t("Dev holds"), String(h.creatorHoldsPct), "%", h.creatorHoldsPct / 100, h.creatorHoldsPct >= 5 ? "w" : ""]);
    if (h?.programPct) cells.push([t("In the curve or pool"), String(h.programPct), "%", h.programPct / 100, ""]);
    if (r.pool) {
      cells.push([t("SOL into the pool"), r.pool.solIn.toLocaleString("en-US", { maximumFractionDigits: 1 }), " SOL", Math.min(1, r.pool.solIn / GRAD_SOL), ""]);
      cells.push([t("Pool trades read"), String(r.pool.trades), "", Math.min(1, r.pool.trades / 500), ""]);
    }
    return (
      <Pn span="x-s4" title={t("Right now")} meta={r.pool ? t("read from the pool") : t("holders read now")} body={cells.length > 0 ? false : true}>
        {cells.length > 0 ? (
          <div className="x-tiles">
            {cells.slice(0, 6).map(([k, v, u, m, tone]) => (
              <Tile key={k} k={k} v={v} unit={u} tone={tone} meter={m} color={COL[tone]} />
            ))}
          </div>
        ) : (
          <p className="x-note">{t("Launched before our stream, and holders could not be read right now. Open it again in a minute.")}</p>
        )}
      </Pn>
    );
  }
  const sold = f.creatorSoldPct;
  const top5 = f.top5BuyingPct;
  const churn = f.churnPct ?? 0;
  const serial = f.serialSnipers ?? 0;
  const soldTone = sold == null ? "" : sold >= 50 ? "d" : sold === 0 && f.buyers >= 10 ? "up" : "";
  const top5Tone = top5 == null ? "" : top5 >= 70 ? "d" : top5 >= 50 ? "w" : "";
  const churnTone = churn >= 30 && !f.mayhem ? "w" : churn >= 60 ? "w" : "";
  const serialTone = serial >= 2 ? "w" : "";
  const curve = f.graduated ? f.poolSol : f.curveSol;
  return (
    <Pn span="x-s4" title={t("Right now")} meta={t("{b} buys · {s} sells", { b: f.buys.toLocaleString("en-US"), s: f.sells.toLocaleString("en-US") })} body={false} className="x-tl">
      <div className="x-tiles">
        <Tile k={(f.poolBuys ?? 0) > 0 ? t("Buyers on the curve") : t("Buyers so far")} v={f.buyers.toLocaleString("en-US")} meter={Math.min(1, f.buyers / 100)} color={COL[""]} />
        <Tile k={t("Dev sold")} v={sold == null ? t("never bought") : String(sold)} unit={sold == null ? undefined : "%"} tone={soldTone} meter={(sold ?? 0) / 100} color={COL[soldTone]} />
        {top5 != null ? (
          <Tile k={t("Bought by top 5")} v={String(top5)} unit="%" tone={top5Tone} meter={top5 / 100} color={COL[top5Tone]} />
        ) : (
          <Tile k={t("Bundlers hold")} v={String(f.bundlersHeldPct ?? 0)} unit="%" tone={(f.bundlersHeldPct ?? 0) >= 20 ? "d" : ""} meter={(f.bundlersHeldPct ?? 0) / 100} color={COL[(f.bundlersHeldPct ?? 0) >= 20 ? "d" : ""]} />
        )}
        <Tile k={t("Churn")} v={String(churn)} unit="%" tone={churnTone} meter={churn / 100} color={COL[churnTone]} />
        <Tile k={t("Serial snipers")} v={String(serial)} tone={serialTone} meter={f.earlyWallets ? serial / f.earlyWallets : 0} color={COL[serialTone]} />
        <Tile
          k={f.graduated ? t("Pool") : t("Bonding curve")}
          v={curve == null ? "-" : curve < 1 ? curve.toFixed(3) : curve.toLocaleString("en-US", { maximumFractionDigits: 1 })}
          unit={curve == null ? undefined : ` ${unitOf(r.mint)}`}
          tone={f.graduated && curve != null && curve < 1 ? "d" : ""}
          meter={curve == null ? 0 : chainOf(r.mint) === "solana" ? curve / GRAD_SOL : 0}
          color={COL[f.graduated && curve != null && curve < 1 ? "d" : ""]}
        />
      </div>
    </Pn>
  );
}

/* ------------------------------------------------------------------ the dev */

const SCALES = [30, 60, 90, 120, 300, 600, 1800, 3600, 6 * 3600, 24 * 3600];
const spanOf = (s: number) => (s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

const TL_CLASS = { d: "", g: "ok", a: "al", u: "op" } as const;
const TL_LEGEND: Array<["d" | "g" | "a" | "u", string, string]> = [
  ["d", "dumped {n}", "var(--danger)"],
  ["g", "graduated {n}", "var(--lit)"],
  ["a", "alive {n}", "#6b736f"],
  ["u", "under 15 min {n}", "transparent"],
];

/** One square per launch in the order they launched, coloured by what became of each. */
function Timeline({ codes, label }: { codes: Array<"d" | "g" | "a" | "u">; label: string }) {
  const count = { d: 0, g: 0, a: 0, u: 0 };
  for (const c of codes) count[c] = (count[c] ?? 0) + 1;
  return (
    <>
      <div className="x-strip" aria-hidden="true">
        {codes.map((c, i) => (
          <span key={i} className={TL_CLASS[c] ?? "op"} />
        ))}
      </div>
      <div className="x-legend">
        <span className="x-lgk">
          {TL_LEGEND.filter(([k]) => count[k] > 0).map(([k, label, bg]) => (
            <span key={k}>
              <i style={{ background: bg, boxShadow: k === "u" ? "inset 0 0 0 1px var(--line-2)" : undefined }} />
              {t(label, { n: count[k].toLocaleString("en-US") })}
            </span>
          ))}
        </span>
        <span>{t("one square per launch, oldest first · {l}", { l: label })}</span>
      </div>
    </>
  );
}

/** One square per launch: dumped in red, the rest in white. Without a timeline the node gives counts, not the order, so they are grouped. */
function Squares({ total, dumped, label }: { total: number; dumped: number; label: string }) {
  const per = Math.max(1, Math.ceil(total / 732));
  const n = Math.ceil(total / per);
  const red = Math.round(dumped / per);
  return (
    <>
      <div className="x-strip" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={i < red ? "" : "ok"} />
        ))}
      </div>
      <div className="x-legend">
        <span>
          <i style={{ background: "var(--danger)" }} />
          {t("dumped {n}", { n: dumped.toLocaleString("en-US") })}
          <i style={{ background: "var(--lit)", marginLeft: 12 }} />
          {t("did not dump {n}", { n: (total - dumped).toLocaleString("en-US") })}
        </span>
        <span>{per > 1 ? t("one square = {n} launches · {l}", { n: per, l: label }) : t("one square per launch · {l}", { l: label })}</span>
      </div>
    </>
  );
}

const TIE_WORD: Record<string, string> = { funder: "same funder", transfer: "SOL between launch wallets", snipers: "shared early snipers", print: "same private launch tool" };

/** The dev's operator from the graph: how many other launch wallets are tied on chain, by what, and what they did. */
function OperatorLine({ r }: { r: XRayReport }) {
  const g = r.check.operatorGraph;
  if (!g || g.creators < 2) return null;
  const by = Object.keys(g.ties).filter((k) => TIE_WORD[k]).map((k) => t(TIE_WORD[k]!));
  const acc = g.accounts[0]?.replace(/^x:/, "X ").replace(/^telegram:/, "t.me/").replace(/^x-community:/, "X community ");
  const bad = g.dumped >= 3 && g.dumped / Math.max(1, g.launches) >= 0.5;
  return (
    <p className="x-note" style={{ marginTop: 8 }}>
      <span className={bad ? "x-d" : ""}>{t("One operator with {n} other launch wallets", { n: g.creators - 1 })}</span>
      {" · "}
      {by.join(", ")}
      {" · "}
      {t("{d} of {l} launches dumped", { d: g.dumped, l: g.launches })}
      {acc ? ` · ${t("same {a}", { a: acc })}` : ""}
    </p>
  );
}

export function DevPanel({ r, onPick, go, full }: Ctx & { full?: boolean }) {
  const rec = r.creatorRecord;
  const f = r.check.facts;
  const meta = (
    <>
      <code>{short(r.creator)}</code> · {t("read by raven")}
    </>
  );
  const more = full ? undefined : { label: t("all"), on: () => go("dev") };
  if (r.outsideStream || !rec) {
    const hist = r.outsideStream ? r.devHistory : null;
    return (
      <Pn id={full ? undefined : "dev"} span="x-s8" title={t("The dev")} meta={meta} more={more}>
        {hist ? (
          <>
            <div className="x-devhd">
              <p className="x-big">
                <span className={hist.dumped >= 2 ? "x-d" : ""}>{hist.dumped}</span> {t("of {n} launches we kept dumped", { n: hist.launches })}
              </p>
              <span className="x-sub">{t("this coin launched before our stream")}</span>
            </div>
            <Squares total={hist.launches} dumped={hist.dumped} label={t("the long memory")} />
          </>
        ) : (
          <>
            <p className="x-big">{r.outsideStream ? t("None of this dev's launches are in our record") : t("First launch we have seen from this wallet")}</p>
            <p className="x-note" style={{ marginTop: 6 }}>
              {r.outsideStream ? t("The coin launched before our stream, so we did not see the dev launch it or sell.") : t("No other launch from this dev on the stream in the last 48 hours: no record to judge yet, which is not the same as a clean one.")}
            </p>
            <Kv
              rows={[
                f && [t("Dev sold of their own bag"), f.creatorSoldPct == null ? t("never bought") : `${f.creatorSoldPct}%`, (f.creatorSoldPct ?? 0) >= 50 ? "d" : ""],
                f && [t("Launches in 24 h"), String(f.creatorLaunches24h)],
                r.check.holders?.creatorHoldsPct != null && [t("Dev holds now"), `${r.check.holders.creatorHoldsPct}%`],
                f?.bundleWallets ? [t("Launch block"), t("{n} wallets · {p}%", { n: f.bundleWallets, p: f.bundleSharePct ?? 0 }), (f.bundleSharePct ?? 0) >= 15 ? "d" : ""] : null,
              ]}
            />
          </>
        )}
      </Pn>
    );
  }
  const recent = (rec.recent ?? []).filter((x) => x.mint !== r.mint).slice(0, full ? 16 : 8);
  const secsOf = (x: (typeof recent)[number]) => (x.dumpedAfterMin === null ? null : (x.dumpedAfterSec ?? x.dumpedAfterMin * 60));
  const maxSec = Math.max(1, ...recent.map((x) => secsOf(x) ?? 0));
  const scale = SCALES.find((s) => s >= maxSec) ?? maxSec;
  const bad = rec.dumped >= 2;
  const span48 = rec.counted === "history" && rec.historySince ? t("since {s}", { s: sinceDay(rec.historySince) }) : t("48 h");
  return (
    <Pn id={full ? undefined : "dev"} span="x-s8" title={t("The dev")} meta={meta} more={more}>
      <div className="x-devhd">
        <p className="x-big">
          <span className={bad ? "x-d" : ""}>{rec.dumped.toLocaleString("en-US")}</span> {rec.counted === "history" && rec.historySince ? t("of {n} launches dumped since {s}", { n: rec.launches48h.toLocaleString("en-US"), s: sinceDay(rec.historySince) }) : t("of {n} launches dumped in 48 h", { n: rec.launches48h.toLocaleString("en-US") })}
        </p>
        <span className="x-sub">
          {[rec.medianDumpMin !== null ? (rec.medianDumpMin < 120 ? t("median {m} min to first sell", { m: rec.medianDumpMin }) : t("median {h} h to first sell", { h: Math.round(rec.medianDumpMin / 60) })) : null, rec.graduated ? t("{n} graduated before", { n: rec.graduated }) : null, rec.counted === "history" && rec.last48h ? t("{n} in the last 48 h", { n: rec.last48h.launches }) : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      {rec.timeline?.length ? <Timeline codes={rec.timeline} label={span48} /> : <Squares total={rec.launches48h} dumped={rec.dumped} label={span48} />}
      <OperatorLine r={r} />
      {recent.length > 0 && (
        <>
          <div className="x-runs">
            <div className="x-hd">
              <span>{t("last {n}", { n: recent.length })}</span>
              <span>{t("time until the dev sold")}</span>
              <span className="x-r">{t("peak cap")}</span>
              <span className="x-r">{t("dev took")}</span>
            </div>
            {recent.map((x) => {
              const s = secsOf(x);
              const w = s === null ? 0 : Math.min(100, (s / scale) * 100);
              const took = x.devTookSol;
              return (
                <button key={x.mint} type="button" className="x-run" onClick={() => onPick(x.mint)} title={t("x-ray ${s}", { s: x.symbol.replace(/^\$/, "") })}>
                  <span className="x-s">${x.symbol.replace(/^\$/, "")}</span>
                  <span className="x-track">
                    {s !== null ? (
                      <>
                        <b style={{ width: `${Math.max(w, 1)}%` }} />
                        {w > 82 ? <u style={{ right: `${100 - w}%`, padding: "0 9px 0 0", top: -11 }}>{spanOf(s)}</u> : <u style={{ left: `${w}%` }}>{spanOf(s)}</u>}
                      </>
                    ) : (
                      <u style={{ left: 0, paddingLeft: 0, fontFamily: "var(--sans)", color: "var(--fg-4)" }}>{x.graduated ? t("graduated") : t("dev still holding")}</u>
                    )}
                  </span>
                  <span className="x-r">{x.peakCapUsd ? money(x.peakCapUsd) : "-"}</span>
                  <span className={`x-r ${took != null && took > 0 ? "" : "x-dim"}`} style={took != null && took > 0 ? { color: "var(--fg)" } : undefined}>
                    {took == null ? "-" : `${took > 0 ? "+" : "−"}${Math.abs(took).toFixed(2)}`}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="x-scale">
            <div />
            <div>
              {[0, 1, 2, 3].map((i) => (
                <span key={i}>{spanOf(Math.round((scale * i) / 3))}</span>
              ))}
            </div>
            <div />
            <div />
          </div>
        </>
      )}
    </Pn>
  );
}

/* ------------------------------------------------------------------ launch setup */

export function SetupPanel({ r, go, full }: Ctx & { full?: boolean }) {
  const c = r.check;
  const tool = c.tool;
  const tp = tool && tool.wallets > 1 ? tool : (tool?.shape ?? tool);
  const exact = !!tool && tp === tool;
  const pct = tp && tp.settled ? (tp.dumped / tp.settled) * 100 : 0;
  const bad = !!tp && !tp.common && tp.settled >= 10 && pct >= 90;
  const op = c.operator;
  const mayhem = c.notes.find((n) => /mayhem/i.test(n));
  return (
    <Pn id={full ? undefined : "setup"} span="x-s4" title={t("Launch setup")} meta={tp ? <>{t("fingerprint")} <code>{tp.key}</code></> : t("how the launch was built")} more={full ? undefined : { label: t("all"), on: () => go("setup") }}>
      {tp ? (
        <>
          <div className="x-donut">
            <svg viewBox="0 0 80 80" aria-hidden="true">
              <circle cx="40" cy="40" r="32" fill="none" stroke="#18201c" strokeWidth="7" />
              {tp.settled > 0 && <circle data-x="dring" cx="40" cy="40" r="32" fill="none" stroke={bad ? "#ff5a4f" : pct >= 50 ? "#e8a23a" : "#aab2ad"} strokeWidth="7" pathLength="100" strokeDasharray={`${pct.toFixed(1)} 100`} transform="rotate(-90 40 40)" />}
            </svg>
            <div>
              {tp.common ? (
                <>
                  <p className="x-big">{t("Public launcher")}</p>
                  <span className="x-sub">{t("built the way thousands launch, says nothing")}</span>
                </>
              ) : tp.wallets > 1 ? (
                <>
                  <p className="x-big">
                    <span className={bad ? "x-d" : ""}>{tp.settled ? `${Math.round(pct * 10) / 10}%` : "-"}</span> {t("dumped")}
                  </p>
                  <span className="x-sub">{exact ? t("{n} wallets used this exact setup in 48 h", { n: tp.wallets.toLocaleString("en-US") }) : t("{n} wallets launched with this shape in 48 h", { n: tp.wallets.toLocaleString("en-US") })}</span>
                </>
              ) : (
                <>
                  <p className="x-big">{t("Its own setup")}</p>
                  <span className="x-sub">{t("no other wallet launched this way in 2 days")}</span>
                </>
              )}
            </div>
          </div>
          <Kv
            rows={[
              [t("Launches with this setup"), tp.launches.toLocaleString("en-US")],
              [t("Settled"), tp.settled.toLocaleString("en-US")],
              [t("Dumped"), tp.dumped.toLocaleString("en-US"), bad ? "d" : ""],
              tool?.shape && exact ? [t("Same shape, any fee amounts"), t("{l} launches · {d} of {s} dumped", { l: tool.shape.launches.toLocaleString("en-US"), d: tool.shape.dumped.toLocaleString("en-US"), s: tool.shape.settled.toLocaleString("en-US") })] : null,
              op && op.wallets <= 100 ? [t("Co-signers with the dev"), t("{n} wallets · {d} of {s} dumped", { n: op.wallets - 1, d: op.dumped, s: op.settled }), op.settled >= 3 && op.dumped / op.settled >= 0.8 ? "d" : ""] : null,
            ]}
          />
        </>
      ) : (
        <>
          <p className="x-note">{t("The launch transaction was not read for this coin, so there is no setup to compare.")}</p>
          <Kv
            rows={[
              r.ticker && [t("Ticker used before"), r.ticker.launches ? t("{n} times in {d} days", { n: r.ticker.launches, d: r.ticker.days }) : t("first time in {d} days", { d: r.ticker.days }), r.ticker.launches >= 3 && r.ticker.dumped >= 2 ? "d" : ""],
              op && op.wallets <= 100 ? [t("Co-signers with the dev"), t("{n} wallets", { n: op.wallets - 1 })] : null,
            ]}
          />
        </>
      )}
      {mayhem && <p className="x-aside">{tChain(mayhem)}</p>}
    </Pn>
  );
}

/* ------------------------------------------------------------------ first seconds */

export const whoOf = (e: Early) => e.smart?.name ?? null;

export function Lanes({ early, max, selected, onSelect }: { early: Early[]; max?: number; selected?: string | null; onSelect?: (w: string) => void }) {
  const list = [...early].sort((a, b) => a.afterSec - b.afterSec || b.bought - a.bought).slice(0, max ?? early.length);
  const far = Math.max(5, ...list.map((e) => e.exitSec ?? e.afterSec + 5));
  const MX = far <= 30 ? Math.ceil((far * 1.1) / 5) * 5 : far <= 120 ? Math.ceil((far * 1.1) / 30) * 30 : Math.ceil((far * 1.1) / 300) * 300;
  return (
    <>
      <div>
        {list.map((e) => {
          const a = (e.afterSec / MX) * 100;
          const out = e.exitSec;
          const b = out === null ? 100 : Math.max(a + 0.5, (out / MX) * 100);
          const k = KIND[kindOf(e)];
          const name = whoOf(e);
          const tags = (e.tags ?? []).filter((x) => x === "rugger" || x === "kol" || x === "whale").join(" · ");
          const Row = onSelect ? "button" : "div";
          return (
            <Row key={e.wallet} {...(onSelect ? { type: "button" as const, onClick: () => onSelect(e.wallet) } : {})} className={`x-lane ${selected === e.wallet ? "on" : ""}`}>
              <div className="x-who">
                <div className="x-a">{name ?? <code>{short(e.wallet)}</code>}</div>
                <div className="x-b">
                  <span style={{ color: k.color }}>{t(k.label)}</span>
                  {` · ${t("{n} snipes / 48 h", { n: e.snipes48h })}`}
                  {tags ? ` · ${tags}` : ""}
                </div>
              </div>
              <div className="x-t2">
                <span className={`x-seg ${out === null ? "x-hold" : ""}`} style={{ left: `${a}%`, width: `${b - a}%` }} />
                <span className="x-o" style={{ left: `${a}%` }} />
                {out !== null && <span className="x-x" style={{ left: `${b}%` }} />}
                {out === null ? (
                  <small style={{ right: 0, padding: 0, top: -14 }}>{t("holds {p}", { p: pctFine(e.held) })}</small>
                ) : b > 80 ? (
                  <small style={{ right: `${100 - b}%`, padding: "0 9px 0 0", top: -14 }}>{t("out {s}", { s: spanOf(out) })}</small>
                ) : (
                  <small style={{ left: `${b}%` }}>{t("out {s}", { s: spanOf(out) })}</small>
                )}
              </div>
            </Row>
          );
        })}
      </div>
      <div className="x-lscale">
        <div />
        <div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i}>{i === 5 ? spanOf(MX) : MX <= 30 ? String((MX * i) / 5) : spanOf(Math.round((MX * i) / 5))}</span>
          ))}
        </div>
      </div>
    </>
  );
}

export function FirstPanel({ r, go, full, selected, onSelect }: Ctx & { full?: boolean; selected?: string | null; onSelect?: (w: string) => void }) {
  const f = r.check.facts;
  const early = r.early;
  return (
    <Pn id={full ? undefined : "first"} span={full ? "x-s7" : "x-s5"} title={t("First seconds")} meta={early.length ? t("bought → sold everything") : undefined} more={full || !early.length ? undefined : { label: t("all {n}", { n: early.length }), on: () => go("first") }}>
      {r.outsideStream ? (
        <p className="x-note">{t("This coin launched before our stream, so its first seconds are not on record.")}</p>
      ) : early.length ? (
        <>
          <Lanes early={early} max={full ? undefined : 5} selected={selected} onSelect={onSelect} />
          {!full && (
            <Kv
              rows={[
                [t("Supply they took · still hold"), `${pctFine(early.reduce((n, e) => n + e.bought, 0))} · ${pctFine(early.reduce((n, e) => n + e.held, 0))}`],
                [t("The creator's own crew"), String(f?.creatorCrew ?? 0), (f?.creatorCrew ?? 0) >= 2 ? "d" : ""],
                [t("In a sniper ring · serial snipers"), `${f?.ringWallets ?? 0} · ${f?.serialSnipers ?? 0}`, (f?.ringWallets ?? 0) >= 3 ? "d" : (f?.serialSnipers ?? 0) >= 2 ? "w" : ""],
              ]}
            />
          )}
        </>
      ) : (
        <>
          <p className="x-note">{t("Nobody bought before the token was visible: no snipers, no crew in the first seconds.")}</p>
          <Kv rows={[[t("Buyers"), String(f?.buyers ?? 0)], [t("Buys · sells"), `${f?.buys ?? 0} · ${f?.sells ?? 0}`], f?.bundlers ? [t("Later bought in bundles"), t("{n} wallets, peak {p}%", { n: f.bundlers, p: f.bundlersPeakPct ?? 0 }), (f.bundlersPeakPct ?? 0) >= 30 && !f.mayhem ? "d" : ""] : null]} />
        </>
      )}
    </Pn>
  );
}

/* ------------------------------------------------------------------ funding trace */

const BUYER_AT: Array<[number, number]> = [
  [120, 72],
  [112, 222],
  [362, 74],
  [390, 196],
];

/**
 * The money around the dev on one small map. Known: the dev and the wallets that bought first. Behind the deep check:
 * who funded each of them and where the SOL went, drawn as dashed "?" nodes until it is open; never invented.
 */
export function TraceGraph({ r, deep, onSol }: { r: XRayReport; deep: boolean; onSol?: () => void }) {
  const dev: [number, number] = [240, 146];
  const buyers = [...r.early].sort((a, b) => a.afterSec - b.afterSec).slice(0, 3);
  const fund = r.funding;
  const funderLabel = fund?.funder ? (fund.funderService ? t("{x} launcher", { x: fund.funderService }) : fund.funderLabel ?? (fund.funderIsHot ? t("an exchange") : short(fund.funder))) : fund ? t("no funder found") : t("not traced yet");
  const dots: ReactNode[] = [];
  for (let gx = 16; gx < 480; gx += 16) for (let gy = 16; gy < 300; gy += 16) dots.push(<circle key={`${gx}-${gy}`} cx={gx} cy={gy} r={0.7} fill="#1c2420" />);
  const label = (x: number, y: number, s: string, c: string, key: string) => (
    <text key={key} x={x} y={y} textAnchor="middle" fill={c} fontSize={11} fontFamily="Geist Mono, monospace">
      {s}
    </text>
  );
  const q = (x: number, y: number, key: string) => (
    <g key={key}>
      <circle cx={x} cy={y} r={10} fill="#030504" stroke="#3a4640" strokeDasharray="2 3" />
      {label(x, y + 4, "?", "#7d8681", `${key}l`)}
    </g>
  );
  const fp: [number, number] = [240, 40];
  const sol: [number, number] = [352, 252];
  return (
    <div className="x-graph">
      <svg viewBox="0 0 480 300" preserveAspectRatio="xMidYMid meet" role="img" aria-label={deep ? t("The dev, who funded them and the first buyers") : t("The dev and the first buyers are known; who funded them unlocks with a deep check")}>
        <g>{dots}</g>
        <g fill="none" strokeWidth={1.2}>
          {buyers.map((b, i) => {
            const [x, y] = BUYER_AT[i];
            return <path key={b.wallet} data-x="edge" pathLength={1} d={`M${dev[0]} ${dev[1]} Q ${(dev[0] + x) / 2} ${dev[1] - 16} ${x} ${y}`} stroke="#4a5a52" />;
          })}
          {!deep &&
            buyers.map((b, i) => {
              const [x, y] = BUYER_AT[i];
              const fx = x + (x < 240 ? -70 : 70);
              const fy = y + (i === 1 ? 40 : -30);
              return <path key={`f${b.wallet}`} d={`M${x} ${y} L ${fx} ${fy}`} stroke="#2a332e" strokeDasharray="3 4" />;
            })}
          {deep && fund?.funder ? <path data-x="edge" pathLength={1} d={`M${dev[0]} ${dev[1]} L ${fp[0]} ${fp[1] + 8}`} stroke="#e8a23a" /> : <path d={`M${dev[0]} ${dev[1]} L ${fp[0]} ${fp[1] + 10}`} stroke="#2a332e" strokeDasharray="3 4" />}
          <path d={`M${dev[0]} ${dev[1]} Q 300 210 ${sol[0] - 4} ${sol[1] - 6}`} stroke={deep ? "#4a5a52" : "#2a332e"} strokeDasharray={deep ? undefined : "3 4"} />
        </g>
        <g>
          {!deep &&
            buyers.map((b, i) => {
              const [x, y] = BUYER_AT[i];
              return q(x + (x < 240 ? -70 : 70), y + (i === 1 ? 40 : -30), `q${b.wallet}`);
            })}
          {buyers.map((b, i) => {
            const [x, y] = BUYER_AT[i];
            const name = whoOf(b) ?? short(b.wallet);
            return (
              <g key={`n${b.wallet}`}>
                <circle cx={x} cy={y} r={5} fill="#e6e9e7" />
                {label(x, y - 12, name.length > 14 ? `${name.slice(0, 13)}…` : name, "#aab2ad", `bl${b.wallet}`)}
              </g>
            );
          })}
          {deep && fund?.funder ? (
            <g>
              <circle cx={fp[0]} cy={fp[1]} r={6} fill="#e8a23a" />
              {label(fp[0] + 0, fp[1] - 12, t("funded by {x}", { x: funderLabel }), "#e8a23a", "fl")}
            </g>
          ) : deep ? (
            <g>
              <circle cx={fp[0]} cy={fp[1]} r={6} fill="none" stroke="#3a4640" />
              {label(fp[0], fp[1] - 12, funderLabel, "#7d8681", "fl")}
            </g>
          ) : (
            q(fp[0], fp[1], "qf")
          )}
          {deep ? (
            <g onClick={onSol} style={{ cursor: onSol ? "pointer" : undefined }}>
              <circle cx={sol[0]} cy={sol[1]} r={6} fill="none" stroke="#f4f5f4" />
              {label(sol[0], sol[1] + 22, t("where the SOL went →"), "#f4f5f4", "sl")}
            </g>
          ) : (
            <>
              {q(sol[0], sol[1], "qs")}
              {label(sol[0], sol[1] + 26, t("where the SOL went"), "#7d8681", "sl")}
            </>
          )}
          <circle cx={dev[0]} cy={dev[1]} r={14} fill="none" stroke="#ff5a4f" strokeOpacity={0.35} />
          <circle cx={dev[0]} cy={dev[1]} r={7} fill="#ff5a4f" />
          {label(dev[0], dev[1] + 28, t("dev {a}", { a: short(r.creator) }), "#ff5a4f", "dl")}
        </g>
      </svg>
    </div>
  );
}

export function TracePanel({ r, access, go, unlock, span = "x-s4" }: Ctx & { span?: string }) {
  const free = useFreeDeepCheck(r.mint);
  const fund = r.funding;
  const known = 1 + Math.min(3, r.early.length);
  return (
    <Pn id="deep" span={span} title={t("Funding trace")} tag={access.deep ? undefined : t("Pro")} meta={access.deep ? t("who paid the dev") : t("deep check")}>
      <TraceGraph r={r} deep={access.deep} onSol={() => go("sol")} />
      <div className="x-cap">
        {access.deep ? (
          <>
            <div>
              <b>{fund?.funder ? (fund.funderIsHot || fund.funderService ? t("Funded from {x}", { x: fund.funderService ?? fund.funderLabel ?? t("an exchange") }) : t("Funder paid {n} other creators", { n: fund.siblings.length })) : fund ? t("No funding transfer found") : t("Not traced yet")}</b>
              <span>{fund?.funder && !fund.funderIsHot ? t("{l} launches · {d} dumps between them in 48 h", { l: fund.siblingLaunches48h, d: fund.siblingDumped48h }) : t("the dev wallet's own transfers")}</span>
            </div>
            <button type="button" className="x-mbtn" onClick={() => go("trace")}>
              {t("Open the map")}
            </button>
          </>
        ) : (
          <>
            <div>
              <b>{t("{n} wallets known, funders locked", { n: known })}</b>
              <span>{free.message ? t(free.message) : t("1 free deep check a week, opens soon")}</span>
            </div>
            <button type="button" className="x-mbtn" onClick={unlock}>
              {t("Unlock")}
            </button>
          </>
        )}
      </div>
    </Pn>
  );
}

/* ------------------------------------------------------------------ pro */

export function ProPanel({ access, span = "x-s3" }: { access: Ctx["access"]; span?: string }) {
  const [per, setPer] = useState<Period>("week");
  const [msg, setMsg] = useState<string | null>(null);
  const p = PRICES[per];
  if (access.pro)
    return (
      <Pn id="pro" span={span} title={t("Pro")} meta={access.until ? t("until {d}", { d: new Date(access.until).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) }) : t("active")}>
        <p className="x-big">{t("Deep check is open")}</p>
        <ul className="x-feat">
          <li>{t("Who paid the dev, and who else they paid")}</li>
          <li>{t("Where the SOL went")}</li>
          <li>{t("Every early wallet's history")}</li>
          <li>{t("Every caller, set against the chain")}</li>
        </ul>
        <div className="x-fine">{t("Thanks for running the zoo. 10% of every pass buys $ZOOAGENCY back.")}</div>
      </Pn>
    );
  const pick = (k: Period) => {
    setPer(k);
    setMsg(null);
  };
  return (
    <Pn id="pro" span={span} title={t("Pro")} meta={t("soon")}>
      <div className="x-seg3" role="radiogroup" aria-label={t("Pro period")}>
        {(["day", "week", "month"] as Period[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={per === k} onClick={() => pick(k)}>
            {t(k === "day" ? "Day" : k === "week" ? "Week" : "Month")}
          </button>
        ))}
      </div>
      <div className="x-price">
        <span className="x-p">{t("Soon")}</span>
      </div>
      <div className="x-save">{t("Day, week and month passes. Prices and payment open soon.")}</div>
      <ul className="x-feat">
        <li>{t("Who paid the dev, and who else they paid")}</li>
        <li>{t("Where the SOL went")}</li>
        <li>{t("Every early wallet's history")}</li>
        <li>{t("Every caller, set against the chain")}</li>
      </ul>
      <button type="button" className="x-mbtn x-wide" disabled aria-disabled="true">
        {t("Soon")}
      </button>
      {msg && <div className="x-msg">{msg}</div>}
      <div className="x-fine">
        {t("Until then the X-Ray stays fully free.")}
      </div>
    </Pn>
  );
}

/* ------------------------------------------------------------------ trade */

export function TradeStrip({ r }: Ctx) {
  const [open, setOpen] = useState(false);
  const evm = chainOf(r.mint) !== "solana";
  const s = sym(r);
  const risky = r.check.verdict === "avoid";
  const fee = !evm && swapEnabled() ? `${FEE_BPS / 100}% ${t("fee")}` : null;
  const terms = TERMINALS(r.mint);
  return (
    <section className="x-pn x-s12" id="trade" aria-label={t("Trade")}>
      <div className="x-trade">
        <span className="x-t">{t("We don't stop you from aping. We show you who you're buying from.")}</span>
        {(evm || swapEnabled()) && (
          <button type="button" className={`x-btn ${risky ? "x-risk" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
            {risky ? t("Buy ${s} anyway", { s }) : t("Buy ${s}", { s })} {fee && <small>{fee}</small>}
          </button>
        )}
        {terms.slice(0, 2).map((x) => (
          <a key={x.k} className="x-btn" href={x.href} target="_blank" rel="noopener noreferrer">
            <img src={x.icon} alt="" width={16} height={16} loading="lazy" />
            {t("Open in {x}", { x: x.k })}
          </a>
        ))}
        {terms.slice(2).map((x) => (
          <a key={x.k} className="x-ico" href={x.href} target="_blank" rel="noopener noreferrer" title={x.k} aria-label={x.k}>
            <img src={x.icon} alt="" width={16} height={16} loading="lazy" />
          </a>
        ))}
      </div>
      {open && (
        <div className="x-swap">
          <div>{evm ? <div style={{ marginTop: 12 }}><TradeOnEvm mint={r.mint} flap={r.check.facts?.venue === "flap"} /></div> : <Swap mint={r.mint} symbol={r.symbol} />}</div>
          <div style={{ paddingTop: 14 }}>
            <p className="x-note">
              {risky ? t("The verdict on ${s} is avoid. If you buy anyway, size it like money you can lose in a minute: the dev's record above is what usually happens next.", { s }) : t("Size it like money you can lose. The verdict reads the people around the coin, not where the price goes.")}
            </p>
            <p className="x-fine">{t("Routed by Jupiter and signed by your own wallet; nothing is held by us. Not financial advice.")}</p>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ factors */

export function FactorsPanel({ r, span = "x-s8" }: { r: XRayReport; span?: string }) {
  const [every, setEvery] = useState(false);
  const rows = factorsOf(r);
  if (!rows.length) return null;
  const flags = rows.filter((x) => x.bad).length;
  const loud = rows.filter((x) => x.bad || x.good);
  const shown = every || loud.length < 4 ? rows : loud;
  return (
    <Pn span={span} title={t("Every factor, counted")} meta={flags ? t("{n} of {m} look bad", { n: flags, m: rows.length }) : t("none of {m} look bad", { m: rows.length })}>
      <dl className="x-fac">
        {shown.map((x) => (
          <div key={x.k}>
            <div style={{ minWidth: 0 }}>
              <dt>{x.k}</dt>
              <p>{x.d}</p>
            </div>
            <dd className={x.bad ? "x-d" : x.good ? "x-up" : ""}>{x.v}</dd>
          </div>
        ))}
      </dl>
      {shown.length < rows.length || every ? (
        <button type="button" className="x-link" style={{ marginTop: 10, fontSize: 12 }} onClick={() => setEvery(!every)}>
          {every ? t("show only what stands out") : t("+ {n} more factors, nothing unusual", { n: rows.length - shown.length })}
        </button>
      ) : null}
    </Pn>
  );
}

/* ------------------------------------------------------------------ share */

export function SharePanel({ r, span = "x-s4" }: { r: XRayReport; span?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [png, setPng] = useState<string | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    setPng(null);
    void drawXRay(canvas.current, r).then(() => setPng(canvas.current!.toDataURL("image/png")));
  }, [r]);
  const c = r.check;
  const tweet = encodeURIComponent([`x-rayed $${sym(r)}: ${TONE[c.verdict].label.toLowerCase()}.`, c.reasons[0] ?? "", "", `see who you're buying from: zooaiagency.com/xray?mint=${r.mint}`].filter((x, i) => i !== 1 || x).join("\n"));
  return (
    <Pn span={span} title={t("Share or watch")} meta={t("the bot pings when the dev sells")}>
      <canvas ref={canvas} hidden />
      {png ? <img src={png} alt={t("X-ray card")} style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 8, border: "1px solid var(--line)", display: "block" }} /> : <div className="x-sk" style={{ aspectRatio: "16 / 9" }} />}
      <div className="x-acts">
        <a className="x-mbtn" href={`${BOT_URL}?start=w-${r.mint}`} target="_blank" rel="noopener noreferrer">
          {t("Watch in Telegram")}
        </a>
        <a className="x-btn" href={`https://x.com/intent/post?text=${tweet}`} target="_blank" rel="noopener noreferrer">
          {t("Post on X")}
        </a>
        <a className="x-btn" href={png ?? undefined} download={`xray-${sym(r)}-${r.mint.slice(0, 6)}.png`} aria-disabled={!png}>
          {t("Card")}
        </a>
      </div>
    </Pn>
  );
}

/* ------------------------------------------------------------------ $ZOOAGENCY */

export function CopyCa({ id }: { id: string }) {
  const [state, setState] = useState<"Copy" | "Copied" | "Selected">("Copy");
  const copy = () => {
    const ok = () => {
      setState("Copied");
      setTimeout(() => setState("Copy"), 1600);
    };
    const sel = () => {
      const el = document.getElementById(id);
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      setState("Selected");
    };
    try {
      navigator.clipboard.writeText(ZOOAGENCY_MINT).then(ok, sel);
    } catch {
      sel();
    }
  };
  return (
    <div className="x-carow">
      <code id={id}>{ZOOAGENCY_MINT}</code>
      <button type="button" className={`x-copy ${state === "Copied" ? "ok" : ""}`} onClick={copy}>
        {t(state)}
      </button>
    </div>
  );
}

export function TokenPanel() {
  return (
    <section className="x-pn x-s12 x-mtok" aria-label="$ZOOAGENCY">
      <div className="x-ph">
        <h2>$ZOOAGENCY</h2>
        <span className="x-m">{t("Hold 500k: the weekly contest")}</span>
      </div>
      <div className="x-pb">
        <CopyCa id="x-ca2" />
        <a className="x-buy" href={ZOOAGENCY_CLAWPUMP_URL} target="_blank" rel="noopener noreferrer">
          {t("Buy on ClawPump")}
        </a>
      </div>
    </section>
  );
}


const whenOf = (at: number) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** A coin read from the chain on demand, or one whose mint is older than its pool: both times, said plainly. */
function BirthNote({ r }: { r: XRayReport }) {
  const b = r.birth;
  if (!b) return null;
  return (
    <p className="x-note" style={{ margin: "6px 0 0" }}>
      {b.adopted && b.adoptedAt ? t("Launched before we watched, reading live since {at}.", { at: whenOf(b.adoptedAt) }) + " " : ""}
      {b.mintCreatedAt ? t("Coin created {c}, pool opened {p}.", { c: whenOf(b.mintCreatedAt), p: whenOf(b.poolOpenedAt) }) : b.adopted ? t("Pool opened {p}.", { p: whenOf(b.poolOpenedAt) }) : ""}
    </p>
  );
}
