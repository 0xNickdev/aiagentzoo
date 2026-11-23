import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../../router";
import { t } from "../../i18n";
import { short } from "../../format";
import { compact, full, NORTH, SITE_XRAY, ticker, ago } from "./live";
import { beats, CHAPTER_EDGES, CHAPTERS, dumpedCount, ease, oddsFrac, oddsPct, phase, pickLive, SNAPSHOT, type StoryData, type Verdict } from "./storyData";
import type { Scene, StoryText } from "./particleScene";

export interface ChainNow {
  live: boolean;
  seen: { launches: number; trades?: number; launchlab?: number; dbc?: number };
  perMinute?: { launches: number; trades?: number };
}

const NAV = 60;
const VERDICT: Record<Verdict, { word: string; color: string; text: string }> = {
  avoid: { word: "Avoid", color: "#ff5a4f", text: "text-danger" },
  caution: { word: "Caution", color: "#e8a23a", text: "text-warn" },
  pass: { word: "No red flags", color: "#f4f5f4", text: "text-lit" },
};
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const dateOf = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The token box: a Solana address or link goes to the X-Ray. */
function Search({ id }: { id?: string }) {
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
      <label className="flex h-12 min-w-0 shrink-0 items-center gap-2.5 rounded-[9px] border border-line-2 bg-night-surface px-3.5 focus-within:border-[#4a524e] sm:flex-1">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="shrink-0 text-faint">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={input}
          id={id}
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          placeholder={t("Paste a Solana token address")}
          aria-label={t("Token address")}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-[13.5px] tracking-[-0.01em] text-white placeholder:text-faint focus:outline-none"
        />
      </label>
      <button type="submit" className="btn-primary h-12 shrink-0 rounded-[9px] px-6 text-[14px] font-medium">
        {t("X-Ray it")}
      </button>
    </form>
  );
}

/* ---------- the copy, built from the coin's own numbers ---------- */

function copyOf(d: StoryData) {
  const tl = d.timeline;
  const m = d.medianDumpMin;
  const sold = d.last48h ? d.last48h.dumped : dumpedCount(tl);
  const when = m == null ? "." : m < 1 ? t(", usually within a minute.") : m === 1 ? t(", usually a minute after launch.") : t(", usually {m} minutes after launch.", { m });
  const dev = [
    d.last48h ? t("They launched {n} coins in two days.", { n: full(d.last48h.launches) }) : t("They launched {n} coins we have on record.", { n: full(d.onRecord) }),
    t("They sold {d} of them", { d: full(sold) }) + when,
  ];
  const E = d.early.length;
  const g = d.shared[0];
  const serial = d.early.filter((e) => e.serial).length >= Math.ceil(E * 0.67);
  const first = g
    ? [t("{n} wallets bought first.", { n: E }), g.wallets.length === E ? t("One wallet paid for all of them.") : t("One wallet paid for {k} of them.", { k: g.wallets.length })]
    : serial
      ? [t("They buy launches"), t("in the first seconds"), t("and sell to whoever"), t("comes next.")]
      : [t("{n} wallets bought in the first seconds.", { n: E })];
  const ins = d.early.map((e) => e.afterSec).filter((x): x is number => x != null);
  const outs = d.early.map((e) => e.exitSec);
  let firstSub = ins.length === E ? t("{n} wallets were in within {s}s of launch.", { n: E, s: Math.max(...ins) }) : "";
  if (firstSub && outs.every((x) => x != null)) firstSub += " " + t("All of them were out by {s}s.", { s: Math.max(...(outs as number[])) });
  return { dev, first, firstSub };
}

