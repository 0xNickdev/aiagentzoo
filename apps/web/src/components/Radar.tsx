import { useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { t, tChain } from "../i18n";
import { BOT_URL } from "../links";
import { nodeOf, shortAddress, useGuardian } from "../zoo";
import RadarDisc from "./RadarDisc";
import RadarSoon from "./RadarSoon";
import { TrackRecord, useRadarRecord } from "./TrackRecord";
import { radarOpen } from "../radarRelease";
import { Btn, Page, Panel } from "./site/Panel";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
/** Signals younger than this sit in the live list; older ones move to the history with what came of them. */
const LIVE_MS = 2 * 3_600_000;

interface Signal {
  mint: string;
  symbol: string;
  at: number;
  createdAt: number;
  capAtSignal: number;
  tier: "strong" | "watch";
  models: Array<"RB" | "G">;
  reasons: string[];
  capNow: number | null;
  xNow: number | null;
  /** Confirmed at minute twenty (capAtSignal is then the minute-20 cap), or a minute-five candidate. */
  stage?: "candidate" | "confirmed" | "rejected";
  confirmedAt?: number;
  capAt5?: number;
  upX?: number;
  outcome?: { peakCap: number; peakX: number; graduated: boolean };
}
/** When a signal counts as fired: its confirmation, or minute five for a candidate. */
const when = (s: Signal) => s.confirmedAt ?? s.at;
interface Tally {
  n: number;
  x2: number;
  x5: number;
  graduated: number;
  medianPeakX: number | null;
}
interface RadarBody {
  access: "live" | "delayed";
  delayMin: number;
  state?: "sign-in" | "holders";
  model: { frozenAt: number };
  stats: { settledAfterHours: number; days: number; all: Tally };
  today?: { scored: number; signals: number; lastSignalAt?: number | null };
  signals: Signal[];
  /** The minute-five candidates, for holders who ask with ?stage=early. */
  candidates?: Signal[];
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86_400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86_400)}d`;
};
/** "12 min ago" style for the counter: words, not a bare letter. */
const agoLong = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? t("{n} s", { n: s }) : s < 3600 ? t("{n} min", { n: Math.round(s / 60) }) : s < 86_400 ? t("{n} h", { n: Math.round(s / 3600) }) : t("{n} d", { n: Math.round(s / 86_400) });
};
/** The SOL price north sent with the signals; caps read in dollars once it is known. */
let radarSolUsd: number | null = null;
const usdShort = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}k`);
const sol = (v: number | null | undefined) => (v == null ? "-" : radarSolUsd ? usdShort(v * radarSolUsd) : `${v >= 100 ? Math.round(v) : v.toFixed(1)} SOL`);
/** "237 SOL cap at 5 minutes" in dollars when the price is known. */
const dollarReason = (r: string) => {
  if (!radarSolUsd) return r;
  const m = /^([\d.]+) SOL cap at 5 minutes$/.exec(r);
  if (m) return `${usdShort(Number(m[1]) * radarSolUsd)} cap at 5 minutes`;
  const n = /^([\d.]+) SOL in$/.exec(r);
  if (n) return `${usdShort(Number(n[1]) * radarSolUsd)} in`;
  return r;
};
const times = (v: number | null | undefined) => (v == null ? "-" : `${v >= 10 ? Math.round(v) : v.toFixed(1)}x`);

/** A number that eases to its new value instead of jumping; instant when the reader asks for less motion. */
function Morph({ value, format }: { value: number | null; format: (v: number | null) => string }) {
  const still = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (still || value == null || from.current == null) {
      from.current = value;
      return void setShown(value);
    }
    const a = from.current, b = value, t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 500);
      const v = a + (b - a) * (1 - (1 - k) ** 3);
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, still]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

/** A cell that washes grey for a moment when its value changes, with an up or down glyph (never colour alone). */
function Wash({ value, children }: { value: number | null; children: React.ReactNode }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<0 | 1 | -1>(0);
  useEffect(() => {
    if (prev.current != null && value != null && value !== prev.current) {
      setDir(value > prev.current ? 1 : -1);
      const h = window.setTimeout(() => setDir(0), 1_400);
      prev.current = value;
      return () => window.clearTimeout(h);
    }
    prev.current = value;
  }, [value]);
  return (
    <span className={`rounded-[4px] px-1 ${dir ? "bg-white/15" : "bg-transparent"}`} style={{ transition: dir ? "none" : "background-color 1.4s" }}>
      {children}
      <span aria-hidden className="ml-0.5 inline-block w-2 text-dim">{dir === 1 ? "↑" : dir === -1 ? "↓" : ""}</span>
    </span>
  );
}

