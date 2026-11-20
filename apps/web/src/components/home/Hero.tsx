import { type FormEvent, useEffect, useRef, useState } from "react";
import { navigate } from "../../router";
import { t } from "../../i18n";
import { shortOr } from "../../format";
import { compact, full, NORTH, picOf, SITE_WALLET, SITE_XRAY, ticker } from "./live";
import type { NetInfo } from "./particleScene";

export interface ChainNow {
  live: boolean;
  seen: { launches: number; trades?: number; launchlab?: number; dbc?: number };
  perMinute?: { launches: number; trades?: number };
}

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);

/** The card a node of the network opens: who it is and what the chain says they did. */
function NetCard({ info, onClose }: { info: NetInfo; onClose: () => void }) {
  const rows: Array<[string, string, boolean?]> = [];
  let title: string;
  let sub: string;
  let href: string;
  let cta: string;
  let pic: string | undefined;
  if (info.kind === "dev") {
    title = t("The dev");
    sub = shortOr(info.wallet);
    rows.push([t("Launches in 48 hours"), full(info.launches48h)], [t("Dumped"), full(info.dumped), true]);
    if (info.medianDumpMin != null) rows.push([t("Usually sells"), info.medianDumpMin < 1 ? t("in under a minute") : t("after {m} min", { m: info.medianDumpMin }), true]);
    rows.push([t("Graduated"), full(info.graduated)]);
    href = SITE_WALLET(info.wallet);
    cta = t("See the wallet");
  } else if (info.kind === "coin") {
    title = ticker(info.symbol, info.mint);
    sub = shortOr(info.mint);
    pic = picOf(info.mint, undefined, info.venue);
    if (info.buyers != null) rows.push([t("People bought it"), full(info.buyers)]);
    const sec = info.dumpedAfterSec ?? (info.dumpedAfterMin != null ? info.dumpedAfterMin * 60 : null);
    rows.push([t("Dev sold after"), sec == null ? t("has not sold") : sec < 120 ? `${sec}s` : sec < 7200 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)} h`, sec != null]);
    if (info.devTookSol != null && info.devTookSol > 0) rows.push([t("Dev took"), `+${info.devTookSol.toFixed(2)} SOL`, true]);
    if (info.leftHolding != null) rows.push([t("Left holding"), full(info.leftHolding)]);
    if (info.peakCapUsd) rows.push([t("Peak"), usd(info.peakCapUsd)]);
    if (info.alive != null) rows.push([t("Now"), info.alive ? t("still trading") : t("dead"), !info.alive]);
    href = SITE_XRAY(info.mint);
    cta = t("Open X-Ray");
  } else {
    title = t("A regular buyer");
    sub = shortOr(info.wallet);
    rows.push([t("Bought this dev's launches"), full(info.launches)]);
    if (info.snipes48h != null) rows.push([t("Sniped launches, 48h"), full(info.snipes48h), true]);
    href = SITE_WALLET(info.wallet);
    cta = t("See the wallet");
  }
  return (
    <div role="dialog" aria-label={title} className="w-[260px] rounded-[12px] border border-line-2 bg-night-surface p-4 shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
      <div className="flex items-start gap-3">
        {pic && <img src={pic} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-full bg-night-raised object-cover" onError={(e) => e.currentTarget.remove()} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-white">{title}</p>
          <p className="font-mono text-[12px] text-dim">{sub}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Close")} className="-mr-1 -mt-1 rounded-md px-1.5 text-[18px] leading-none text-dim hover:text-white">
          ×
        </button>
      </div>
      <div className="mt-3 border-t border-line">
        {rows.map(([k, v, red]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-[13px]">
            <span className="text-fg-3">{k}</span>
            <b className={`font-semibold tabular-nums ${red ? "text-danger" : "text-white"}`}>{v}</b>
          </div>
        ))}
      </div>
      <a href={href} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-moss hover:text-moss-hover">
        {cta} →
      </a>
    </div>
  );
}

/** The token box: a Solana address or link goes to the X-Ray. */
function Search() {
  const [mint, setMint] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const go = (e: FormEvent) => {
    e.preventDefault();
    const m = mint.trim();
    if (!m) return input.current?.focus();
    navigate(SITE_XRAY(encodeURIComponent(m)));
  };
  return (
    <form onSubmit={go} className="flex w-full flex-col gap-2 sm:flex-row" role="search">
      <label className="flex h-12 min-w-0 shrink-0 items-center sm:flex-1 gap-2.5 rounded-[9px] border border-line-2 bg-night-surface px-3.5 focus-within:border-[#3f5a48]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="shrink-0 text-faint">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={input}
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          placeholder={t("Paste a Solana token address")}
          aria-label={t("Token address")}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-[13.5px] tracking-[-0.01em] text-white placeholder:text-faint focus:outline-none"
        />
      </label>
      <button type="submit" className="btn-moss h-12 shrink-0 rounded-[9px] px-6 text-[14px] font-medium">
        {t("X-Ray it")}
      </button>
    </form>
  );
}

/**
 * The first screen: the headline on top, the particle scene in the middle (dust, then the eyes, then the real
 * network of a dev who is launching right now), the search and the live line under it. three.js loads after
 * the first paint, in its own chunk; without WebGL or a node the text stands alone.
 */
export default function Hero({ chain, sample }: { chain: ChainNow | null; sample?: { mint: string; symbol: string } }) {
  const root = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<NetInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [cap, setCap] = useState({ text: "", on: false });

  useEffect(() => {
    const el = host.current;
    const card = pop.current;
    if (!el || !card || !NORTH) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    let timer = 0;
    // after the first paint, and when the browser has a moment
    const idle = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 200));
    idle(
      () => {
        if (cancelled) return;
        import("./particleScene").then(({ startScene, webglOk }) => {
          if (cancelled || !webglOk()) return;
          stop = startScene(el, {
            north: NORTH,
            captions: [t("Every launch on Solana, read as it happens."), t("Then we keep watching the dev, coin after coin.")],
            netCaption: (dev, launches, dumped, regs, rank) =>
              t("Live now: {which} {dev}. {n} launches in 48 hours, {d} dumped. {r} wallets keep buying them. Click a dot.", {
                which: rank === 1 ? t("the busiest dev,") : t("the #{k} busiest dev,", { k: rank }),
                dev,
                n: full(launches),
                d: full(dumped),
                r: regs,
              }),
            onCaption: (text) => {
              setCap((c) => ({ ...c, on: false }));
              clearTimeout(timer);
              timer = window.setTimeout(() => setCap({ text, on: true }), 380);
            },
            onReady: () => setReady(true),
            devLabel: (w) => `${t("DEV")} ${w}`,
            exploreHint: t("Drag to move · pinch or ⌘ scroll to zoom · click a dot"),
            popover: card,
            onPick: setPicked,
            band: () => {
              const h = el.getBoundingClientRect();
              const a = top.current?.getBoundingClientRect();
              const b = bottom.current?.getBoundingClientRect();
              return { top: a ? a.bottom - h.top + 12 : 0, bottom: b ? b.top - h.top - 4 : h.height };
            },
          });
        });
      },
      { timeout: 1200 },
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, []);

  const perMin = chain?.perMinute?.launches;
  const launches = chain ? chain.seen.launches + (chain.seen.launchlab ?? 0) + (chain.seen.dbc ?? 0) : null;

  return (
    <section ref={root} className="relative h-[calc(100svh-60px)] max-h-[1000px] min-h-[640px] overflow-hidden border-b border-line bg-night">
      <div ref={host} aria-hidden className={`absolute inset-0 transition-opacity duration-[1600ms] [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full ${ready ? "opacity-100" : "opacity-0"}`} />
      <div ref={pop} data-no-art className={`absolute left-0 top-0 z-30 will-change-transform ${picked ? "" : "pointer-events-none invisible"}`}>
        {picked && <NetCard info={picked} onClose={() => setPicked(null)} />}
      </div>

      <div className="pointer-events-none relative z-10 mx-auto flex h-full max-w-[1440px] flex-col items-center px-4 text-center sm:px-5">
        <div ref={top} className="pt-8 sm:pt-12">
          <h1 className="text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-[56px]">{t("See who you're buying from.")}</h1>
          <p className="mx-auto mt-3 max-w-[62ch] text-[14.5px] leading-[1.5] text-fg-3 sm:text-[16px]">
            {t("We read the person behind a Solana token: the dev's past launches, who bought in the first seconds, who paid for them, and the odds it is still alive tomorrow.")}
          </p>
        </div>

        <div className="flex-1" />

        <div ref={bottom} className="w-full max-w-[640px] pb-6 sm:pb-9">
          <p aria-live="polite" className={`mx-auto mb-4 min-h-[40px] max-w-[60ch] text-[13px] leading-[1.5] text-fg-4 transition-all duration-300 ${cap.on ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}>
            {cap.text}
          </p>
          <div className="pointer-events-auto">
            <Search />
          </div>
          <div className="pointer-events-auto mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12.5px] text-dim">
            {chain && (
              <span>
                <span className={`mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle ${chain.live ? "live-dot bg-moss" : "bg-warn"}`} />
                {chain.live ? t("Reading Solana now") : t("Stream reconnecting")}
                {perMin != null && perMin > 0 && <span className="text-faint"> · {t("{n} launches a minute", { n: full(perMin) })}</span>}
                {launches != null && <span className="text-faint"> · {t("{n} launches read", { n: compact(launches) })}</span>}
              </span>
            )}
            {sample && (
              <span>
                {t("Try the newest:")}{" "}
                <a href={SITE_XRAY(sample.mint)} className="text-fg-3 underline decoration-line-2 underline-offset-4 hover:text-white">
                  {ticker(sample.symbol, sample.mint)}
                </a>
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