function textOf(d: StoryData): StoryText {
  return {
    dev: `${t("DEV")} ${short(d.dev)}`,
    coin: ticker(d.symbol, d.mint),
    buyers: d.early.map((e) => {
      const io = [e.afterSec != null && t("in {s}s", { s: e.afterSec }), e.exitSec != null && t("out {s}s", { s: e.exitSec })].filter(Boolean).join(", ");
      return e.label ? { name: e.label, sub: `${short(e.wallet)} · ${io}` } : { name: short(e.wallet), sub: io };
    }),
    funders: d.shared.map((g) => t("{w} paid for {n}", { w: short(g.funder), n: g.wallets.length })),
    odds: `${oddsPct(d.run)}%`,
    oddsSub: t("to pass 85 SOL"),
    ticks: ["0.01%", "0.1%", "1%", "10%", "100%"],
  };
}

/* ---------- pieces of the stage ---------- */

/** Headline lines rising out of their masks and inking from grey to white as `r` goes 0..1. */
export function Lines({ lines, r, className }: { lines: string[]; r: number; className: string }) {
  return (
    <h2 className={className}>
      {lines.map((l, i) => {
        const k = clamp(r * 1.5 - i * 0.22);
        const ink = clamp((r - 0.25 - i * 0.08) / 0.5);
        const g = Math.round(74 + (255 - 74) * ink);
        return (
          <span key={i} className="block overflow-hidden pb-[0.08em]">
            <span className="block will-change-transform" style={{ transform: `translateY(${((1 - ease(k)) * 108).toFixed(2)}%)`, color: `rgb(${g},${Math.round(82 + (255 - 82) * ink)},${Math.round(78 + (255 - 78) * ink)})` }}>
              {l}
            </span>
          </span>
        );
      })}
    </h2>
  );
}

function Corners({ o }: { o: number }) {
  const c = "pointer-events-none absolute h-3 w-3 border-[#3a4640]";
  return (
    <div aria-hidden style={{ opacity: o }}>
      <i className={`${c} left-4 top-4 border-l border-t`} />
      <i className={`${c} right-4 top-4 border-r border-t`} />
      <i className={`${c} bottom-4 left-4 border-b border-l`} />
      <i className={`${c} bottom-4 right-4 border-b border-r`} />
    </div>
  );
}

function Rail({ p, o }: { p: number; o: number }) {
  const a = CHAPTER_EDGES[0]!;
  const f = clamp((p - a) / (1 - a));
  return (
    <div aria-hidden className="pointer-events-none absolute bottom-7 left-5 right-5 h-[9px] sm:left-[86px] sm:right-[86px]" style={{ opacity: o }}>
      <div className="absolute inset-x-0 top-1 h-px bg-line-2" />
      <div className="absolute left-0 top-1 h-px bg-dim" style={{ width: `${f * 100}%` }} />
      {CHAPTER_EDGES.map((e) => (
        <i key={e} className="absolute top-0 h-[9px] w-px bg-[#3a4640]" style={{ left: `${((e - a) / (1 - a)) * 100}%` }} />
      ))}
      <i className="absolute right-0 top-0 h-[9px] w-px bg-[#3a4640]" />
    </div>
  );
}

/* ---------- reduced motion: four still frames ---------- */

