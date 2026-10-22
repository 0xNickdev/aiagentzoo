import { AnimatePresence, motion } from "framer-motion";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section } from "./ui";
import { t, tChain } from "../i18n";
import XRayRadar, { KIND, kindOf, secs } from "./XRayRadar";
import WalletProfile, { WalletLink } from "./WalletProfile";
export { KIND, kindOf } from "./XRayRadar";

export type Verdict = "avoid" | "caution" | "pass" | "unknown";

export interface Early {
  wallet: string;
  bought: number;
  held: number;
  afterSec: number;
  exitSec: number | null;
  bundle: boolean;
  snipes48h: number;
  crew: boolean;
  ring: boolean;
  serial: boolean;
}

interface Check {
  verdict: Verdict;
  reasons: string[];
  notes: string[];
  facts: {
    ageMin: number;
    buyers: number;
    buys: number;
    sells: number;
    creatorSoldPct: number | null;
    creatorLaunches24h: number;
    creatorDumped48h: number | null;
    creatorMedianDumpMin: number | null;
    bundleWallets: number | null;
    bundleSharePct: number | null;
    bundlers?: number;
    bundlersHeldPct?: number | null;
    bundlersPeakPct?: number | null;
    bundledSol?: number | null;
    bundlesSince?: number | null;
    graduated: boolean;
    poolSol?: number | null;
    curveSol?: number | null;
    mayhem?: boolean;
    venue?: "pump.fun" | "launchlab" | "dbc";
    earlyWallets: number | null;
    earlyHeldPct: number | null;
    churnPct: number | null;
    bumps: number | null;
    creatorCrew: number | null;
    ringWallets: number | null;
    serialSnipers: number | null;
  } | null;
  holders?: { top10Pct: number; topWalletPct: number; creatorHoldsPct: number | null; programPct?: number } | null;
}

interface Funding {
  funder: string | null;
  funderIsHot: boolean;
  siblings: Array<{ wallet: string; launches48h: number; dumped: number }>;
  siblingLaunches48h: number;
  siblingDumped48h: number;
}

export interface XRayReport {
  mint: string;
  symbol: string;
  name: string;
  creator: string;
  createdAt: number;
  check: Check;
  early: Early[];
  creatorRecord: { launches48h: number; dumped: number; medianDumpMin: number | null; recent?: Array<{ mint: string; symbol: string; createdAt: number; dumpedAfterMin: number | null; graduated: boolean }> } | null;
  /** The X account, X community or Telegram group the token links to, and its other launches. */
  socials?: Array<{ social: { url: string; label: string }; launches: number; fastDumps: number }>;
  funding: Funding | null;
  bundle: { wallets: Array<{ wallet: string; share: number }>; funding: { groups: Array<{ funder: string; wallets: string[] }>; linked: number; checked: number } | null };
}

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
/** Where the token was launched, as people know the places. */
const VENUE: Record<string, string> = { "pump.fun": "pump.fun", launchlab: "Raydium LaunchLab", dbc: "Meteora" };
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");
const mintIn = (text: string) => text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;

export const TONE: Record<Verdict, { label: string; color: string }> = {
  avoid: { label: "AVOID", color: "#ff8a7e" },
  caution: { label: "CAUTION", color: "#f2d39b" },
  pass: { label: "NO RED FLAGS", color: "#9df3b0" },
  unknown: { label: "NOT ON THE STREAM", color: "#e9e4d8" },
};

function Stat({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-white/[0.06] py-2 first:border-t-0">
      <span className="text-[12.5px] font-light text-white/55">{t(k)}</span>
      <span className={`font-mono text-[13px] ${bad ? "text-[#ff8a7e]" : "text-white/85"}`}>{v}</span>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="liquid-glass rounded-3xl p-5 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl text-white/90">{t(title)}</h3>
        {note && <span className="font-mono text-[12px] text-white/60">{t(note)}</span>}
      </div>
      {children}
    </div>
  );
}

const BOT = "https://t.me/zooaiagency_bot";

