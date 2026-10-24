import { motion } from "framer-motion";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { navigate } from "../router";
import SiteNav from "./SiteNav";
import { pick, t } from "../i18n";
import { compact, full, NORTH, picOf, short, SITE_WALLET, SITE_XRAY, ticker, useNorth, useTicker } from "./home/live";
import type { NetInfo } from "./home/particleScene";
import { EXTENSION_URL } from "./HomeSections";

const mintIn = (text: string) => text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] as const },
});

interface Chain {
  live: boolean;
  tracked: number;
  seen: { launches: number; trades: number; launchlab?: number; dbc?: number };
  perMinute: { launches: number; trades: number };
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
    sub = short(info.wallet);
    rows.push([t("Launches in 48 hours"), full(info.launches48h)], [t("Dumped"), full(info.dumped), true]);
    if (info.medianDumpMin != null) rows.push([t("Usually sells"), info.medianDumpMin < 1 ? t("in under a minute") : t("after {m} min", { m: info.medianDumpMin }), true]);
    rows.push([t("Graduated"), full(info.graduated)]);
    href = SITE_WALLET(info.wallet);
    cta = t("See the wallet");
  } else if (info.kind === "coin") {
    title = ticker(info.symbol, info.mint);
    sub = short(info.mint);
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
    sub = short(info.wallet);
    rows.push([t("Bought this dev's launches"), full(info.launches)]);
    if (info.snipes48h != null) rows.push([t("Sniped launches, 48h"), full(info.snipes48h), true]);
    href = SITE_WALLET(info.wallet);
    cta = t("See the wallet");
  }
  return (
    <div role="dialog" aria-label={title} className="w-[260px] rounded-xl border border-white/[0.14] bg-[#0a0e0c]/95 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        {pic && <img src={pic} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-full bg-[#141a17] object-cover" onError={(e) => e.currentTarget.remove()} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-white">{title}</p>
          <p className="font-mono text-[12px] text-[#a3aaa6]">{sub}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Close")} className="-mr-1 -mt-1 rounded-md px-1.5 text-[18px] leading-none text-[#a3aaa6] hover:text-white">
          ×
        </button>
      </div>
      <div className="mt-3 border-t border-white/[0.07]">
        {rows.map(([k, v, red]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 border-b border-white/[0.07] py-2 text-[13px]">
            <span className="text-[#c9cecb]">{k}</span>
            <b className={`font-semibold tabular-nums ${red ? "text-[#ff8a7e]" : "text-white"}`}>{v}</b>
          </div>
        ))}
      </div>
      <a href={href} className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-white">
        {cta} <ArrowRight size={14} />
      </a>
    </div>
  );
}