function StillFrame({ n, children, title }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[12px] border border-line bg-night-surface p-5 sm:p-7 lg:col-span-12">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        <span className="text-white">0{n}</span> / 04 · {t(CHAPTERS[n - 1]!)}
      </p>
      <h2 className="mt-4 max-w-[32ch] text-[26px] font-semibold leading-[1.1] tracking-[-0.035em] text-white sm:text-[34px]">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function StillStory({ d }: { d: StoryData }) {
  const c = copyOf(d);
  const v = VERDICT[d.verdict];
  const cols = 40;
  const R = 120, cx = 150, cy = 140;
  const at = (f: number, r: number) => [cx + Math.cos(Math.PI * (1 - f)) * r, cy - Math.sin(Math.PI * (1 - f)) * r] as const;
  const f = oddsFrac(d.run);
  return (
    <>
      <StillFrame n={1} title={t("It starts with one address.")}>
        <p className="break-all font-mono text-[14px] text-white sm:text-[18px]">{d.mint}</p>
      </StillFrame>
      <StillFrame n={2} title={c.dev.join(" ")}>
        <p className="font-mono text-[13px] text-fg-3">
          <span className="text-danger">{full(dumpedCount(d.timeline))}</span> / {full(d.timeline.length)} {t("dumped")} · {t("DEV")} {short(d.dev)}
        </p>
        <svg className="mt-3 w-full max-w-[520px]" viewBox={`0 0 ${cols * 8} ${Math.ceil(d.timeline.length / cols) * 8}`} aria-hidden>
          {d.timeline.map((m, i) => (
            <circle key={i} cx={(i % cols) * 8 + 4} cy={Math.floor(i / cols) * 8 + 4} r={2.4} fill={m === "d" ? "#ff5a4f" : m === "u" ? "#2f3833" : "#f4f5f4"} />
          ))}
        </svg>
      </StillFrame>
      <StillFrame n={3} title={c.first.join(" ")}>
        {c.firstSub && <p className="text-[14px] text-fg-3">{c.firstSub}</p>}
        <ul className="mt-3 max-w-[520px] border-t border-line">
          {textOf(d).buyers.map((b, i) => (
            <li key={i} className="flex justify-between gap-3 border-b border-line py-2 text-[13px]">
              <span className="text-white">{b.name}</span>
              <span className="font-mono text-[12px] text-faint">{b.sub}</span>
            </li>
          ))}
        </ul>
      </StillFrame>
      <StillFrame n={4} title={t("The verdict.")}>
        <svg viewBox="0 0 300 160" className="w-[260px]" aria-hidden>
          <path d={`M${cx - R} ${cy} A${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke="#232c27" strokeWidth={3} />
          {f > 0.002 && <path d={`M${cx - R} ${cy} A${R} ${R} 0 0 1 ${at(f, R)[0]} ${at(f, R)[1]}`} fill="none" stroke={v.color} strokeWidth={3} />}
          <line x1={at(f, R - 14)[0]} y1={at(f, R - 14)[1]} x2={at(f, R + 12)[0]} y2={at(f, R + 12)[1]} stroke={v.color} strokeWidth={2} />
        </svg>
        <p className={`text-[28px] font-semibold tracking-[-0.03em] ${v.text}`}>{t(v.word)}</p>
        <p className="text-[15px] text-fg-3">
          {oddsPct(d.run)}% {t("to pass 85 SOL")}
        </p>
        <div className="mt-5 max-w-[640px]">
          <p className="mb-2 text-[15px] font-medium text-white">{t("Check yours.")}</p>
          <Search />
        </div>
      </StillFrame>
    </>
  );
}

/* ---------- the story ---------- */

/**
 * The first screen and the story under it, on one pinned stage: the headline, the eyes and the search; then, as the
 * page scrolls, one real token in four chapters told by the same particles. Without WebGL the text still reads.
 */
export default function Story({ chain, sample }: { chain: ChainNow | null; sample?: { mint: string; symbol: string } }) {
  const reduce = useMemo(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const small = useMemo(() => typeof matchMedia === "function" && matchMedia("(max-width: 900px)").matches, []);
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [sceneOn, setSceneOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [cap, setCap] = useState({ text: "", on: false });
  const [p, setP] = useState(0);
  const [data, setData] = useState<StoryData | null>(null);
  const locked = useRef(false);
  const lock = (d: StoryData) => {
    if (locked.current) return;
    locked.current = true;
    setData(d);
  };

  // the story coin: read live, or the saved example when the live read fails or comes too late
  useEffect(() => {
    if (!NORTH) return lock(SNAPSHOT);
    let live = true;
    pickLive(NORTH)
      .then((s) => live && lock(s ?? SNAPSHOT))
      .catch(() => live && lock(SNAPSHOT));
    return () => {
      live = false;
    };
  }, []);

  // the scene: after the first paint, when the browser has a moment
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let timer = 0;
    const idle = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 200));
    idle(
      () => {
        if (cancelled) return;
        import("./particleScene").then(({ startScene, webglOk }) => {
          if (cancelled || !webglOk()) return;
          scene.current = startScene(el, {
            captions: [t("Every launch on Solana, read as it happens."), t("Then we keep watching the dev, coin after coin.")],
            onCaption: (text) => {
              setCap((c) => ({ ...c, on: false }));
              clearTimeout(timer);
              timer = window.setTimeout(() => setCap({ text, on: true }), 380);
            },
            onReady: () => setReady(true),
            verdictColor: (v) => VERDICT[v].color,
            band: () => {
              const h = el.getBoundingClientRect();
              const a = top.current?.getBoundingClientRect();
              const b = bottom.current?.getBoundingClientRect();
              return { top: a ? a.bottom - h.top + 12 : 0, bottom: b ? b.top - h.top - 4 : h.height };
            },
          });
          setSceneOn(true);
        });
      },
      { timeout: 1200 },
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      scene.current?.stop();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneOn && data) scene.current?.setStory(data, textOf(data));
  }, [sceneOn, data]);

  // one progress value from the pinned track, eased a touch, for the scene and the text alike
  useEffect(() => {
    const tr = track.current;
    if (reduce || !tr) return;
    let cur = 0, target = 0, raf = 0;
    // while a search on the stage is being typed into, the story holds still: on phones the keyboard opens and the
    // browser scrolls the field into view, and that scroll must not carry the story on and take the field away
    let held = false, heldY = 0, release = 0;
    const typing = () => {
      const a = document.activeElement;
      return a instanceof HTMLInputElement && !!stage.current?.contains(a);
    };
    const onFocusIn = () => {
      if (!typing()) return;
      clearTimeout(release);
      if (!held) heldY = scrollY;
      held = true;
    };
    const onFocusOut = () => {
      clearTimeout(release);
      release = window.setTimeout(() => {
        if (typing()) return;
        held = false;
        // put the page back where it was before the keyboard moved it, so the story picks up where it was
        if (Math.abs(scrollY - heldY) > 2) scrollTo({ top: heldY, behavior: "instant" as ScrollBehavior });
        onScroll();
      }, 350);
    };
    const read = () => {
      if (held) return;
      const r = tr.getBoundingClientRect();
      const range = r.height - (stage.current?.offsetHeight ?? innerHeight);
      target = clamp((NAV - r.top) / Math.max(1, range));
    };
    const tick = () => {
      cur += (target - cur) * 0.22;
      if (Math.abs(target - cur) < 1e-4) cur = target;
      if (cur > 0.02 && !locked.current) lock(SNAPSHOT);
      setP(cur);
      scene.current?.setProgress(cur);
      raf = cur !== target ? requestAnimationFrame(tick) : 0;
    };
    const onScroll = () => {
      read();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    onScroll();
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      clearTimeout(release);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  const ph = phase(p);
  const bt = beats(ph);
  const v = ph.vis;
  const chrome = clamp(ph.s * 2);
  const c = data ? copyOf(data) : null;
  const vd = data ? VERDICT[data.verdict] : null;
  const perMin = chain?.perMinute?.launches;
  const launches = chain ? chain.seen.launches + (chain.seen.launchlab ?? 0) + (chain.seen.dbc ?? 0) : null;
  const T = data?.timeline.length ?? 0;
  const grown = Math.round(T * bt.grow);
  const fellTo = clamp(bt.fall - 0.03);
  const typed = data ? Math.round(data.mint.length * bt.type) : 0;
  const block = "absolute left-5 right-5 top-[58px] sm:left-[86px] sm:right-auto sm:top-[96px] sm:w-[min(35rem,38vw)]";
  const h2 = "text-[29px] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-[44px]";
  const showAt = (x: number) => ({ opacity: x, visibility: x > 0.002 ? ("visible" as const) : ("hidden" as const) });

  const hero = (
    <div className="pointer-events-none relative z-10 mx-auto flex h-full max-w-[1440px] flex-col items-center px-4 text-center sm:px-5" style={{ opacity: v[0], transform: `translateY(${(-(1 - v[0]) * 36).toFixed(1)}px)`, visibility: v[0] > 0.002 ? "visible" : "hidden" }}>
      <div ref={top} className="pt-8 sm:pt-12">
        <h1 className="text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-[56px]">{t("See who you're buying from.")}</h1>
        <p className="mx-auto mt-3 max-w-[62ch] text-[14.5px] leading-[1.5] text-fg-3 sm:text-[16px]">
          {t("We read the person behind a Solana token: the dev's past launches, who bought in the first seconds, who paid for them, and the odds it runs.")}
        </p>
      </div>
      <div className="flex-1" />
      <div ref={bottom} className="w-full max-w-[640px] pb-12 sm:pb-14">
        <p aria-live="polite" className={`mx-auto mb-4 min-h-[40px] max-w-[60ch] text-[13px] leading-[1.5] text-fg-4 transition-all duration-300 ${cap.on ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}>
          {cap.text}
        </p>
        <div className={v[0] > 0.5 ? "pointer-events-auto" : ""}>
          <Search />
        </div>
        <div className={`mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12.5px] text-dim ${v[0] > 0.5 ? "pointer-events-auto" : ""}`}>
          {chain && (
            <span>
              <span className={`mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle ${chain.live ? "live-dot bg-lit" : "bg-warn"}`} />
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
      {!reduce && (
        <div aria-hidden className="absolute inset-x-0 bottom-3 hidden flex-col items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-faint sm:bottom-4 sm:flex">
          {t("Scroll")}
          <span className="scroll-cue block h-4 w-px bg-[#3a4640]" />
        </div>
      )}
    </div>
  );

  if (reduce)
    return (
      <>
        <section className="relative h-[calc(100svh-60px)] max-h-[1000px] min-h-[640px] overflow-hidden border-b border-line bg-night">
          <div ref={host} aria-hidden className={`absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full ${ready ? "opacity-100" : "opacity-0"}`} />
          {hero}
        </section>
        {data && (
          <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 px-4 pt-4 sm:px-5 lg:grid-cols-12">
            <StillStory d={data} />
          </div>
        )}
      </>
    );

  return (
    <div ref={track} className="relative border-b border-line bg-night" style={{ height: `calc(100svh - ${NAV}px + ${small ? 350 : 480}svh)` }}>
      <div ref={stage} className="sticky top-[60px] h-[calc(100svh-60px)] min-h-[560px] overflow-hidden">
        <div ref={host} aria-hidden className={`absolute inset-0 transition-opacity duration-[1600ms] [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full ${ready ? "opacity-100" : "opacity-0"}`} />
        {hero}

        {/* the frame: crop marks, the chapter counter, the rail */}
        <Corners o={chrome} />
        <div aria-hidden className="pointer-events-none absolute left-8 right-8 top-[26px] flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint sm:left-[86px] sm:right-[86px] sm:top-[42px] sm:text-[11px]" style={{ opacity: chrome }}>
          <span className="hidden whitespace-nowrap sm:inline">
            {t("One token, read")}
            {data?.exampleAt && <span className="hidden sm:inline"> · {t("example from {d}", { d: dateOf(data.exampleAt) })}</span>}
          </span>
          <span className="ml-auto whitespace-nowrap">
            <span className="text-white">0{Math.max(1, ph.ch)}</span> / 04 · {t(CHAPTERS[Math.max(1, ph.ch) - 1]!)}
          </span>
        </div>
        <Rail p={p} o={chrome} />

        {data && c && vd && (
          <>
            {/* 01 the token */}
            <div className={block} style={showAt(v[1])}>
              <Lines lines={[t("It starts with"), t("one address.")]} r={v[1]} className={h2} />
              <div className="mt-6 sm:mt-9">
                <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{t("Token address")}</p>
                <div className="relative w-max max-w-full font-mono text-[11.5px] leading-[1.6] tracking-[0] text-white sm:text-[16px]">
                  <span className="block" style={{ clipPath: `inset(0 calc(${data.mint.length - typed} * 1ch) 0 0)` }}>
                    {data.mint}
                  </span>
                  <span className="absolute top-[0.25em] h-[1.1em] w-[2px] bg-lit" style={{ left: `${typed}ch`, opacity: bt.type < 1 || Math.floor(performance.now() / 500) % 2 ? 1 : 0 }} />
                </div>
                <p className="mt-3 text-[13px] text-dim sm:text-[14px]" style={{ opacity: clamp((bt.type - 0.85) / 0.15) }}>
                  {ticker(data.symbol, data.mint)}
                  {data.venue && ` · ${data.venue}`} · {data.exampleAt ? t("launched {d}", { d: dateOf(data.createdAt) }) : t("launched {t} ago", { t: ago(data.createdAt) })}
                </p>
              </div>
            </div>

            {/* 02 the dev */}
            <div className={block} style={showAt(v[2])}>
              <Lines lines={c.dev} r={v[2]} className={h2} />
              <div className="mt-6 sm:mt-9">
                <p className="font-mono text-[26px] font-medium leading-none tracking-[-0.02em] text-white tabular-nums sm:text-[40px]">
                  {bt.fall > 0 ? (
                    <>
                      <span className="text-danger">{full(dumpedCount(data.timeline, fellTo))}</span>
                      <span className="text-faint"> / {full(T)}</span>
                    </>
                  ) : (
                    full(grown)
                  )}
                </p>
                <p className="mt-2 text-[12.5px] text-dim sm:text-[13.5px]">
                  {bt.fall > 0 ? t("dumped") : t("launches")} · {T < data.onRecord ? t("their last {n} launches, oldest to newest", { n: full(T) }) : t("every launch we have on record, oldest to newest")}
                </p>
              </div>
            </div>

            {/* 03 the first seconds */}
            <div className={block} style={showAt(v[3])}>
              <Lines lines={c.first} r={v[3]} className={h2} />
              {c.firstSub && (
                <p className="mt-5 max-w-[34ch] text-[14px] leading-[1.5] text-fg-3 sm:mt-7 sm:text-[16px]" style={{ opacity: clamp(v[3] * 2 - 1) }}>
                  {c.firstSub}
                </p>
              )}
            </div>

            {/* 04 the verdict */}
            <div className={block} style={showAt(v[4])}>
              <Lines lines={[t("The verdict.")]} r={v[4]} className={h2} />
              <p className={`mt-4 text-[34px] font-semibold leading-none tracking-[-0.04em] sm:mt-6 sm:text-[56px] ${vd.text}`} style={{ opacity: bt.word, transform: `translateY(${((1 - bt.word) * 12).toFixed(1)}px)` }}>
                {t(vd.word)}
              </p>
              {data.reason && (
                <p className="mt-3 hidden max-w-[36ch] text-[15px] leading-[1.5] text-fg-3 sm:block" style={{ opacity: bt.word }}>
                  {data.reason.charAt(0).toUpperCase() + data.reason.slice(1)}.
                </p>
              )}
            </div>
            <div
              className={`absolute bottom-[58px] left-5 right-5 sm:bottom-[72px] sm:left-[86px] sm:right-auto sm:w-[min(35rem,38vw)] ${bt.search > 0.5 && v[4] > 0.5 ? "pointer-events-auto" : "pointer-events-none"}`}
              style={{ ...showAt(bt.search * v[4]), transform: `translateY(${((1 - bt.search) * 14).toFixed(1)}px)` }}
            >
              <p className="mb-2.5 text-[17px] font-medium tracking-[-0.02em] text-white sm:text-[20px]">{t("Check yours.")}</p>
              <Search id="story-search" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