/** The x-ray as a 1200x675 picture worth posting: verdict, the first reason, three numbers and the map of the first seconds. */
async function drawXRay(canvas: HTMLCanvasElement, r: XRayReport): Promise<void> {
  const W = 1200;
  const H = 675;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  await Promise.all([document.fonts.load('500 64px "Geist"'), document.fonts.load('300 24px "Geist"'), document.fonts.load('400 16px "Geist Mono"')]);
  ctx.fillStyle = "#030504";
  ctx.fillRect(0, 0, W, H);
  const c = r.check;
  const f = c.facts;
  const tone = TONE[c.verdict];
  const mono = (n: number) => `400 ${n}px "Geist Mono", ui-monospace, monospace`;
  const L = 72;

  // The first five seconds on the right: the dev in the middle, the early wallets around it.
  const cx = 930;
  const cy = 330;
  const early = r.early.slice(0, 14);
  early.forEach((e, i) => {
    const crew = e.crew;
    const ring = 120 + (i % 2) * 70 + (crew ? -60 : 0);
    const a = -Math.PI / 2 + (i / Math.max(1, early.length)) * Math.PI * 2;
    const x = cx + Math.cos(a) * ring * 1.15;
    const y = cy + Math.sin(a) * ring;
    const color = crew ? "#ff8a7e" : e.ring ? "#f2b56b" : e.serial ? "#c9b48a" : "#e9e4d8";
    if (crew) {
      ctx.strokeStyle = "rgba(255,138,126,0.45)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    const rad = 8 + Math.sqrt(Math.max(0, e.bought)) * 110;
    const held = e.bought > 0 ? e.held / e.bought : 0;
    ctx.globalAlpha = 0.1 + held * 0.5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = "#030504";
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = mono(14);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText("dev", cx, cy + 5);
  ctx.textAlign = "left";
  const shade = ctx.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, "rgba(3,5,4,0.98)");
  shade.addColorStop(0.55, "rgba(3,5,4,0.85)");
  shade.addColorStop(0.7, "rgba(3,5,4,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  ctx.font = mono(15);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillText(`ZOOAI AGENCY · X-RAY · ${VENUE[f?.venue ?? "pump.fun"]}`.toUpperCase(), L, 86);
  ctx.font = '500 64px "Geist", sans-serif';
  ctx.fillStyle = "#fff";
  ctx.fillText(`$${r.symbol}`.slice(0, 16), L - 3, 166);
  ctx.font = mono(14);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillText(`${r.mint.slice(0, 6)}…${r.mint.slice(-6)}`, L, 196);
  ctx.font = '500 84px "Geist", sans-serif';
  ctx.fillStyle = tone.color;
  ctx.fillText(t(tone.label), L - 4, 300);

  // The first reason, wrapped.
  ctx.font = '300 26px "Geist", sans-serif';
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  const reason = c.reasons[0] ? tChain(c.reasons[0]) : t("No red flags on chain so far. Not a call that it goes up.");
  const zh = /[\u4e00-\u9fff]/.test(reason);
  const words = zh ? Array.from(reason) : reason.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line}${zh ? "" : " "}${w}` : w;
    if (ctx.measureText(next).width > 600 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(i === 2 && lines.length > 3 ? `${l}…` : l, L, 356 + i * 36));

  const took = r.early.reduce((n, e) => n + e.bought, 0);
  const facts: Array<[string, string, boolean]> = [
    [t("wallets in the first 5 s"), String(r.early.length), r.early.length >= 5],
    [t("supply they took"), pct(took), took >= 0.25],
    f && (f.creatorCrew ?? 0) > 0 ? [t("the creator's own crew"), String(f.creatorCrew), true] : [t("serial snipers"), String(f?.serialSnipers ?? 0), (f?.serialSnipers ?? 0) >= 3],
  ];
  const top = 520;
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.beginPath();
  ctx.moveTo(L, top + 0.5);
  ctx.lineTo(L + 620, top + 0.5);
  ctx.stroke();
  facts.forEach(([k, v, bad], i) => {
    const x = L + i * 210;
    ctx.font = mono(26);
    ctx.fillStyle = bad ? "#ff8a7e" : "#fff";
    ctx.fillText(v, x, top + 50);
    ctx.font = mono(12);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(k.toUpperCase(), x, top + 76);
  });
  ctx.font = mono(14);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText(t("read straight from Solana · zooaiagency.com/xray"), L, H - 40);
}

/** Post it, keep watching it, or ask the beaver for its call. */
function ShareBar({ r }: { r: XRayReport }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [png, setPng] = useState<string | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    setPng(null);
    void drawXRay(canvas.current, r).then(() => setPng(canvas.current!.toDataURL("image/png")));
  }, [r]);
  const c = r.check;
  const label = TONE[c.verdict].label.toLowerCase();
  const tweet = encodeURIComponent(
    [`x-rayed $${r.symbol}: ${label}.`, c.reasons[0] ?? "", "", `see who you're buying from: zooaiagency.com/xray?mint=${r.mint}`].filter((x, i) => i !== 1 || x).join("\n"),
  );
  const btn = "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px]";
  return (
    <div className="liquid-glass grid gap-5 rounded-3xl p-5 sm:p-6 lg:grid-cols-[1fr_minmax(0,22rem)] lg:items-center">
      <div>
        <h3 className="font-display text-xl text-white/90">{t("Share it, or keep an eye on it")}</h3>
        <p className="mt-1.5 text-[13px] font-light leading-relaxed text-white/60">
          {t("Watch it in Telegram and the bot tells you the moment the dev sells, the pool is drained or it graduates.")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`${BOT}?start=w-${r.mint}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-white font-medium text-black hover:bg-white/90`}>
            {t("Watch it in Telegram")}
          </a>
          <a href={`https://x.com/intent/post?text=${tweet}`} target="_blank" rel="noopener noreferrer" className={`${btn} liquid-glass text-white/90 hover:text-white`}>
            {t("Post on X")}
          </a>
          <a
            href={png ?? undefined}
            download={`xray-${r.symbol}-${r.mint.slice(0, 6)}.png`}
            className={`${btn} liquid-glass text-white/90 hover:text-white ${png ? "" : "pointer-events-none opacity-50"}`}
          >
            {t("Download the card")}
          </a>
          <a href={`/ask?mint=${r.mint}`} className={`${btn} text-white/60 hover:text-white`}>
            {t("Ask the beaver for its call →")}
          </a>
        </div>
      </div>
      <canvas ref={canvas} className="hidden" />
      <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        {png ? <img src={png} alt={t("X-ray card")} className="h-full w-full" /> : <div className="h-full w-full animate-pulse bg-white/[0.03]" />}
      </div>
    </div>
  );
}

const solscan = (w: string) => `https://solscan.io/account/${w}`;

/** Opens a wallet's own page inside the X-Ray. */
const openWallet = (w: string) => window.dispatchEvent(new CustomEvent("zoo-wallet", { detail: w }));

/** A wallet: its page in the X-Ray, and a small link out to Solscan. A token address passes its own href. */
function Addr({ a, href, className = "" }: { a: string; href?: string; className?: string }) {
  if (href)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`font-mono underline decoration-white/15 underline-offset-4 hover:text-white hover:decoration-white/50 ${className}`}>
        {short(a)} ↗
      </a>
    );
  return <WalletLink a={a} onWallet={openWallet} className={className} />;
}

interface Sniper {
  wallet: string;
  snipes48h: number;
  soldOut: number;
  medianExitSec: number | null;
  topCreators: Array<{ creator: string; launches: number }>;
  recent: Array<{ mint: string; symbol: string; createdAt: number }>;
}