/** The particle scene behind the headline: dust, the eyes, the real network. Loaded after first paint, WebGL only. */
function ParticleArt() {
  const host = useRef<HTMLDivElement>(null);
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
    import("./home/particleScene").then(({ startScene, webglOk }) => {
      if (cancelled || !webglOk()) return;
      stop = startScene(el, {
        north: NORTH,
        captions: [t("Every launch on Solana, read as it happens."), t("We keep watching the dev, coin after coin.")],
        netCaption: (dev, launches, dumped, regs) =>
          t("The loudest dev right now: {dev} · {n} launches in 48 hours, {d} dumped · {r} wallets that buy their launches", { dev, n: launches, d: dumped, r: regs }),
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
      });
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, []);
  return (
    <>
      <div ref={pop} data-no-art className={`absolute left-0 top-0 z-30 will-change-transform ${picked ? "" : "pointer-events-none invisible"}`}>
        {picked && <NetCard info={picked} onClose={() => setPicked(null)} />}
      </div>
      <div ref={host} aria-hidden className={`absolute inset-0 transition-opacity duration-[1600ms] [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full ${ready ? "opacity-50 lg:opacity-100" : "opacity-0"}`} />
      <p
        aria-live="polite"
        className={`absolute bottom-[132px] left-5 right-5 z-10 hidden text-[13.5px] sm:block leading-relaxed text-[#c9cecb] transition-all duration-300 sm:left-auto sm:right-8 sm:max-w-[420px] sm:text-right ${cap.on ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"}`}
      >
        {cap.text}
      </p>
    </>
  );
}

/** Four numbers straight from the node along the bottom of the hero; trades and launches tick in real time. */
function HeroStats({ chain }: { chain: Chain | null }) {
  const usage = useNorth<{ last7: { xrays: number; checks: number } }>("/v1/usage");
  const rec = useNorth<{ flaggedAvoid: { n: number } }>("/v1/check/record");
  const launches = chain ? chain.seen.launches + (chain.seen.launchlab ?? 0) + (chain.seen.dbc ?? 0) : null;
  const trades = useTicker(chain?.seen.trades ?? null, chain?.perMinute.trades ?? 0);
  const launched = useTicker(launches, chain?.perMinute.launches ?? 0);
  const avoid = useTicker(rec?.flaggedAvoid.n ?? null);
  const checks = useTicker(usage ? usage.last7.checks + usage.last7.xrays : null);
  const cells: Array<[string, string]> = [
    [trades != null ? full(trades) : "-", t("trades read from Solana")],
    [launched != null ? full(launched) : "-", t("launches watched")],
    [avoid != null ? compact(avoid) : "-", t("launches flagged avoid, last 24h")],
    [checks != null ? compact(checks) : "-", t("checks people ran this week")],
  ];
  return (
    <div className="relative z-10 border-t border-white/[0.12] bg-[#030504]/90 backdrop-blur-md">
      <div className="mx-auto grid max-w-7xl grid-cols-2 px-5 sm:px-8 lg:grid-cols-4">
        {cells.map(([v, k], i) => (
          <motion.div
            key={k}
            {...rise(1.1 + i * 0.1)}
            className={`py-5 sm:py-6 ${i % 2 ? "border-l border-white/[0.07] pl-5 sm:pl-7" : ""} ${i > 1 ? "border-t border-white/[0.07] lg:border-t-0" : ""} ${i === 2 ? "lg:border-l lg:pl-7" : ""}`}
          >
            <p className="font-display text-[24px] font-medium tabular-nums text-white sm:text-[28px]">{v}</p>
            <p className="mt-1.5 text-[14px] text-[#a3aaa6]">{k}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export default function Hero() {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const chain = useNorth<Chain>("/v1/chain", 20_000);
  // The x-ray is the front door: paste a token here, read it there.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const mint = mintIn(input);
    if (!mint) return setError(true);
    navigate(`/xray?mint=${mint}`);
  };

  return (
    <div className="relative flex min-h-[100svh] flex-col overflow-hidden bg-[radial-gradient(55vw_60vh_at_72%_42%,rgba(70,110,85,0.10),transparent_70%)] bg-[#030504]">
      <ParticleArt />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(3,5,4,0.85)_0%,rgba(3,5,4,0.55)_32%,transparent_55%)]" />

      <SiteNav overlay />

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 items-center px-5 pb-16 pt-8 sm:px-8">
        <div className="max-w-[640px]">
          <motion.div {...rise(0.1)} className="inline-flex items-center gap-2.5 rounded-md border border-white/[0.12] bg-[#0a0e0c]/90 px-3.5 py-2 text-[13px] text-[#eaeaea] backdrop-blur">
            <span className={`h-[7px] w-[7px] rounded-full ${chain?.live ? "animate-pulse bg-[#a6e3b4]" : "bg-[#ffc27a]"}`} />
            {chain ? (chain.live ? t("reading Solana now") : t("stream reconnecting")) : t("connecting")}
            <span className="h-3 w-px bg-white/25" />
            <span className="tabular-nums">{chain ? full(chain.perMinute.trades) : "-"}</span> {t("trades a minute")}
          </motion.div>

          <motion.h1 {...rise(0.2)} className="font-display mt-7 text-[46px] font-semibold leading-none tracking-[-0.045em] text-white sm:text-7xl lg:text-[92px]">
            {pick(
              <>
                Know the dev
                <br />
                before you ape.
              </>,
              <>
                买之前，
                <br />
                先看清开发者。
              </>,
            )}
          </motion.h1>
          <motion.p {...rise(0.35)} className="mt-6 max-w-xl text-[17px] leading-relaxed text-[#d9dddb] sm:text-lg">
            {t("Paste any Solana token. In a second you see the dev's other launches, who sniped the first seconds, who paid for them and when they sold. Free, read straight from the chain.")}
          </motion.p>

          <motion.form
            {...rise(0.5)}
            onSubmit={submit}
            className={`mt-8 flex w-full max-w-[620px] flex-col gap-2 rounded-xl border bg-[#030504]/70 p-1.5 backdrop-blur-xl transition-colors focus-within:border-white/50 sm:flex-row ${error ? "border-[#ff8a7e]" : "border-white/20"}`}
          >
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(false);
              }}
              placeholder={t("token address or pump.fun link")}
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent px-4 py-3 text-[15px] text-white outline-none placeholder:text-white/50"
              aria-label={t("Token address")}
            />
            <button
              type="submit"
              className="rounded-lg bg-white px-6 py-3 text-[15px] font-medium text-black transition hover:shadow-[0_0_24px_rgba(255,255,255,0.25)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {t("X-ray it")}
            </button>
          </motion.form>
          {error && <p className="mt-3 text-[14px] text-[#ff8a7e]">{t("Paste a token address or link.")}</p>}

          <motion.div {...rise(0.65)} className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-2 text-[15px]">
            <a href="#now" className="inline-flex items-center gap-1.5 text-[#d9dddb] hover:text-white">
              {t("What devs are doing right now")} <ArrowRight size={15} className="rotate-90" />
            </a>
            <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-[#d9dddb] hover:text-white">
              {t("X-Ray on X, in Chrome")}
            </a>
          </motion.div>
        </div>
      </main>

      <HeroStats chain={chain} />
    </div>
  );
}