/** Its own width, so the table turns into cards in a narrow column, not only on a narrow screen. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    if (!ref.current) return;
    const o = new ResizeObserver(([e]) => e && setW(e.contentRect.width));
    o.observe(ref.current);
    return () => o.disconnect();
  }, []);
  return [ref, w] as const;
}

/** The runner radar: coins the frozen models see real demand on at minute five; live for holders, an hour late for everyone else. */
export function RadarLive() {
  const { session, signIn, busy, error: signError } = useGuardian();
  const [data, setData] = useState<RadarBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [tg, setTg] = useState<{ code: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  /** Holders can look at the minute-five candidates, before the minute-20 confirmation. */
  const [early, setEarly] = useState(false);
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const seen = useRef<Set<string> | null>(null);
  const record = useRadarRecord();

  useEffect(() => {
    let live = true;
    const guardian = session ? { publicKey: session.publicKey, message: session.message, signature: session.signature } : null;
    const load = () =>
      fetch(`${NORTH}/v1/radar${early ? "?stage=early" : ""}`, guardian ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guardian }) } : undefined)
        .then(async (r) => {
          // A 403 still carries the hour-late list: the page shows that, with the reason live is locked.
          if (!r.ok && r.status !== 403) throw new Error(String(r.status));
          return (await r.json()) as RadarBody;
        })
        .then((b) => {
          if (!live) return;
          radarSolUsd = (b as { solUsd?: number | null }).solUsd ?? radarSolUsd;
          setData(b);
          setFailed(false);
          // Screen readers hear new signals, at most once per poll.
          const fresh = b.signals.filter((s) => seen.current && !seen.current.has(s.mint));
          seen.current = new Set(b.signals.map((s) => s.mint));
          if (fresh.length) setSaid(t("{n} new signal: {s}", { n: fresh.length, s: fresh.map((s) => `$${s.symbol}`).join(", ") }));
        })
        .catch(() => live && setFailed(true));
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 5_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [session, tick, early]);
  // Ages tick every second between polls.
  const [, setNow] = useState(0);
  useEffect(() => {
    const h = window.setInterval(() => setNow((n) => n + 1), 1_000);
    return () => window.clearInterval(h);
  }, []);

  const linkTelegram = async () => {
    if (!session) return void signIn();
    const n = await nodeOf("beaver");
    const r = n
      ? await fetch(`${n.url}/v1/tg/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guardian: { publicKey: session.publicKey, message: session.message, signature: session.signature } }) }).catch(() => null)
      : null;
    if (r?.ok) setTg((await r.json()) as { code: string });
    else setNote(t("Could not make a code. Try again in a minute."));
  };

  const now = Date.now();
  const holder = data?.access === "live";
  const showEarly = holder && early && Array.isArray(data?.candidates);
  const list = showEarly ? data!.candidates! : (data?.signals ?? []);
  const recent = list.filter((s) => now - when(s) < LIVE_MS);
  const past = list.filter((s) => now - when(s) >= LIVE_MS);
  const best = (data?.signals ?? [])
    .filter((s) => s.outcome && now - when(s) < 24 * 3_600_000)
    .sort((a, b) => (b.outcome?.peakX ?? 0) - (a.outcome?.peakX ?? 0))[0];
  const a = data?.stats.all;
  // The node says when the newest signal fired to everyone (time only), so the hour-late page is not stuck on "-".
  const lastAt = data?.today?.lastSignalAt ?? (data?.signals[0] ? when(data.signals[0]) : null);
  const frozen = data ? new Date(data.model.frozenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "21 Nov";
  const cards = width < 640;

  return (
    <Page
      title={t("Runner radar")}
      lead={t("Coins the model sees real demand on, five minutes in. A signal is not a call to buy: it is a watchlist of launches where buyers just showed up.")}
      side={
        <span className="flex items-center gap-2 text-[12px] text-dim">
          <span className={`h-1.5 w-1.5 rounded-full ${holder ? "animate-pulse bg-white" : "bg-dim"}`} />
          {holder ? t("Live · holders") : t("An hour late · live for holders of 500,000 $ZOOAGENCY")}
        </span>
      }
    >
      <p className="sr-only" aria-live="polite">{said}</p>

      <section className="mb-3 grid items-center gap-5 rounded-[12px] border border-line bg-night-surface p-4 sm:grid-cols-[minmax(0,320px)_1fr]">
        <div className="mx-auto w-full max-w-[320px]">
          <RadarDisc blips={recent.map((s) => ({ ...s, at: when(s) }))} active={active} onActive={setActive} />
        </div>
        <div className="grid min-w-0 grid-cols-3 gap-3">
          <Counter k={t("confirmed today")} v={data?.today?.signals ?? null} />
          <Counter k={t("coins scored today")} v={data?.today?.scored ?? null} />
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[12px] text-dim">{t("last confirmed")}</span>
            <span className="text-[22px] font-medium leading-none tracking-[-0.035em] text-white sm:text-[28px] tabular-nums">{lastAt ? t("{a} ago", { a: agoLong(lastAt) }) : "-"}</span>
          </div>
          <p className="col-span-3 text-[12.5px] leading-[1.55] text-fg-2">
            {t("A signal is confirmed at minute 20: the coin is up at least 20% since minute five and the dev has not sold half. About 20-30 a day.")}
          </p>
          <p className="col-span-3 text-[12.5px] leading-[1.55] text-dim">
            {t("Each square is a live signal: nearer the centre is fresher, filled is strong, outlined is watch. The model is frozen since {d} and graded publicly.", { d: frozen })}
          </p>
        </div>
      </section>

      {!holder && (
        <div className="mb-3 flex flex-col gap-3 rounded-[12px] border border-line bg-night-surface p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] leading-[1.55] text-fg-2">
            {data?.state === "holders"
              ? t("This wallet holds less than 500,000 $ZOOAGENCY, so you see signals an hour after they fire. Top up and the page goes live, no need to sign in again.")
              : t("Signals fire live for holders of 500,000 $ZOOAGENCY. Everyone else sees them an hour later, with what happened since.")}
          </p>
          {!session ? (
            <Btn primary onClick={() => void signIn()}>
              {busy ? t("Signing…") : t("Sign in with your wallet")}
            </Btn>
          ) : (
            <Btn href="/token">{t("Get $ZOOAGENCY")}</Btn>
          )}
        </div>
      )}
      {signError && <p className="mb-3 text-[12.5px] text-danger">{signError}</p>}

      {best && best.outcome && best.outcome.peakX >= 2 ? (
        <a
          href={`/xray?mint=${best.mint}`}
          className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[10px] border border-line bg-panel px-4 py-3 text-[14px] text-fg-2 hover:border-line-2"
        >
          <span className="text-faint">{t("best signal of the last 24 hours")}:</span>
          <span className="font-medium text-white">${best.symbol}</span>
          <span className="font-medium text-white tabular-nums">{times(best.outcome.peakX)}</span>
          <span className="tabular-nums">
            {sol(best.capAtSignal)} → {sol(best.outcome.peakCap)} {t("from confirmation to peak")}
            {best.outcome.graduated ? `, ${t("graduated")}` : ""}
          </span>
          <span className="ml-auto text-faint">{t("{a} ago", { a: ago(when(best)) })} · X-Ray ↗</span>
        </a>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel title={t("Signals")} meta={showEarly ? t("the minute-five candidates, before confirmation") : holder ? t("the last 2 hours · refreshes every 5 seconds") : t("the last 2 hours, an hour late")} className="lg:col-span-8" bodyClass="p-0">
          <div ref={boxRef}>
            {holder && (
              <div className="flex items-center justify-end border-b border-line px-3.5 py-2">
                <button
                  type="button"
                  aria-pressed={early}
                  onClick={() => setEarly((v) => !v)}
                  className={`rounded-[6px] border px-2 py-0.5 text-[12px] ${early ? "border-white text-white" : "border-line-2 text-dim hover:text-white"}`}
                >
                  {t("Early (minute 5)")}
                </button>
              </div>
            )}
            {failed && !data && (
              <div className="flex items-center justify-between gap-3 px-3.5 py-6 text-[12.5px] text-dim">
                {t("The chain reader did not answer.")}
                <Btn onClick={() => setTick((n) => n + 1)}>{t("Retry")}</Btn>
              </div>
            )}
            {!data && !failed && Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[86px] animate-pulse border-b border-line bg-night-raised/40" />)}
            {data && !recent.length && <p className="px-3.5 py-8 text-center text-[12.5px] text-faint">{t("Waiting for the next signal. Most hours have a few; some have none.")}</p>}
            {!cards && recent.length > 0 && (
              <div className="grid grid-cols-[minmax(0,1.4fr)_70px_90px_120px_70px_60px] gap-x-3 border-b border-line px-3.5 py-2 text-[11.5px] text-faint">
                <span>{t("Coin and why")}</span>
                <span>{t("Age")}</span>
                <span className="text-right">{t(showEarly ? "Cap at signal" : "Cap at confirmation")}</span>
                <span className="text-right">{t("Cap now, move")}</span>
                <span>{t("Tier")}</span>
                <span />
              </div>
            )}
            {recent.map((s) => (
              <div
                key={s.mint}
                onPointerEnter={() => setActive(s.mint)}
                onPointerLeave={() => setActive(null)}
                className={`radar-row border-b border-line last:border-0 ${active === s.mint ? "bg-night-raised" : ""}`}
              >
                {cards ? <Card s={s} /> : <Line s={s} />}
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-3 lg:col-span-4">
          <Panel title={t("The silent trial")} meta={t("model frozen 21 Nov")}>
            <p className="text-[13px] leading-[1.55] text-fg-2">
              {t("Frozen on 21 Nov and left to watch 38,976 fresh pump.fun coins. Its sharpest picks graduated 46% of the time, against 1.3% for a random launch.")}
            </p>
            {a && a.n ? (
              <p className="mt-2 text-[12px] leading-[1.55] text-dim">
                {t("Live record, last {d} days: {n} settled confirmed signals; {x2} moved 2x past their cap at confirmation and {g} graduated. A peak is the highest cap after confirmation, not a price anyone sold at.", { d: data?.stats.days ?? 7, n: a.n, x2: a.x2, g: a.graduated })}
              </p>
            ) : (
              <p className="mt-2 text-[12px] text-dim">{t("No settled signals yet: a signal counts once it is a day old.")}</p>
            )}
          </Panel>
          <Panel title={t("In Telegram")} meta={t("holders")}>
            <p className="text-[13px] leading-[1.55] text-fg-2">{t("Link your wallet to the bot, then send /radar on for confirmed signals, or /radar all for the minute-five candidates too.")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!session ? (
                <Btn onClick={() => void signIn()}>{t("Sign in with your wallet")}</Btn>
              ) : tg ? (
                <Btn href={`${BOT_URL}?start=link-${tg.code}`}>{t("Open the bot to link ↗")}</Btn>
              ) : (
                <Btn onClick={() => void linkTelegram()}>{t("Link Telegram")}</Btn>
              )}
              {session && <span className="font-mono text-[12px] text-dim">{shortAddress(session.publicKey)}</span>}
            </div>
            {tg && (
              <p className="mt-2 text-[12px] text-dim">
                {t("Or send")} <span className="font-mono text-fg-2">/link {tg.code}</span> {t("to the bot. The code lasts 15 minutes.")}
              </p>
            )}
            {note && <p className="mt-2 text-[12px] text-danger">{note}</p>}
          </Panel>
        </div>

        <TrackRecord rec={record} />

        <Panel title={t("History")} meta={t(showEarly ? "how each coin moved after its signal" : "how each coin moved after confirmation")} className="lg:col-span-12" bodyClass="p-0">
          {data && !past.length ? (
            <p className="px-3.5 py-8 text-center text-[12.5px] leading-[1.55] text-faint">{t("Nothing older than two hours yet.")}</p>
          ) : cards ? (
            <div>
              {past.slice(0, 150).map((s) => (
                <PastCard key={s.mint} s={s} />
              ))}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead className="text-[11.5px] text-faint">
                <tr className="border-b border-line">
                  <th className="px-3.5 py-2 font-normal">{t("Coin")}</th>
                  <th className="px-3.5 py-2 font-normal">{t("Signal")}</th>
                  <th className="px-3.5 py-2 font-normal">{t("Tier")}</th>
                  <th className="px-3.5 py-2 text-right font-normal">{t(showEarly ? "Cap at signal" : "Cap at confirmation")}</th>
                  <th className="px-3.5 py-2 text-right font-normal">{t("Highest after")}</th>
                  <th className="px-3.5 py-2 text-right font-normal">{t("Now")}</th>
                  <th className="px-3.5 py-2 text-right font-normal">{t("Graduated")}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {past.slice(0, 150).map((s) => (
                  <tr key={s.mint} className="border-b border-line last:border-0">
                    <td className="px-3.5 py-2">
                      <a href={`/xray?mint=${s.mint}`} className="font-medium text-white hover:underline">
                        ${s.symbol}
                      </a>
                    </td>
                    <td className="px-3.5 py-2 text-dim">{t("{a} ago", { a: ago(when(s)) })}</td>
                    <td className="px-3.5 py-2 text-dim">{stageNote(s) ?? t(s.tier)}</td>
                    <td className="px-3.5 py-2 text-right text-fg-2">{sol(s.capAtSignal)}</td>
                    <td className="px-3.5 py-2 text-right text-fg-2">{s.outcome ? `${sol(s.outcome.peakCap)} · ${times(s.outcome.peakX)}` : "-"}</td>
                    <td className="px-3.5 py-2 text-right text-fg-2">{s.capNow == null ? "-" : `${sol(s.capNow)} · ${times(s.xNow)}`}</td>
                    <td className="px-3.5 py-2 text-right text-fg-2">{s.outcome ? t(s.outcome.graduated ? "yes" : "no") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </Panel>
      </div>

      <p className="mt-3 max-w-[90ch] text-[12px] leading-[1.6] text-dim">
        {t("How it works: two logistic models, one for coins that reach a 1,000 SOL cap and triple from minute five, one for graduation, fitted on 79,490 five-minute readings and frozen on {d}. Strong means the top 0.5% of either, watch the top 1%. The moves shown are the coin's, not a trade anyone made. A signal is not a call to buy and not advice.", { d: frozen })}
      </p>
    </Page>
  );
}

function Counter({ k, v }: { k: string; v: number | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-[12px] text-dim">{k}</span>
      <span className="text-[22px] font-medium leading-none tracking-[-0.035em] text-white sm:text-[28px]">
        <Morph value={v} format={(x) => (x == null ? "-" : Math.round(x).toLocaleString("en-US"))} />
      </span>
    </div>
  );
}

/** A candidate says it is early or failed the minute-20 check; a confirmed signal shows only its tier. */
const stageNote = (s: Signal) => (s.stage === "rejected" ? t("rejected at minute 20") : s.stage === "candidate" ? t("early, not confirmed") : null);
const Tier = ({ s }: { s: Signal }) => (
  <span className={`inline-block rounded-[4px] border px-[5px] text-[10.5px] leading-4 ${s.tier === "strong" ? "border-white text-white" : "border-line-2 text-dim"}`}>{t(s.tier)}</span>
);
/** "up 1.6x since minute 5" under a confirmed signal's cap, or why a candidate is not confirmed. */
const Since = ({ s }: { s: Signal }) => {
  const note = stageNote(s);
  if (note) return <span className="block text-[11.5px] text-faint">{note}</span>;
  return s.upX != null ? <span className="block text-[11.5px] text-faint">{t("up {x}x since minute 5", { x: s.upX.toFixed(1) })}</span> : null;
};
const Now = ({ s }: { s: Signal }) => (
  <Wash value={s.capNow}>
    <span className="text-white">
      <Morph value={s.capNow} format={sol} />
    </span>{" "}
    <span className="text-dim">
      <Morph value={s.xNow} format={times} />
    </span>
    {s.outcome && s.outcome.peakX > (s.xNow ?? 0) ? (
      <span className="block text-[11.5px] text-faint">
        {t("peak")} <span className="text-fg-2">{sol(s.outcome.peakCap)}</span> {times(s.outcome.peakX)}
        {s.outcome.graduated ? ` · ${t("graduated")}` : ""}
      </span>
    ) : null}
  </Wash>
);

function Line({ s }: { s: Signal }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_70px_90px_120px_70px_60px] items-start gap-x-3 px-3.5 py-3 text-[12.5px]">
      <div className="min-w-0">
        <a href={`/xray?mint=${s.mint}`} className="truncate text-[15px] font-medium tracking-[-0.02em] text-white hover:underline">
          ${s.symbol}
        </a>
        <ul className="mt-1 flex flex-col gap-0.5 text-fg-2">
          {s.reasons.map((r) => (
            <li key={r}>{tChain(dollarReason(r))}</li>
          ))}
        </ul>
      </div>
      <span className="pt-0.5 text-dim tabular-nums">{ago(when(s))}</span>
      <span className="pt-0.5 text-right text-fg-2 tabular-nums">
        {sol(s.capAtSignal)}
        <Since s={s} />
      </span>
      <span className="pt-0.5 text-right">
        <Now s={s} />
      </span>
      <span className="pt-0.5">
        <Tier s={s} />
      </span>
      <a href={`/xray?mint=${s.mint}`} className="pt-0.5 text-right text-dim hover:text-white">
        {t("X-Ray ↗")}
      </a>
    </div>
  );
}

function Card({ s }: { s: Signal }) {
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3 text-[12.5px]">
      <div className="flex items-baseline gap-2">
        <a href={`/xray?mint=${s.mint}`} className="truncate text-[16px] font-medium tracking-[-0.02em] text-white hover:underline">
          ${s.symbol}
        </a>
        <Tier s={s} />
        <span className="ml-auto text-faint tabular-nums">{t("{a} ago", { a: ago(when(s)) })}</span>
      </div>
      <ul className="flex flex-col gap-0.5 text-fg-2">
        {s.reasons.map((r) => (
          <li key={r}>{tChain(dollarReason(r))}</li>
        ))}
      </ul>
      <Since s={s} />
      <div className="flex items-center gap-4">
        <span>
          <span className="text-faint">{t("at signal")}</span> <span className="text-fg-2 tabular-nums">{sol(s.capAtSignal)}</span>
        </span>
        <span>
          <span className="text-faint">{t("now")}</span> <Now s={s} />
        </span>
        <a href={`/xray?mint=${s.mint}`} className="ml-auto text-dim hover:text-white">
          {t("X-Ray ↗")}
        </a>
      </div>
    </div>
  );
}

/** A history row as a card for a narrow column: the same six facts, two to a line. */
function PastCard({ s }: { s: Signal }) {
  const fact = (k: string, v: string) => (
    <span className="flex min-w-0 justify-between gap-2">
      <span className="text-faint">{k}</span>
      <span className="truncate text-fg-2 tabular-nums">{v}</span>
    </span>
  );
  return (
    <div className="flex flex-col gap-2 border-b border-line px-3.5 py-3 text-[12.5px] last:border-0">
      <div className="flex items-baseline gap-2">
        <a href={`/xray?mint=${s.mint}`} className="truncate text-[15px] font-medium tracking-[-0.02em] text-white hover:underline">
          ${s.symbol}
        </a>
        <Tier s={s} />
        <span className="ml-auto text-faint tabular-nums">{t("{a} ago", { a: ago(when(s)) })}</span>
      </div>
      <div className="grid grid-cols-1 gap-y-1">
        {fact(t(s.stage === "confirmed" ? "Cap at confirmation" : "Cap at signal"), sol(s.capAtSignal))}
        {fact(t("Highest after"), s.outcome ? `${sol(s.outcome.peakCap)} · ${times(s.outcome.peakX)}` : "-")}
        {fact(t("Now"), s.capNow == null ? "-" : `${sol(s.capNow)} · ${times(s.xNow)}`)}
        {fact(t("Graduated"), s.outcome ? t(s.outcome.graduated ? "yes" : "no") : "-")}
      </div>
    </div>
  );
}

/** Until the release moment the page is a countdown; it opens by itself when the clock runs out. */
export default function Radar() {
  const [open, setOpen] = useState(radarOpen);
  return open ? <RadarLive /> : <RadarSoon onOpen={() => setOpen(true)} />;
}