/** Who a first-second wallet is: what it did here, and what it does across every launch of the last two days. */
function Dossier({ e, creator, onPick, onClose }: { e: Early; creator: string; onPick: (mint: string) => void; onClose: () => void }) {
  const [s, setS] = useState<Sniper | null | undefined>(undefined);
  useEffect(() => {
    setS(undefined);
    let live = true;
    fetch(`${NORTH}/v1/chain/sniper/${e.wallet}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Sniper | null) => live && setS(b))
      .catch(() => live && setS(null));
    return () => {
      live = false;
    };
  }, [e.wallet]);
  const k = KIND[kindOf(e)];
  const sameDev = s?.topCreators.find((c) => c.creator === creator);
  return (
    <motion.div key={e.wallet} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.14em]" style={{ color: k.color }}>
            {t(k.label)}
          </p>
          <Addr a={e.wallet} className="mt-1 inline-block text-[15px] text-white/90" />
        </div>
        <button type="button" onClick={onClose} className="font-mono rounded-full px-2.5 py-1 text-[12.5px] text-white/65 ring-1 ring-white/10 hover:text-white">
          {t("close")}
        </button>
      </div>
      <p className="mt-2 text-[12.5px] font-light leading-snug text-white/55">{t(k.what)}</p>
      <button type="button" onClick={() => openWallet(e.wallet)} className="font-mono mt-3 self-start rounded-full px-3 py-1.5 text-[12.5px] text-[#f2d39b] ring-1 ring-[#f2d39b]/30 transition hover:bg-[#f2d39b]/10">
        {t("open this wallet's page →")}
      </button>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          ["in at", `${e.afterSec}s`, false],
          ["took", pct(e.bought), e.bought >= 0.05],
          ["holds now", pct(e.held), e.held >= 0.05],
          ["sold out", e.exitSec === null ? t("not yet") : secs(e.exitSec), false],
          ["snipes 48h", String(e.snipes48h), e.snipes48h >= 10],
          ["sold out of", s ? `${s.soldOut}` : "…", false],
        ].map(([kk, v, bad]) => (
          <div key={kk as string} className="rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/[0.06]">
            <p className="text-[12px] text-white/60">{t(kk as string)}</p>
            <p className={`font-mono mt-0.5 text-[14px] ${bad ? "text-[#ff8a7e]" : "text-white/90"}`}>{v}</p>
          </div>
        ))}
      </div>
      {s === undefined && <div className="mt-4 h-24 animate-pulse rounded-xl bg-white/[0.03]" />}
      {s === null && <p className="mt-4 text-[12.5px] font-light text-white/65">{t("No other launches from this wallet on the stream in the last two days.")}</p>}
      {s && (
        <>
          <p className="mt-4 text-[12.5px] font-light leading-snug text-white/70">
            {t("Last two days: bought {n} launches in their first seconds, sold out of {o}, usually {x} after buying.", { n: s.snipes48h, o: s.soldOut, x: secs(s.medianExitSec) })}
            {sameDev ? ` ${t("{n} of them were this creator's.", { n: sameDev.launches })}` : ""}
          </p>
          {s.topCreators.length > 0 && (
            <div className="mt-3">
              <p className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-white/55">{t("whose launches it buys")}</p>
              <div className="mt-1.5 divide-y divide-white/[0.05]">
                {s.topCreators.slice(0, 4).map((c) => (
                  <div key={c.creator} className="flex items-baseline justify-between gap-3 py-1.5 text-[12px]">
                    <Addr a={c.creator} className={c.creator === creator ? "text-[#ff8a7e]" : "text-white/70"} />
                    <span className="font-mono text-white/70">
                      {c.creator === creator ? `${t("this creator")} · ` : ""}
                      {c.launches === 1 ? t("1 launch") : t("{n} launches", { n: c.launches })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {s.recent.length > 0 && (
            <div className="mt-3">
              <p className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-white/55">{t("its latest snipes · tap to x-ray")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.recent.slice(0, 8).map((m) => (
                  <button key={m.mint} type="button" onClick={() => onPick(m.mint)} className="font-mono max-w-[9rem] truncate rounded-full px-2.5 py-1 text-[12.5px] text-white/70 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-white">
                    ${m.symbol.replace(/^\$/, "")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

/** The lines that decide it, in one row: who launched it, who got in first, who paid, who holds. Each opens its panel. */
function KeyFacts({ r, go }: { r: XRayReport; go: (id: string) => void }) {
  const c = r.check;
  const f = c.facts;
  const took = r.early.reduce((n, e) => n + e.bought, 0);
  const holds = r.early.reduce((n, e) => n + e.held, 0);
  const fund = r.funding;
  const rec = r.creatorRecord;
  const cells: Array<{ id: string; k: string; v: string; sub: string; bad: boolean }> = [
    {
      id: "xr-creator",
      k: "The creator",
      v: rec ? t("{d} of {n} dumped", { d: rec.dumped, n: rec.launches48h }) : t("first launch"),
      sub: f?.creatorSoldPct === null || f?.creatorSoldPct === undefined ? t("never bought their own") : t("sold {p}% of their bag", { p: f.creatorSoldPct }),
      bad: (rec?.dumped ?? 0) >= 2 || (f?.creatorSoldPct ?? 0) >= 50,
    },
    {
      id: "xr-five",
      k: "The first 5 seconds",
      v: r.early.length ? t("{n} wallets", { n: r.early.length }) : t("nobody"),
      sub: r.early.length ? t("took {a} · hold {b}", { a: pct(took), b: pct(holds) }) : t("no one bought before it was visible"),
      bad: took >= 0.25 || (f?.creatorCrew ?? 0) >= 2,
    },
    {
      id: "xr-funder",
      k: "Who paid for the creator",
      v: !fund ? t("tracing…") : !fund.funder ? t("no transfer found") : fund.funderIsHot ? t("an exchange") : fund.siblings.length ? t("{n} other creators", { n: fund.siblings.length }) : t("only this creator"),
      sub: fund?.funder && !fund.funderIsHot ? (fund.siblings.length ? t("{d} dumps in 48h", { d: fund.siblingDumped48h }) : t("funded {w}", { w: short(fund.funder) })) : fund?.funderIsHot ? t("funds everyone, ties no one") : "",
      bad: !!fund?.funder && !fund.funderIsHot && fund.siblingDumped48h >= 3,
    },
    {
      id: "xr-holders",
      k: "Holders now",
      v: !c.holders ? "-" : c.holders.top10Pct === 0 ? t("nobody holds it") : t("top 10 hold {p}%", { p: c.holders.top10Pct }),
      sub: !c.holders ? t("could not be read right now") : c.holders.top10Pct === 0 ? (c.holders.programPct ? t("{p}% sits in the curve or pool", { p: c.holders.programPct }) : t("everyone sold back to the curve")) : t("largest wallet {p}%", { p: c.holders.topWalletPct }),
      bad: (c.holders?.top10Pct ?? 0) >= 50,
    },
  ];
  return (
    <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06] lg:grid-cols-4">
      {cells.map((x) => (
        <button key={x.id} type="button" onClick={() => go(x.id)} className="group bg-[#070a09]/90 px-4 py-3.5 text-left transition hover:bg-[#0c100e]">
          <p className="text-[12.5px] text-white/65">{t(x.k)}</p>
          <p className={`font-mono mt-1 text-[16px] ${x.bad ? "text-[#ff8a7e]" : "text-white/90"}`}>{x.v}</p>
          <p className="mt-0.5 truncate text-[13px] font-light text-white/65 group-hover:text-white/65">{x.sub || " "}</p>
        </button>
      ))}
    </div>
  );
}

type Tab = "overview" | "dev" | "five" | "bundles" | "holders" | "wallets";

/** A report laid out like a terminal: the verdict and a menu of what decides it on the left, one section at a time on the right. */
function Report({ r, onPick }: { r: XRayReport; onPick: (mint: string) => void }) {
  const c = r.check;
  const f = c.facts;
  const tone = TONE[c.verdict];
  const early = r.early;
  const took = early.reduce((n, e) => n + e.bought, 0);
  const holds = early.reduce((n, e) => n + e.held, 0);
  const fund = r.funding;
  const rec = r.creatorRecord;
  const [tab, setTab] = useState<Tab>("overview");
  const [all, setAll] = useState(false);
  const [sel, setSelState] = useState<string | null>(null);
  // Where the wallet was picked: on the map its dossier opens beside the map, in the list it opens under its row.
  const [from, setFrom] = useState<"map" | "list">("map");
  useEffect(() => {
    setSelState(null);
    setTab("overview");
    setAll(false);
  }, [r.mint]);
  const selected = early.find((e) => e.wallet === sel) ?? null;
  const open = (x: Tab) => {
    setTab(x);
    if (window.innerWidth < 1024) document.getElementById("xr-main")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const go = (id: string) => open(({ "xr-creator": "dev", "xr-five": "five", "xr-funder": "dev", "xr-holders": "holders" } as Record<string, Tab>)[id] ?? "overview");
  const setSel = (w: string | null) => {
    setFrom("list");
    setSelState(w);
  };
  const choose = (w: string | null) => {
    setFrom("map");
    setSelState(w);
  };
  const pool = f?.graduated ? (f.poolSol !== undefined && f.poolSol !== null ? t("graduated · pool {s} SOL", { s: f.poolSol < 1 ? f.poolSol.toFixed(2) : Math.round(f.poolSol) }) : t("graduated")) : null;
  const devBad = (rec?.dumped ?? 0) >= 2 || (f?.creatorSoldPct ?? 0) >= 50 || (!!fund?.funder && !fund.funderIsHot && fund.siblingDumped48h >= 3);
  const fiveBad = took >= 0.25 || (f?.creatorCrew ?? 0) >= 2 || (f?.ringWallets ?? 0) >= 3 || (f?.bundleSharePct ?? 0) >= 15;
  const bundleBad = (((f?.bundlers ?? 0) >= 10 && (f?.bundlersPeakPct ?? 0) >= 30) || (f?.churnPct ?? 0) >= 30) && !f?.mayhem;
  const holdBad = (c.holders?.top10Pct ?? 0) >= 50 || (c.holders?.topWalletPct ?? 0) >= 20;
  const MENU: Array<{ id: Tab; k: string; sub: string; bad?: boolean }> = [
    { id: "overview", k: "Overview", sub: c.reasons.length ? t("{n} reasons", { n: c.reasons.length }) : t("no red flags") },
    { id: "dev", k: "The dev", sub: rec ? t("{d} of {n} dumped", { d: rec.dumped, n: rec.launches48h }) : t("first launch"), bad: devBad },
    { id: "five", k: "First 5 seconds", sub: early.length ? t("{n} wallets · took {p}", { n: early.length, p: pct(took) }) : t("nobody"), bad: fiveBad },
    { id: "bundles", k: "Bundles & volume", sub: f?.bundlers ? t("{n} bundle wallets", { n: f.bundlers }) : t("{n} buyers", { n: f?.buyers ?? 0 }), bad: bundleBad },
    { id: "holders", k: "Holders", sub: !c.holders ? "-" : c.holders.top10Pct === 0 ? t("nobody holds it") : t("top 10 hold {p}%", { p: c.holders.top10Pct }), bad: holdBad },
    ...(early.length ? [{ id: "wallets" as Tab, k: "All wallets", sub: t("{n} in the first 5 s", { n: early.length }) }] : []),
  ];
  const head = c.reasons[0] ? tChain(c.reasons[0]).replace(/^./, (x) => x.toUpperCase()) : t("No red flags on the chain so far.");
  const shown = all ? c.reasons : c.reasons.slice(0, 3);
  const Title = ({ k, note }: { k: string; note?: string }) => (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
      <h3 className="font-display text-2xl text-white/90">{t(k)}</h3>
      {note && <span className="font-mono text-[12px] text-white/60">{t(note)}</span>}
    </div>
  );
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-5 pb-10 sm:px-8">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="liquid-glass rounded-3xl p-5">
            <p className="font-mono text-[12.5px] text-white/65">
              ${r.symbol.replace(/^\$/, "")} · {t("{m} min old", { m: f?.ageMin ?? 0 })}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-white/60">{r.name}</p>
            <p className="font-display mt-3 text-4xl leading-none" style={{ color: tone.color }}>
              {t(tone.label)}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-1">
              {(["avoid", "caution", "pass"] as const).map((v) => (
                <span key={v} className="h-[3px] rounded-full" style={{ background: c.verdict === v ? tone.color : "rgba(255,255,255,.08)" }} />
              ))}
            </div>
            <p className="font-mono mt-2 text-[12px] leading-relaxed text-white/60">
              {VENUE[f?.venue ?? "pump.fun"]}
              {pool ? ` · ${pool}` : ""}
              {f?.mayhem ? ` · ${t("Mayhem Mode")}` : ""}
            </p>
            <nav className="-mx-5 mt-4 flex gap-1 overflow-x-auto border-t border-white/[0.07] px-5 pt-3 lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:px-0">
              {MENU.map((m) => (
                <button key={m.id} type="button" onClick={() => open(m.id)} className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition lg:w-full ${tab === m.id ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.bad ? "bg-[#ff8a7e] shadow-[0_0_8px_#ff8a7e]" : "bg-white/25"}`} />
                  <span className="min-w-0">
                    <span className={`block whitespace-nowrap text-[13px] ${tab === m.id ? "text-white" : "text-white/75"}`}>{t(m.k)}</span>
                    <span className={`font-mono hidden truncate text-[12px] lg:block ${m.bad ? "text-[#ff8a7e]/80" : "text-white/60"}`}>{m.sub}</span>
                  </span>
                </button>
              ))}
            </nav>
            <div className="mt-4 hidden space-y-1.5 border-t border-white/[0.07] pt-4 text-[12.5px] lg:block">
              <p className="font-mono flex justify-between text-white/65">
                {t("dev")} <Addr a={r.creator} />
              </p>
              <p className="font-mono flex justify-between text-white/65">
                {t("token")}
                <a href={!f?.venue || f.venue === "pump.fun" ? `https://pump.fun/coin/${r.mint}` : `https://dexscreener.com/solana/${r.mint}`} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                  {short(r.mint)} ↗
                </a>
              </p>
            </div>
          </div>
        </aside>

        <div id="xr-main" className="min-w-0 scroll-mt-24 space-y-4">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="space-y-4">
              {tab === "overview" && (
                <>
                  <div className="liquid-glass rounded-3xl p-6 sm:p-8">
                    <p className="font-display text-2xl leading-snug text-white/90 sm:text-[28px]">{head}</p>
                    {c.reasons.length > 1 && (
                      <ul className="mt-5 divide-y divide-white/[0.06] border-y border-white/[0.06]">
                        {shown.map((x, i) => (
                          <li key={x} className="flex gap-3 py-2.5 text-[14px] font-light leading-snug text-white/75">
                            <span className="font-mono w-6 shrink-0 text-[12.5px] leading-6" style={{ color: tone.color }}>
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            {tChain(x)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {c.reasons.length > 3 && (
                      <button type="button" onClick={() => setAll(!all)} className="font-mono mt-3 text-[13px] text-white/70 hover:text-white">
                        {all ? t("show fewer") : t("+ {n} more reasons", { n: c.reasons.length - 3 })}
                      </button>
                    )}
                    {c.notes.length > 0 && <p className="mt-4 text-[12px] font-light leading-relaxed text-white/65">{c.notes.map(tChain).join(" · ")}</p>}
                    <KeyFacts r={r} go={go} />
                    <p className="font-mono mt-3 text-[12px] leading-relaxed text-white/55">{t("How we know: every pump.fun, LaunchLab and Meteora transaction read from Solana as it happens, kept for 48 hours. The dev's record and the first-seconds wallets come from that stream; who paid for the dev is traced from the dev wallet's own transfers.")}</p>
                  </div>
                  <ShareBar r={r} />
                </>
              )}

              {tab === "dev" && (
                <div className="grid gap-4 xl:grid-cols-2">
                  <div id="xr-creator">
                    <Panel title="The creator" note="last 48 hours">
              <Stat k="launches" v={String(r.creatorRecord?.launches48h ?? 1)} bad={(r.creatorRecord?.launches48h ?? 1) >= 3} />
              <Stat k="dumped" v={String(r.creatorRecord?.dumped ?? 0)} bad={(r.creatorRecord?.dumped ?? 0) >= 2} />
              <Stat k="sold of their own bag" v={f?.creatorSoldPct === null || f?.creatorSoldPct === undefined ? t("never bought") : `${f.creatorSoldPct}%`} bad={(f?.creatorSoldPct ?? 0) >= 50} />
              {!!f?.bundleWallets && <Stat k="launch block" v={t("{n} wallets · {p}%", { n: f.bundleWallets, p: f.bundleSharePct ?? 0 })} bad={(f.bundleSharePct ?? 0) >= 15} />}
              {r.socials?.map((s) => (
                <div key={s.social.url} className="flex items-baseline justify-between gap-3 border-t border-white/[0.06] py-2">
                  <a href={s.social.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[12.5px] font-light text-white/70 hover:text-white">
                    {s.social.label} ↗
                  </a>
                  <span className={`font-mono shrink-0 text-[12px] ${s.fastDumps >= 2 ? "text-[#ff8a7e]" : "text-white/60"}`}>{t("{n} other launches · {d} fast dumps", { n: s.launches, d: s.fastDumps })}</span>
                </div>
              ))}
              {(r.creatorRecord?.recent?.filter((x) => x.mint !== r.mint).length ?? 0) > 0 && (
                <div className="mt-3 border-t border-white/[0.06] pt-3">
                  <p className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-white/55">{t("their other launches · tap to x-ray")}</p>
                  <div className="mt-1.5">
                    {r.creatorRecord!.recent!.filter((x) => x.mint !== r.mint).slice(0, 6).map((x) => (
                      <button key={x.mint} type="button" onClick={() => onPick(x.mint)} className="flex w-full items-baseline justify-between gap-3 rounded-lg px-1 py-1.5 text-left text-[12.5px] transition hover:bg-white/[0.04]">
                        <span className="truncate text-white/80">${x.symbol.replace(/^\$/, "")}</span>
                        <span className={`font-mono shrink-0 text-[12.5px] ${x.dumpedAfterMin !== null ? "text-[#ff8a7e]" : "text-white/70"}`}>
                          {x.dumpedAfterMin !== null ? t("dumped after {m} min", { m: x.dumpedAfterMin }) : x.graduated ? t("graduated") : t("dev holding")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
                  </div>
                  <div id="xr-funder">
                    <Panel title="Who paid for the creator" note="traced on Solana">
              {!fund && <p className="text-[13px] font-light text-white/70">{t("Not traced yet. It is queued: open this again in a minute.")}</p>}
              {fund && !fund.funder && <p className="text-[13px] font-light text-white/70">{t("No funding transfer in the creator's recent history.")}</p>}
              {fund?.funder && (
                <>
                  <div className="flex items-baseline justify-between gap-3 py-2">
                    <span className="text-[12.5px] font-light text-white/55">{t("funded by")}</span>
                    <Addr a={fund.funder} className="text-[13px] text-white/85" />
                  </div>
                  {fund.funderIsHot ? (
                    <p className="mt-1 text-[12.5px] font-light text-white/70">{t("An exchange or a router: it funds everyone, so it ties no one together.")}</p>
                  ) : (
                    <>
                      <Stat k="other creators it funded" v={String(fund.siblings.length)} bad={fund.siblings.length >= 2} />
                      <Stat k="their launches · dumps (48h)" v={`${fund.siblingLaunches48h} · ${fund.siblingDumped48h}`} bad={fund.siblingDumped48h >= 3} />
                      {fund.siblings.length > 0 && (
                        <div className="mt-2 border-t border-white/[0.06] pt-2">
                          {fund.siblings.slice(0, 6).map((s) => (
                            <div key={s.wallet} className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
                              <Addr a={s.wallet} className="text-white/70" />
                              <span className={`font-mono ${s.dumped >= 1 ? "text-[#ff8a7e]" : "text-white/70"}`}>{t("{l} launched · {d} dumped", { l: s.launches48h, d: s.dumped })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </Panel>
                  </div>
                </div>
              )}

              {tab === "five" && (
                early.length > 0 ? (
          <div id="xr-five" className="liquid-glass grid gap-6 rounded-3xl p-5 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="font-display text-xl text-white/90">{t("The first 5 seconds")}</h3>
                <span className="font-mono text-[12px] text-white/60">{t("before anyone could see it")}</span>
              </div>
              <XRayRadar early={early} selected={sel} onSelect={choose} />
            </div>
            <div className="border-white/[0.07] lg:border-l lg:pl-6">
              <AnimatePresence mode="wait">
                {selected && from === "map" ? (
                  <Dossier key={selected.wallet} e={selected} creator={r.creator} onPick={onPick} onClose={() => setSel(null)} />
                ) : (
                  <motion.div key="sum" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <h3 className="font-display text-xl text-white/90">{t("Insiders")}</h3>
                    <div className="mt-3">
                      <Stat k="wallets in the first 5 seconds" v={String(early.length)} />
                      <Stat k="supply they took" v={pct(took)} bad={took >= 0.25} />
                      <Stat k="supply they still hold" v={pct(holds)} bad={holds >= 0.25} />
                      <Stat k="the creator's own crew" v={String(f?.creatorCrew ?? 0)} bad={(f?.creatorCrew ?? 0) >= 2} />
                      <Stat k="in a sniper ring" v={String(f?.ringWallets ?? 0)} bad={(f?.ringWallets ?? 0) >= 3} />
                      <Stat k="serial snipers" v={String(f?.serialSnipers ?? 0)} />
                    </div>
                    <p className="font-mono mt-5 text-[12.5px] text-[#f2d39b]/75">{t("Tap any wallet on the map or in the list to see who it is.")}</p>
                                      </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          <div id="xr-five" className="liquid-glass flex flex-wrap items-center justify-between gap-4 rounded-3xl px-6 py-5">
            <div>
              <h3 className="font-display text-xl text-white/90">{t("The first 5 seconds")}</h3>
              <p className="mt-1 text-[13px] font-light text-white/55">{t("Nobody bought before the token was visible: no snipers, no crew in the first seconds.")}</p>
            </div>
            <p className="font-mono text-[12px] text-white/55">{t("{b} buyers · {x} buys · {y} sells", { b: f?.buyers ?? 0, x: f?.buys ?? 0, y: f?.sells ?? 0 })}</p>
            {!!f?.bundlers && (
              <p className={`font-mono w-full text-[12px] ${(f.bundlersPeakPct ?? 0) >= 30 && !f.mayhem ? "text-[#ff8a7e]" : "text-white/55"}`}>
                {t("later bought in bundles: {n} wallets, held up to {p}% together, {h}% now", { n: f.bundlers, p: f.bundlersPeakPct ?? 0, h: f.bundlersHeldPct ?? 0 })}
              </p>
            )}
          </div>
        )
              )}

              {tab === "bundles" && (
                <div className="liquid-glass rounded-3xl p-6 sm:p-8">
                  <Title k="Bundles & volume" note="4+ wallets buying in one block, any time" />
                  <div>
                      <Stat k="buyers" v={String(f?.buyers ?? 0)} />
                      <Stat k="buys · sells" v={`${f?.buys ?? 0} · ${f?.sells ?? 0}`} />
                      <Stat k="churned volume (at least)" v={f?.churnPct === null || f?.churnPct === undefined ? "-" : `${f.churnPct}%`} bad={(f?.churnPct ?? 0) >= 30 && !f?.mayhem} />
                      <Stat k="bump bot trades" v={String(f?.bumps ?? 0)} bad={(f?.bumps ?? 0) >= 3 && !f?.mayhem} />
                      <Stat k="bought in bundles (4+ wallets in one block)" v={`${f?.bundlers ? t("{n} wallets", { n: f.bundlers }) : "0"}${f?.bundlesSince ? ` · ${t("counted since {d}", { d: new Date(f.bundlesSince).toISOString().slice(5, 16).replace("T", " ") + " UTC" })}` : ""}`} bad={(f?.bundlers ?? 0) >= 10 && (f?.bundlersPeakPct ?? 0) >= 30 && !f?.mayhem} />
                      {!!f?.bundlers && <Stat k="bundlers hold now · at most" v={`${f.bundlersHeldPct ?? 0}% · ${f.bundlersPeakPct ?? 0}%`} bad={(f.bundlersPeakPct ?? 0) >= 30 && !f.mayhem} />}
                      {!!f?.bundledSol && <Stat k="SOL through bundles" v={f.bundledSol.toLocaleString("en-US", { maximumFractionDigits: 1 })} />}
                    </div>
                  {!!f?.bundleWallets && <Stat k="launch block" v={t("{n} wallets · {p}%", { n: f.bundleWallets, p: f.bundleSharePct ?? 0 })} bad={(f.bundleSharePct ?? 0) >= 15} />}
                  <p className="mt-4 text-[12.5px] font-light leading-relaxed text-white/65">{t("A crowd of buyers that is really a few hands buying in packs looks like demand and is not. Churn is wallets selling back what they just bought: volume, not holders.")}</p>
                </div>
              )}

              {tab === "holders" && (
                <div id="xr-holders">
                  <Panel title="Holders now" note="read from Solana">
              {!c.holders && <p className="text-[13px] font-light text-white/70">{t("Holders could not be read right now.")}</p>}
              {c.holders && c.holders.top10Pct === 0 && <p className="text-[13px] font-light text-white/70">{t("Nobody holds it outside the curve: everyone sold back.")}{c.holders.programPct ? ` ${t("{p}% sits in the curve or pool", { p: c.holders.programPct })}.` : ""}</p>}
              {c.holders && c.holders.top10Pct > 0 && !!c.holders.programPct && <Stat k="in the curve or pool" v={`${c.holders.programPct}%`} />}
              {c.holders && c.holders.top10Pct > 0 && (
                <>
                  <Stat k="largest wallet" v={`${c.holders.topWalletPct}%`} bad={c.holders.topWalletPct >= 20} />
                  <Stat k="10 largest wallets" v={`${c.holders.top10Pct}%`} bad={c.holders.top10Pct >= 50} />
                  <Stat k="the creator holds" v={c.holders.creatorHoldsPct === null ? "-" : `${c.holders.creatorHoldsPct}%`} />
                </>
              )}
            </Panel>
                </div>
              )}

              {tab === "wallets" && (
                
          <div className="liquid-glass overflow-hidden rounded-3xl">
            <div className="font-mono grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_5rem] gap-3 border-b border-white/[0.07] px-5 py-3 text-[12px] text-white/60 sm:grid-cols-[minmax(0,1fr)_9rem_5rem_5rem_5rem_6rem_6rem] sm:px-7">
              <span>{t("wallet")}</span>
              <span className="hidden sm:block">{t("who")}</span>
              <span className="text-right">{t("took")}</span>
              <span className="text-right">{t("holds")}</span>
              <span className="hidden text-right sm:block">{t("in at")}</span>
              <span className="text-right">{t("sold out")}</span>
              <span className="hidden text-right sm:block">{t("snipes 48h")}</span>
            </div>
            {early.map((e) => {
              const k = KIND[kindOf(e)];
              const on = sel === e.wallet;
              return (
                <div key={e.wallet}>
                <button
                  id={`xr-row-${e.wallet}`}
                  type="button"
                  onClick={() => setSel(on ? null : e.wallet)}
                  className={`font-mono grid w-full outline-none focus-visible:bg-white/[0.05] grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_5rem] items-center gap-3 border-t border-white/[0.05] px-5 py-2.5 text-left text-[12px] transition sm:grid-cols-[minmax(0,1fr)_9rem_5rem_5rem_5rem_6rem_6rem] sm:px-7 ${on ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}
                >
                  <span className="flex items-center gap-2 truncate text-white/80">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: k.color }} />
                    {short(e.wallet)}
                  </span>
                  <span className="hidden truncate sm:block" style={{ color: k.color }}>
                    {t(k.label)}
                  </span>
                  <span className="text-right text-white/70">{pct(e.bought)}</span>
                  <span className={`text-right ${e.held >= 0.05 ? "text-[#ff8a7e]" : "text-white/70"}`}>{pct(e.held)}</span>
                  <span className="hidden text-right text-white/55 sm:block">{e.afterSec}s</span>
                  <span className="text-right text-white/55">{secs(e.exitSec)}</span>
                  <span className={`hidden text-right sm:block ${e.snipes48h >= 10 ? "text-[#f2d39b]" : "text-white/55"}`}>{e.snipes48h}</span>
                </button>
                {on && from === "list" && (
                  <div className="border-t border-white/[0.05] bg-black/25 px-5 py-5 sm:px-7">
                    <Dossier e={e} creator={r.creator} onPick={onPick} onClose={() => setSel(null)} />
                  </div>
                )}
                </div>
              );
            })}
          </div>
        
              )}
            </motion.div>
          </AnimatePresence>
          <p className="font-mono text-center text-[12.5px] text-white/60">
            {t("raw:")} <a href={`${NORTH}/v1/xray/${r.mint}`} className="underline decoration-white/25 underline-offset-4 hover:text-white">/v1/xray/{short(r.mint)}</a> · {t("Not financial advice. Read from public chain data.")}
          </p>
        </div>
      </div>
    </motion.section>
  );
}

interface Moment {
  mint: string;
  symbol: string;
  kind: string;
  text: string;
  at: number;
}

const SHOWS = [
  { title: "The first 5 seconds", text: "Every wallet that bought before anyone could see the token: what it took, what it still holds, when it sold out." },
  { title: "Who those wallets are", text: "Across every launch of the last two days: the creator's own crew, sniper rings, serial snipers." },
  { title: "Who paid for the creator", text: "The wallet that funded the dev, and what else it funded. Exchanges are left out: they fund everyone." },
];

/** Before anything is pasted: tokens the chain is talking about right now, one tap from their x-ray, and what it shows. */
function Start({ onPick }: { onPick: (mint: string) => void }) {
  const [moments, setMoments] = useState<Moment[] | null>(null);
  // The check's own verdict on each, so a token that graduated is not mistaken for a good one.
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  useEffect(() => {
    for (const m of moments ?? []) {
      if (verdicts[m.mint]) continue;
      fetch(`${NORTH}/v1/check/${m.mint}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { verdict?: Verdict } | null) => b?.verdict && setVerdicts((v) => ({ ...v, [m.mint]: b.verdict! })))
        .catch(() => {});
    }
  }, [moments]);
  useEffect(() => {
    const load = () =>
      fetch(`${NORTH}/v1/chain/moments?limit=120`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { moments: Moment[] } | null) => {
          if (!b) return;
          const seen = new Set<string>();
          // Something worth looking at: a dev who just dumped, a serial launcher, a token that graduated.
          const pickd = b.moments.filter((m) => ["dump", "serial", "graduated"].includes(m.kind) && !seen.has(m.mint) && seen.add(m.mint)).slice(0, 8);
          setMoments(pickd);
        })
        .catch(() => setMoments([]));
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);
  const ago = (at: number) => {
    const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
    return m < 1 ? t("now") : t("{m} min ago", { m });
  };
  return (
    <Section className="!pt-2">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl">{t("Try one from the chain, right now")}</h2>
        <p className="font-mono text-[12.5px] text-white/65">{t("live from Solana · tap to x-ray")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!moments && Array.from({ length: 4 }, (_, i) => <div key={i} className="liquid-glass h-[84px] animate-pulse rounded-2xl opacity-60" />)}
        {moments?.map((m) => (
          <button
            key={m.mint}
            type="button"
            onClick={() => onPick(m.mint)}
            className="liquid-glass group rounded-2xl p-4 text-left transition hover:bg-white/[0.06]"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display truncate text-[17px]">${m.symbol.replace(/^\$/, "")}</span>
              <span className="font-mono shrink-0 text-[12px] text-white/60">{ago(m.at)}</span>
            </div>
            <p className="mt-1.5 truncate text-[12.5px] font-light text-white/60">{tChain(m.text)}</p>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              {verdicts[m.mint] ? (
                <span className="font-mono rounded-full px-2 py-0.5 text-[11.5px] tracking-[0.06em] ring-1" style={{ color: TONE[verdicts[m.mint]!].color, boxShadow: "none", borderColor: "transparent", background: "rgba(255,255,255,0.03)" }}>
                  {t(TONE[verdicts[m.mint]!].label)}
                </span>
              ) : (
                <span className="font-mono text-[11.5px] text-white/50">{t("checking…")}</span>
              )}
              <span className="font-mono text-[12px] text-white/60 group-hover:text-white/70">{t("x-ray it →")}</span>
            </div>
          </button>
        ))}
      </div>
      {moments && moments.length === 0 && <p className="text-[13px] font-light text-white/70">{t("Nothing loud on the chain this minute. Paste any token above.")}</p>}

      <div className="mt-10 grid gap-3 md:grid-cols-3">
        {SHOWS.map((x) => (
          <div key={x.title} className="liquid-glass rounded-3xl p-5 sm:p-6">
            <h3 className="font-display text-xl text-white/90">{t(x.title)}</h3>
            <p className="mt-2 text-[13.5px] font-light leading-relaxed text-white/65">{t(x.text)}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** One token, seen through: who got in first, who they are across launches, who paid for the creator, what is churn. */
export default function XRay() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<XRayReport | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);

  const showWallet = (w: string) => {
    setReport(null);
    setError(null);
    setInput(w);
    setWallet(w);
    history.pushState(null, "", `/xray?wallet=${w}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  useEffect(() => {
    const on = (e: Event) => showWallet((e as CustomEvent<string>).detail);
    window.addEventListener("zoo-wallet", on);
    return () => window.removeEventListener("zoo-wallet", on);
  }, []);

  const run = async (mint: string) => {
    setBusy(true);
    setError(null);
    setWallet(null);
    try {
      const r = await fetch(`${NORTH}/v1/xray/${mint}`);
      const body = (await r.json()) as XRayReport & { error?: string };
      if (r.status === 429) throw new Error(t("Ten x-rays a minute on the free tier. Try again in a minute."));
      // Not a token the stream saw: perhaps a wallet, a dev, a sniper or a funder.
      if (r.status === 404) {
        const w = await fetch(`${NORTH}/v1/wallet/${mint}`).then((x) => x.status).catch(() => 0);
        if (w === 200) {
          setReport(null);
          setWallet(mint);
          history.replaceState(null, "", `/xray?wallet=${mint}`);
          return;
        }
      }
      if (!r.ok) throw new Error(body.error ? t("Not a launch or a wallet the stream saw in the last two days (pump.fun, LaunchLab, Meteora).") : t("Something went wrong."));
      setReport(body);
      history.pushState(null, "", `/xray?mint=${mint}`);
    } catch (err) {
      setReport(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const read = () => {
      const q = new URLSearchParams(location.search);
      const mint = mintIn(q.get("mint") ?? "");
      const w = mintIn(q.get("wallet") ?? "");
      if (w) {
        setInput(w);
        setReport(null);
        setWallet(w);
      } else if (mint) {
        setInput(mint);
        void run(mint);
      }
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const mint = mintIn(input);
    if (!mint) return setError(t("Paste a token address or link."));
    void run(mint);
  };

  return (
    <>
      <Section className="!pb-10" backdrop={{ src: "/backdrops/cycle.webp", tint: "160,190,220", glowAt: "50% 35%", opacity: 0.3 }}>
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="font-mono text-[12px] text-white/70">{t("X-Ray · every pump.fun, LaunchLab and Meteora trade, read live from Solana")}</p>
          <h1 className="font-display mt-4 text-5xl leading-[1.02] sm:text-6xl md:text-7xl">
            {t("See who you are")}
            <br />
            <span className="accent">{t("buying from.")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[15px] font-light leading-relaxed text-white/60">
            {t("The wallets that got in during the first five seconds, and who they are across every launch of the last two days: the creator's own crew, sniper rings, serial snipers. Who paid for the creator. How much of the volume is churn.")}
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <form onSubmit={submit} className="liquid-glass mx-auto mt-10 flex max-w-2xl flex-col gap-2 rounded-3xl p-2 sm:flex-row sm:rounded-full">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("token address: pump.fun, LaunchLab, Meteora")}
              spellCheck={false}
              autoComplete="off"
              className="font-mono min-w-0 flex-1 bg-transparent px-5 py-3 text-[14px] text-white outline-none placeholder:text-white/35"
              aria-label={t("Token address")}
            />
            <button type="submit" disabled={busy} className="rounded-full bg-white px-7 py-3 text-[14px] font-medium text-black transition hover:bg-white/90 disabled:opacity-60">
              {busy ? t("Reading the chain…") : t("X-ray it")}
            </button>
          </form>
          {error && <p className="mt-4 text-center text-[13px] text-[#ff8a7e]">{error}</p>}
        </Reveal>
      </Section>
      <AnimatePresence mode="wait">{report && <Report key={report.mint} r={report} onPick={(m) => { setInput(m); window.scrollTo({ top: 0, behavior: "smooth" }); void run(m); }} />}
        {wallet && !report && <WalletProfile key={wallet} wallet={wallet} onWallet={showWallet} onToken={(m) => { setInput(m); window.scrollTo({ top: 0, behavior: "smooth" }); void run(m); }} />}</AnimatePresence>
      {!report && !wallet && !busy && <Start onPick={(m) => { setInput(m); void run(m); }} />}
    </>
  );
}
