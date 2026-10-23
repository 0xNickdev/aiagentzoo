import { AnimatePresence, motion } from "framer-motion";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Ask, ago, ask, type BoardRow, CANYON, type CleanLaunch, type CreatorRecord, type Evolution, get, type Moment, mintIn, NORTH, pct, usd, watch } from "./api";
import { haptic, inTelegram, openLink, share, tg } from "./tg";
import { lang, pick, setLang, t as tt, tChain } from "../i18n";
import { TONE as XTONE, type XRayReport } from "../components/XRay";
import XRayRadar, { secs } from "../components/XRayRadar";
import { useRadar, type Watched } from "../components/radarCore";
import { type LaunchOutcome, launchOutcome } from "../outcome";

type Tab = "xray" | "ask" | "rugs" | "radar";
/** A token handed to a tab from elsewhere: a deep link, or another tab's button. The nonce re-runs the same token. */
type Seed = { mint: string; n: number };

const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "xray", label: "X-Ray", icon: <IconXRay /> },
  { id: "ask", label: "Ask", icon: <IconAsk /> },
  { id: "rugs", label: "Rugs", icon: <IconRugs /> },
  { id: "radar", label: "Radar", icon: <IconClean /> },
];

const TONE = {
  suspicious: { label: "Suspicious", color: "#ff7a6e", glow: "255,110,95" },
  watch: { label: "Watch", color: "#efe8da", glow: "239,232,218" },
  promising: { label: "Promising", color: "#8ff0a4", glow: "143,240,164" },
} as const;

const SITE = "https://zooaiagency.com";
/** Some launches put the dollar sign in the ticker itself. */
const sym = (s: string) => s.replace(/^\$+/, "");

/** The token the app was opened on: /app?mint=… from a link, or startapp=… from t.me/<bot>/app. */
function openedOn(): Seed | null {
  const mint = mintIn(new URLSearchParams(location.search).get("mint") ?? tg?.initDataUnsafe?.start_param ?? "");
  return mint ? { mint, n: 0 } : null;
}

export default function MiniApp() {
  const [tab, setTab] = useState<Tab>("xray");
  const [seeds, setSeeds] = useState<Partial<Record<Tab, Seed>>>(() => {
    const s = openedOn();
    return s ? { xray: s } : {};
  });
  const [pulse, setPulse] = useState<{ launches: number; trades: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      const p = await get<{ perMinute: { launches: number; trades: number } }>(`${NORTH}/v1/chain/pulse?after=999999999`);
      if (p) setPulse(p.perMinute);
    };
    void load();
    const t = window.setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const go = (t: Tab) => {
    if (t === tab) return;
    haptic.select();
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  const send = (t: Tab, mint: string) => {
    setSeeds((s) => ({ ...s, [t]: { mint, n: (s[t]?.n ?? 0) + 1 } }));
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="zapp">
      <Backdrop hero={tab === "xray" || tab === "ask"} />
      <header className="zapp-top">
        <div className="flex items-center gap-2">
          <img src="/logo-wordmark.png" alt="ZOOAI" className="h-[22px] w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]" />
          <button type="button" onClick={() => setLang(lang() === "zh" ? "en" : "zh")} className="glass-pill font-mono shrink-0 whitespace-nowrap px-2.5 py-1 text-[10.5px] text-white/75" aria-label="Language">
            {lang() === "zh" ? "EN" : "中文"}
          </button>
        </div>
        <div className="glass-pill font-mono flex min-w-0 items-center gap-2 whitespace-nowrap px-3 py-1.5 text-[10.5px] text-white/70">
          <i className="zapp-dot shrink-0" />
          {pulse ? (
            <span className="truncate">
              <b className="font-medium text-white">{pulse.launches}</b> {tt("launches")} · <b className="font-medium text-white">{pulse.trades.toLocaleString("en-US")}</b> {tt("trades / min")}
            </span>
          ) : (
            <span>{tt("reading solana…")}</span>
          )}
        </div>
      </header>
      <Ticker />

      <main className="zapp-main">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
            {tab === "xray" && <XRayTab seed={seeds.xray ?? null} onAsk={(m) => send("ask", m)} />}
            {tab === "ask" && <AskTab seed={seeds.ask ?? null} />}
            {tab === "rugs" && <RugsTab />}
            {tab === "radar" && <RadarTab onXRay={(m) => send("xray", m)} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="zapp-tabs glass-bar">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => go(t.id)} className={`zapp-tab ${tab === t.id ? "is-on" : ""}`} aria-current={tab === t.id}>
            {tab === t.id && <motion.span layoutId="tab-glow" className="zapp-tab-glow" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative">{t.icon}</span>
            <span className="relative mt-0.5 text-[10px]">{tt(t.label)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ---------- ask ---------- */

function AskTab({ seed }: { seed: Seed | null }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Ask | null>(null);
  const [dev, setDev] = useState<CreatorRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Ask[]>([]);
  const field = useRef<HTMLInputElement>(null);

  const run = useCallback(async (raw: string) => {
    const mint = mintIn(raw);
    if (!mint) {
      setError(tt("Paste a token address, a dev wallet, or a pump.fun link."));
      haptic.verdict("watch");
      return;
    }
    field.current?.blur();
    haptic.tap();
    setBusy(true);
    setError(null);
    setAnswer(null);
    setDev(null);
    const r = await ask(mint);
    setBusy(false);
    if (r.ask) {
      setAnswer(r.ask);
      haptic.verdict(r.ask.verdict);
    } else if (r.dev) {
      setDev(r.dev);
      haptic.verdict(r.dev.dumped >= Math.ceil(r.dev.launches48h / 2) && r.dev.launches48h >= 3 ? "suspicious" : "watch");
    } else setError(r.error ?? tt("Something went wrong."));
  }, []);

  useEffect(() => {
    void get<{ asks: Ask[] }>(`${CANYON}/v1/asks?limit=8`).then((b) => b && setRecent(b.asks));
  }, []);
  useEffect(() => {
    if (!seed) return;
    setInput(seed.mint);
    void run(seed.mint);
  }, [seed, run]);

  const paste = async () => {
    haptic.tap();
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInput(text);
        void run(text);
      }
    } catch {
      field.current?.focus();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(input);
  };

  return (
    <section>
      {!answer && !dev && !busy && (
        <div className="zapp-intro px-1 pb-5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-amber-100/70">{tt("ask the beaver")}</p>
          <h1 className="font-display mt-2 text-[34px] leading-[1.02] tracking-tight">
            {tt("Is it a rug?")}
            <br />
            <span className="text-white/50">{tt("Know before you ape.")}</span>
          </h1>
          <p className="mt-3 text-[13.5px] font-light leading-relaxed text-white/60">
            {tt("Read straight from Solana: did the dev sell, how many tokens this wallet launched, who did the buying. Graded by reality tomorrow.")}
          </p>
        </div>
      )}

      <form onSubmit={submit} className="glass-card flex items-center gap-2 rounded-[22px] p-1.5">
        <input
          ref={field}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={tt("token, dev wallet or pump.fun link")}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
          className="font-mono min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[13.5px] text-white outline-none placeholder:text-white/35"
        />
        {input ? (
          <button type="submit" disabled={busy} className="zapp-cta">
            {busy ? <Spinner /> : tt("Ask")}
          </button>
        ) : (
          <button type="button" onClick={() => void paste()} className="zapp-cta">
            {tt("Paste")}
          </button>
        )}
      </form>
      {error && <p className="mt-3 px-1 text-[12.5px] text-[#ff9a8f]">{error}</p>}

      {busy && <Thinking />}
      <AnimatePresence>
        {(answer || dev) && (
          <Sheet
            key={answer?.id ?? dev?.wallet}
            onClose={() => {
              setAnswer(null);
              setDev(null);
            }}
          >
            {answer ? <Verdict a={answer} /> : <DevCard r={dev!} />}
          </Sheet>
        )}
      </AnimatePresence>

      {!busy && !answer && !dev && recent.length > 0 && (
        <div className="mt-7">
          <SectionTitle>{tt("Others asked")}</SectionTitle>
          <div className="glass-card divide-y divide-white/[0.06] rounded-[22px]">
            {recent.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  haptic.tap();
                  setAnswer(a);
                  setDev(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-white/[0.04]"
              >
                <span className="min-w-0">
                  <span className="font-display block truncate text-[15px]">${sym(a.symbol)}</span>
                  <span className="font-mono block text-[10px] text-white/40">
                    {a.graded ? tt(a.graded.hit === null ? "graded · not scored" : a.graded.hit ? "graded · beaver was right" : "graded · beaver was wrong") : tt("{t} ago · grading in 24h", { t: ago(a.at) })}
                  </span>
                </span>
                <VerdictChip v={a.verdict} />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Verdict({ a }: { a: Ask }) {
  const tone = TONE[a.verdict];
  const [watching, setWatching] = useState<string | null>(null);
  const c = a.facts.chain;
  const m = a.facts.market;
  const r = a.facts.creator;
  const facts: Array<[string, string, boolean]> = [];
  if (c?.creatorSold !== null && c?.creatorSold !== undefined) facts.push(["Dev sold", pct(c.creatorSold), c.creatorSold >= 0.5]);
  if (r) facts.push(["Dev rugged (48h)", tt("{a} of {b}", { a: r.dumped, b: r.launches48h }), r.launches48h >= 3 && r.dumped >= Math.ceil(r.launches48h / 2)]);
  else if (c) facts.push(["Dev launches today", String(c.creatorLaunches24h), c.creatorLaunches24h >= 5]);
  const h = a.facts.holders;
  if (h) {
    facts.push(["Top 10 wallets", pct(h.top10Share), h.top10Share >= 0.5]);
    if (h.creatorShare !== null) facts.push(["Dev holds", pct(h.creatorShare), h.creatorShare >= 0.1]);
  }
  const b = a.facts.bundle;
  if (b) facts.push([b.linked >= 2 ? tt("Bundle · {n} same funder", { n: b.linked }) : "Bundle at launch", `${b.wallets} · ${pct(b.share)}`, b.wallets >= 3 || b.linked >= 2]);
  else if (c?.top5Share !== null && c?.top5Share !== undefined) facts.push(["Top 5 buyers", pct(c.top5Share), c.top5Share >= 0.6]);
  if (m) {
    facts.push(["Liquidity", usd(m.liquidityUsd), (m.liquidityUsd ?? 0) < 1000]);
    facts.push(["Buys · sells", `${m.buys24h} · ${m.sells24h}`, m.sells24h > m.buys24h * 3]);
    facts.push(["24h", m.priceChange24h === null ? "-" : `${m.priceChange24h > 0 ? "+" : ""}${Math.round(m.priceChange24h)}%`, (m.priceChange24h ?? 0) <= -80]);
  }
  facts.push(["Socials", a.facts.hasSocials === null ? "unknown" : a.facts.hasSocials ? "yes" : "none", a.facts.hasSocials === false]);

  const doWatch = async () => {
    haptic.tap();
    if (!inTelegram || !tg) {
      setWatching(tt("Open this inside the Telegram bot to get alerts."));
      return;
    }
    const res = await watch(tg.initData, a.mint);
    setWatching(tt(res.message));
    if (res.ok) haptic.verdict("promising");
  };

  return (
    <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
      <div className="glass-card relative overflow-hidden rounded-[26px] p-5">
        <div className="zapp-verdict-glow" style={{ background: `radial-gradient(60% 55% at 15% 20%, rgba(${tone.glow},0.28), transparent 70%)` }} />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono truncate text-[10px] text-white/40">{a.name || `${a.mint.slice(0, 6)}…${a.mint.slice(-6)}`}</p>
              <p className="font-display truncate text-[22px]">${sym(a.symbol)}</p>
            </div>
            <span className="font-mono shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] text-white/55">{Math.round(a.confidence * 100)}% sure</span>
          </div>

          <motion.p
            initial={{ opacity: 0, letterSpacing: "0.08em" }}
            animate={{ opacity: 1, letterSpacing: "-0.02em" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="font-display mt-4 text-[44px] leading-none"
            style={{ color: tone.color, textShadow: `0 0 40px rgba(${tone.glow},0.35)` }}
          >
            {tt(tone.label)}
          </motion.p>
          <p className="mt-3 text-[14.5px] font-light leading-relaxed text-white/85">{lang() === "zh" && a.whyZh ? a.whyZh : a.why}</p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {facts.slice(0, 6).map(([k, v, bad], i) => (
              <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }} className="rounded-2xl bg-black/30 px-3.5 py-2.5 ring-1 ring-white/[0.06]">
                <p className="text-[10.5px] text-white/45">{tt(k)}</p>
                <p className={`font-mono mt-0.5 text-[15px] ${bad ? "text-[#ff8f84]" : "text-white/90"}`}>{v}</p>
              </motion.div>
            ))}
          </div>

          <p className="font-mono mt-4 text-[10.5px] text-amber-100/70">
            {a.graded
              ? a.graded.hit === null
                ? tt("Graded · not scored")
                : tt(a.graded.hit ? "Graded · the beaver was right" : "Graded · the beaver was wrong")
              : a.already
                ? tt("Already dead when asked · not scored")
                : tt("Reality grades this answer in 24h")}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => void doWatch()} className="glass-btn">
              {tt("Follow it")}
            </button>
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                share(`${SITE}/ask#${a.id}`, pick(`the beaver on $${sym(a.symbol)}: ${tone.label.toLowerCase()}. ${a.why}`, `海狸对 $${sym(a.symbol)} 的判断：${tt(tone.label)}。${a.whyZh ?? a.why}`));
              }}
              className="glass-btn"
            >
              {tt("Share")}
            </button>
            <button type="button" onClick={() => openLink(a.facts.url ?? `https://dexscreener.com/solana/${a.mint}`)} className="glass-btn">
              {tt("Chart")}
            </button>
          </div>
          {watching && <p className="mt-3 text-center text-[12px] text-white/60">{watching}</p>}
        </div>
      </div>
    </motion.div>
  );
}

function DevCard({ r }: { r: CreatorRecord }) {
  const serial = r.launches48h >= 3 && r.dumped >= Math.ceil(r.launches48h / 2);
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div className="glass-card relative overflow-hidden rounded-[26px] p-5">
        <div className="zapp-verdict-glow" style={{ background: `radial-gradient(60% 55% at 15% 20%, rgba(${serial ? "255,110,95" : "239,232,218"},0.24), transparent 70%)` }} />
        <div className="relative">
          <p className="font-mono text-[10px] text-white/40">dev wallet · {r.wallet.slice(0, 6)}…{r.wallet.slice(-6)} · last 48h</p>
          <p className="font-display mt-3 text-[40px] leading-none" style={{ color: serial ? TONE.suspicious.color : "#fff" }}>
            {tt(serial ? "Serial rugger" : "No pattern yet")}
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              ["Launched", String(r.launches48h)],
              ["Rugged", String(r.dumped)],
              ["Median", r.medianDumpMin === null ? "-" : `${r.medianDumpMin} min`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-black/30 px-3 py-2.5 ring-1 ring-white/[0.06]">
                <p className="text-[10.5px] text-white/45">{tt(k)}</p>
                <p className="font-mono mt-0.5 text-[16px]">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 divide-y divide-white/[0.06]">
            {r.recent.slice(0, 8).map((t) => (
              <div key={t.mint} className="flex items-center justify-between py-2 text-[13px]">
                <span className="truncate">${sym(t.symbol)}</span>
                <span className={`font-mono text-[11px] ${t.dumpedAfterMin !== null ? "text-[#ff8f84]" : t.graduated ? "text-[#9df3b0]" : "text-white/45"}`}>
                  {[launchOutcome(t).head, launchOutcome(t).tail].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- x-ray ---------- */

const VENUE: Record<string, string> = { "pump.fun": "pump.fun", launchlab: "Raydium LaunchLab", dbc: "Meteora", stonk: "StonkFun" };
const BOT = "https://t.me/zooaiagency_bot";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const openWalletMini = (w: string) => window.dispatchEvent(new CustomEvent("zoo-wallet-mini", { detail: w }));
const share1 = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");

async function xray(mint: string): Promise<{ report?: XRayReport; error?: string }> {
  try {
    const r = await fetch(`${NORTH}/v1/xray/${mint}`);
    if (r.status === 429) return { error: tt("Ten x-rays a minute on the free tier. Try again in a minute.") };
    const body = (await r.json()) as XRayReport & { error?: string };
    if (r.ok) return { report: body };
    return { error: tt(body.error ? "Not a launch the stream saw in the last two days (pump.fun, LaunchLab, Meteora)." : "Something went wrong.") };
  } catch {
    return { error: tt("The chain reader is not reachable right now. Try again in a minute.") };
  }
}

/** Paste a token, see who you are buying from: the first five seconds, the creator's crew, who paid for the creator. */
function XRayTab({ seed, onAsk }: { seed: Seed | null; onAsk: (mint: string) => void }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<XRayReport | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: Event) => { haptic.tap(); setWallet((e as CustomEvent<string>).detail); };
    window.addEventListener("zoo-wallet-mini", on);
    return () => window.removeEventListener("zoo-wallet-mini", on);
  }, []);

  const run = useCallback(async (raw: string) => {
    const mint = mintIn(raw);
    if (!mint) {
      setError(tt("Paste a token address or link."));
      haptic.verdict("watch");
      return;
    }
    field.current?.blur();
    haptic.tap();
    setInput(mint);
    setBusy(true);
    setError(null);
    setReport(null);
    const r = await xray(mint);
    setBusy(false);
    if (r.report) {
      setReport(r.report);
      const v = r.report.check.verdict;
      haptic.verdict(v === "avoid" ? "suspicious" : v === "pass" ? "promising" : "watch");
    } else setError(r.error ?? tt("Something went wrong."));
  }, []);

  useEffect(() => {
    if (seed) void run(seed.mint);
  }, [seed, run]);

  const paste = async () => {
    haptic.tap();
    try {
      const text = await navigator.clipboard.readText();
      if (text) void run(text);
      else field.current?.focus();
    } catch {
      field.current?.focus();
    }
  };

  return (
    <section>
      {!report && !busy && (
        <div className="zapp-intro px-1 pb-5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-amber-100/70">x-ray</p>
          <h1 className="font-display mt-2 text-[34px] leading-[1.02] tracking-tight">
            {tt("See who you are")}
            <br />
            <span className="text-white/50">{tt("buying from.")}</span>
          </h1>
          <p className="mt-3 text-[13.5px] font-light leading-relaxed text-white/60">
            {tt("The wallets that bought in the first five seconds, the creator's own crew, who paid for the creator. Read straight from Solana.")}
          </p>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(input);
        }}
        className="glass-card flex items-center gap-2 rounded-[22px] p-1.5"
      >
        <input
          ref={field}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={tt("token address or link")}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
          className="font-mono min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[13.5px] text-white outline-none placeholder:text-white/35"
        />
        {input ? (
          <button type="submit" disabled={busy} className="zapp-cta">
            {busy ? <Spinner /> : tt("X-ray it")}
          </button>
        ) : (
          <button type="button" onClick={() => void paste()} className="zapp-cta">
            {tt("Paste")}
          </button>
        )}
      </form>
      {error && <p className="mt-3 px-1 text-[12.5px] text-[#ff9a8f]">{error}</p>}

      {busy && <Thinking lines={["Reading the chain…", "Finding the first five seconds…", "Checking who those wallets are…", "Tracing who paid for the creator…"]} image="/agents/owl.webp" />}
      <AnimatePresence>
        {report && (
          <Sheet key={report.mint} onClose={() => setReport(null)}>
            <XRayCard r={report} onAsk={onAsk} onPick={(m) => void run(m)} />
          </Sheet>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {wallet && (
          <Sheet key={wallet} onClose={() => setWallet(null)}>
            <WalletSheet wallet={wallet} onToken={(m) => { setWallet(null); void run(m); }} onWallet={(w) => setWallet(w)} />
          </Sheet>
        )}
      </AnimatePresence>

      {!busy && !report && <XRayStart onPick={(m) => void run(m)} />}
    </section>
  );
}

/** Tokens the chain is talking about this minute, one tap from their x-ray. */
function XRayStart({ onPick }: { onPick: (mint: string) => void }) {
  const [list, setList] = useState<Moment[] | null>(null);
  useEffect(() => {
    const load = async () => {
      const b = await get<{ moments: Moment[] }>(`${NORTH}/v1/chain/moments?limit=120`);
      if (!b) return setList((l) => l ?? []);
      const seen = new Set<string>();
      setList(b.moments.filter((m) => ["dump", "serial", "graduated"].includes(m.kind) && !seen.has(m.mint) && seen.add(m.mint)).slice(0, 6));
    };
    void load();
    const t = window.setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mt-7">
      <SectionTitle>{tt("Try one from the chain, right now")}</SectionTitle>
      {!list ? (
        <Skeleton rows={4} />
      ) : list.length === 0 ? (
        <Empty>{tt("Nothing loud on the chain this minute. Paste any token above.")}</Empty>
      ) : (
        <div className="glass-card divide-y divide-white/[0.06] rounded-[22px]">
          {list.map((m) => (
            <button key={m.mint} type="button" onClick={() => onPick(m.mint)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-white/[0.04]">
              <span className="min-w-0">
                <span className="font-display block truncate text-[15px]">${sym(m.symbol)}</span>
                <span className={`block truncate text-[12px] font-light ${m.kind === "graduated" ? "text-white/55" : "text-[#ffb3ab]"}`}>{tChain(m.text)}</span>
              </span>
              <span className="font-mono shrink-0 text-[10.5px] text-white/40">{tt("x-ray it →")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function XStat({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="rounded-2xl bg-black/30 px-3.5 py-2.5 ring-1 ring-white/[0.06]">
      <p className="text-[10.5px] leading-tight text-white/45">{tt(k)}</p>
      <p className={`font-mono mt-1 text-[15px] ${bad ? "text-[#ff8f84]" : "text-white/90"}`}>{v}</p>
    </div>
  );
}

function XRayCard({ r, onAsk, onPick }: { r: XRayReport; onAsk: (mint: string) => void; onPick: (mint: string) => void }) {
  const c = r.check;
  const f = c.facts;
  const tone = XTONE[c.verdict];
  const glow = c.verdict === "avoid" ? "255,110,95" : c.verdict === "caution" ? "242,211,155" : c.verdict === "pass" ? "143,240,164" : "239,232,218";
  const took = r.early.reduce((n, e) => n + e.bought, 0);
  const holds = r.early.reduce((n, e) => n + e.held, 0);
  const fund = r.funding;
  const [watching, setWatching] = useState<string | null>(null);

  const follow = async () => {
    haptic.tap();
    if (!inTelegram || !tg) return openLink(`${BOT}?start=w-${r.mint}`);
    const res = await watch(tg.initData, r.mint);
    setWatching(tt(res.message));
    if (res.ok) haptic.verdict("promising");
  };

  return (
    <div className="glass-card relative overflow-hidden rounded-[26px] p-5">
      <div className="zapp-verdict-glow" style={{ background: `radial-gradient(60% 45% at 15% 12%, rgba(${glow},0.24), transparent 70%)` }} />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono truncate text-[10px] text-white/40">
              {r.name || short(r.mint)} · {tt("{m} min old", { m: f?.ageMin ?? 0 })} · {VENUE[f?.platform ?? f?.venue ?? "pump.fun"]}
            </p>
            <p className="font-display truncate text-[22px]">${sym(r.symbol)}</p>
          </div>
          <button type="button" onClick={() => openWalletMini(r.creator)} className="font-mono shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] text-white/55">
            {tt("dev")} {short(r.creator)} →
          </button>
        </div>

        <p className="font-display mt-4 text-[38px] leading-none tracking-tight" style={{ color: tone.color, textShadow: `0 0 40px rgba(${glow},0.3)` }}>
          {tt(tone.label)}
        </p>
        {c.reasons.length > 0 && (
          <ul className="mt-4 space-y-2">
            {c.reasons.map((x) => (
              <li key={x} className="flex gap-2.5 text-[14px] font-light leading-snug text-white/85">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.color }} />
                {tChain(x)}
              </li>
            ))}
          </ul>
        )}
        {c.notes.length > 0 && <p className="mt-3 text-[11.5px] font-light leading-relaxed text-white/45">{c.notes.map(tChain).join(" · ")}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void follow()} className="zapp-cta !min-w-0 !py-3">
            {tt("Follow it")}
          </button>
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              share(`${SITE}/xray?mint=${r.mint}`, pick(`x-rayed $${sym(r.symbol)}: ${tone.label.toLowerCase()}. ${c.reasons[0] ?? ""}`, `透视 $${sym(r.symbol)}：${tt(tone.label)}。${c.reasons[0] ? tChain(c.reasons[0]) : ""}`));
            }}
            className="glass-btn"
          >
            {tt("Share")}
          </button>
        </div>
        <p className="mt-2 text-center text-[11.5px] font-light text-white/50">{watching ?? tt("The bot tells you the moment the dev sells, the pool is drained or it graduates.")}</p>

        <p className="font-mono mb-2 mt-6 text-[10.5px] uppercase tracking-[0.16em] text-white/40">
          {tt("The first 5 seconds")}
        </p>
        {r.early.length > 0 ? (
          <div className="rounded-2xl bg-black/30 px-2 py-2 ring-1 ring-white/[0.06]">
            <XRayRadar early={r.early} onSelect={(w) => w && openWalletMini(w)} />
          </div>
        ) : (
          <p className="rounded-2xl bg-black/30 px-3.5 py-3 text-[12.5px] font-light text-white/60 ring-1 ring-white/[0.06]">{tt("Nobody bought before the token was visible: no snipers, no crew in the first seconds.")}</p>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <XStat k="wallets" v={String(r.early.length)} />
          <XStat k="took" v={share1(took)} bad={took >= 0.25} />
          <XStat k="still hold" v={share1(holds)} bad={holds >= 0.25} />
          <XStat k="creator's crew" v={String(f?.creatorCrew ?? 0)} bad={(f?.creatorCrew ?? 0) >= 2} />
          <XStat k="sniper ring" v={String(f?.ringWallets ?? 0)} bad={(f?.ringWallets ?? 0) >= 3} />
          <XStat k="serial snipers" v={String(f?.serialSnipers ?? 0)} />
        </div>

        <p className="font-mono mb-2 mt-6 text-[10.5px] uppercase tracking-[0.16em] text-white/40">{tt("The creator")} · <span className="normal-case tracking-normal">{tt("last 48 hours")}</span></p>
        <div className="grid grid-cols-3 gap-2">
          <XStat k="launches" v={String(r.creatorRecord?.launches48h ?? 1)} bad={(r.creatorRecord?.launches48h ?? 1) >= 3} />
          <XStat k="dumped" v={String(r.creatorRecord?.dumped ?? 0)} bad={(r.creatorRecord?.dumped ?? 0) >= 2} />
          <XStat k="dev sold" v={f?.creatorSoldPct === null || f?.creatorSoldPct === undefined ? "-" : `${f.creatorSoldPct}%`} bad={(f?.creatorSoldPct ?? 0) >= 50} />
        </div>
        {(r.creatorRecord?.recent?.filter((x) => x.mint !== r.mint).length ?? 0) > 0 && (
          <div className="mt-2 rounded-2xl bg-black/30 px-3.5 py-2.5 ring-1 ring-white/[0.06]">
            <p className="text-[10.5px] text-white/45">{tt("their other launches · tap to x-ray")}</p>
            {r.creatorRecord!.recent!.filter((x) => x.mint !== r.mint).slice(0, 5).map((x) => (
              <button key={x.mint} type="button" onClick={() => { haptic.tap(); onPick(x.mint); }} className="flex w-full items-baseline justify-between gap-3 py-1.5 text-left text-[13px] active:opacity-70">
                <span className="truncate text-white/85">${sym(x.symbol)}</span>
                <span className={`font-mono shrink-0 text-[11px] ${x.dumpedAfterMin !== null ? "text-[#ff8f84]" : "text-white/50"}`}>
                  {[launchOutcome(x).head, launchOutcome(x).tail].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 rounded-2xl bg-black/30 px-3.5 py-3 ring-1 ring-white/[0.06]">
          <p className="text-[10.5px] text-white/45">{tt("Who paid for the creator")}</p>
          {!fund && <p className="mt-1 text-[13px] font-light text-white/60">{tt("Not traced yet. It is queued: open this again in a minute.")}</p>}
          {fund && !fund.funder && <p className="mt-1 text-[13px] font-light text-white/60">{tt("No funding transfer in the creator's recent history.")}</p>}
          {fund?.funder && (
            <>
              <button type="button" onClick={() => openWalletMini(fund.funder!)} className="font-mono mt-1 text-[14px] text-white/90">
                {short(fund.funder)} →
              </button>
              <p className={`mt-1 text-[12.5px] font-light ${!fund.funderIsHot && fund.siblingDumped48h >= 3 ? "text-[#ff8f84]" : "text-white/60"}`}>
                {fund.funderIsHot
                  ? tt("An exchange or a router: it funds everyone, so it ties no one together.")
                  : fund.siblings.length
                    ? tt("funded {n} other creators · {l} launches, {d} dumps in 48h", { n: fund.siblings.length, l: fund.siblingLaunches48h, d: fund.siblingDumped48h })
                    : tt("only this creator")}
              </p>
            </>
          )}
        </div>
        {r.socials?.map((s) => (
          <button key={s.social.url} type="button" onClick={() => openLink(s.social.url)} className="mt-2 flex w-full items-baseline justify-between gap-3 rounded-2xl bg-black/30 px-3.5 py-2.5 text-left ring-1 ring-white/[0.06]">
            <span className="truncate text-[12.5px] font-light text-white/75">{s.social.label} ↗</span>
            <span className={`font-mono shrink-0 text-[11px] ${s.fastDumps >= 2 ? "text-[#ff8f84]" : "text-white/55"}`}>{tt("{n} other launches · {d} fast dumps", { n: s.launches, d: s.fastDumps })}</span>
          </button>
        ))}
        {c.holders && c.holders.top10Pct === 0 && <p className="mt-2 rounded-2xl bg-black/30 px-3.5 py-3 text-[12.5px] font-light text-white/60 ring-1 ring-white/[0.06]">{tt("Nobody holds it outside the curve: everyone sold back.")}</p>}
        {c.holders && c.holders.top10Pct > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <XStat k="largest wallet" v={`${c.holders.topWalletPct}%`} bad={c.holders.topWalletPct >= 20} />
            <XStat k="10 largest wallets" v={`${c.holders.top10Pct}%`} bad={c.holders.top10Pct >= 50} />
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              onAsk(r.mint);
            }}
            className="glass-btn"
          >
            {tt("Ask the beaver")}
          </button>
          <button type="button" onClick={() => openLink(`${SITE}/xray?mint=${r.mint}`)} className="glass-btn">
            {tt("Full map")}
          </button>
        </div>
        <p className="font-mono mt-4 text-center text-[10px] text-white/35">{tt("Not financial advice. Read from public chain data.")}</p>
      </div>
    </div>
  );
}

/* ---------- wallet page ---------- */

interface WalletView {
  wallet: string;
  dev: { launches24h: number; launches48h: number; dumped: number; medianDumpMin: number | null; graduated: number; builder: { launches: number; grew: number; isBuilder: boolean } | null; launches: Array<{ mint: string; symbol: string; venue: string; buyers: number; early: number } & LaunchOutcome>; regulars: Array<{ wallet: string; launches: number }> } | null;
  funding: { funder: string | null; funderIsHot: boolean; siblings: Array<unknown>; siblingDumped48h: number } | null;
  funded: { hot: boolean; creators: Array<{ wallet: string; launches48h: number; dumped: number }> };
  sniper: { snipes48h: number; soldOut: number; medianExitSec: number | null; topCreators: Array<{ creator: string; launches: number }>; recent: Array<{ mint: string; symbol: string }> } | null;
}

/** A wallet's page inside the mini app: what it did as a dev, a sniper and the one who pays for devs. */
function WalletSheet({ wallet, onToken, onWallet }: { wallet: string; onToken: (mint: string) => void; onWallet: (w: string) => void }) {
  const [p, setP] = useState<WalletView | null | undefined>(undefined);
  useEffect(() => {
    setP(undefined);
    void get<WalletView>(`${NORTH}/v1/wallet/${wallet}`).then((b) => setP(b ?? null));
  }, [wallet]);

  if (p === undefined) return <div className="glass-card h-56 animate-pulse rounded-[26px]" />;
  if (!p) return <div className="glass-card rounded-[26px] p-5 text-[13px] font-light text-white/60">{tt("This wallet did not launch, snipe or fund a launch the stream saw in the last two days.")}</div>;

  const d = p.dev;
  const serial = d && d.launches48h >= 3 && d.dumped >= Math.ceil(d.launches48h * 0.6);
  const lead = d?.builder?.isBuilder
    ? { text: tt("A track record: {g} of its {n} launches grew and still hold liquidity, and it has not dumped them.", { g: d.builder.grew, n: d.builder.launches }), cls: "text-[#9df3b0]" }
    : serial
      ? { text: tt("A serial dumper: launched {n} tokens in two days and dumped {d} of them, usually {m} min after launch.", { n: d!.launches48h, d: d!.dumped, m: d!.medianDumpMin ?? 0 }), cls: "text-[#ff8f84]" }
      : p.sniper && p.sniper.snipes48h >= 10
        ? { text: tt("A sniper: bought {n} launches in their first seconds in two days and sold out of {o}, usually {x} after buying.", { n: p.sniper.snipes48h, o: p.sniper.soldOut, x: secs(p.sniper.medianExitSec) }), cls: "text-[#ff8f84]" }
        : p.funded.creators.length >= 2 && !p.funded.hot
          ? { text: tt("Pays for other devs: funded {n} launch wallets the zoo traced, with {d} dumps between them in two days.", { n: p.funded.creators.length, d: p.funded.creators.reduce((n, c) => n + c.dumped, 0) }), cls: "text-white/90" }
          : d
            ? { text: tt("Launched {n} tokens in two days, dumped {d}.", { n: d.launches48h, d: d.dumped }), cls: d.dumped >= 2 ? "text-[#ff8f84]" : "text-white/90" }
            : { text: tt("Seen in the first seconds of {n} launches in two days.", { n: p.sniper?.snipes48h ?? 0 }), cls: "text-white/90" };

  return (
    <div className="glass-card relative overflow-hidden rounded-[26px] p-5">
      <p className="font-mono text-[10px] text-white/40">{tt("wallet")}</p>
      <button type="button" onClick={() => openLink(`https://solscan.io/account/${wallet}`)} className="font-mono mt-1 block break-all text-left text-[13px] text-white/80">
        {wallet} ↗
      </button>
      <p className={`font-display mt-3 text-[20px] leading-snug ${lead.cls}`}>{lead.text}</p>

      {d && (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <XStat k="launches" v={String(d.launches48h)} bad={d.launches48h >= 5} />
            <XStat k="dumped" v={String(d.dumped)} bad={d.dumped >= 2} />
            <XStat k="graduated" v={String(d.graduated)} />
            <XStat k="still alive" v={String(d.builder?.grew ?? 0)} />
          </div>
          <p className="font-mono mb-2 mt-5 text-[10.5px] uppercase tracking-[0.16em] text-white/40">{tt("Its launches")}</p>
          <div className="glass-card divide-y divide-white/[0.06] rounded-[18px]">
            {d.launches.slice(0, 8).map((x) => (
              <button key={x.mint} type="button" onClick={() => { haptic.tap(); onToken(x.mint); }} className="flex w-full items-baseline justify-between gap-3 px-3.5 py-2.5 text-left active:bg-white/[0.04]">
                <span className="truncate text-[13px] text-white/85">${sym(x.symbol)}</span>
                <span className={`font-mono shrink-0 text-[11px] ${x.dumpedAfterMin !== null ? "text-[#ff8f84]" : x.graduated ? "text-[#9df3b0]" : "text-white/45"}`}>
                  {[launchOutcome(x).head, launchOutcome(x).tail].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-3 rounded-2xl bg-black/30 px-3.5 py-3 ring-1 ring-white/[0.06]">
        <p className="text-[10.5px] text-white/45">{tt("Who paid for this dev")}</p>
        {!p.funding || !p.funding.funder ? (
          <p className="mt-1 text-[13px] font-light text-white/60">{tt("No funding transfer in the dev's recent history.")}</p>
        ) : (
          <>
            <button type="button" onClick={() => onWallet(p.funding!.funder!)} className="font-mono mt-1 text-[14px] text-white/90">{short(p.funding.funder)} →</button>
            <p className="mt-1 text-[12.5px] font-light text-white/60">
              {p.funding.funderIsHot ? tt("An exchange or a router: it funds everyone, so it ties no one together.") : p.funding.siblings.length ? tt("It paid for {n} other devs too, with {d} dumps between them in two days.", { n: p.funding.siblings.length, d: p.funding.siblingDumped48h }) : tt("It paid for no other dev the zoo traced.")}
            </p>
          </>
        )}
      </div>

      {p.sniper && (
        <>
          <p className="font-mono mb-2 mt-4 text-[10.5px] uppercase tracking-[0.16em] text-white/40">{tt("As a first-second buyer")}</p>
          <div className="grid grid-cols-3 gap-2">
            <XStat k="launches sniped" v={String(p.sniper.snipes48h)} bad={p.sniper.snipes48h >= 10} />
            <XStat k="sold out of" v={String(p.sniper.soldOut)} />
            <XStat k="usually out after" v={secs(p.sniper.medianExitSec)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.sniper.recent.slice(0, 6).map((m) => (
              <button key={m.mint} type="button" onClick={() => { haptic.tap(); onToken(m.mint); }} className="font-mono max-w-[9rem] truncate rounded-full px-2.5 py-1 text-[11px] text-white/70 ring-1 ring-white/10 active:bg-white/[0.06]">${sym(m.symbol)}</button>
            ))}
          </div>
        </>
      )}

      {(p.funded.creators.length > 0 || p.funded.hot) && (
        <>
          <p className="font-mono mb-2 mt-4 text-[10.5px] uppercase tracking-[0.16em] text-white/40">{tt("Devs it paid for")}</p>
          {p.funded.hot ? (
            <p className="text-[12.5px] font-light text-white/55">{tt("An exchange or a router: it funds everyone, so it ties no one together.")}</p>
          ) : (
            <div className="glass-card divide-y divide-white/[0.06] rounded-[18px]">
              {p.funded.creators.slice(0, 8).map((c) => (
                <button key={c.wallet} type="button" onClick={() => onWallet(c.wallet)} className="flex w-full items-baseline justify-between gap-3 px-3.5 py-2 text-left active:bg-white/[0.04]">
                  <span className="font-mono text-[12px] text-white/80">{short(c.wallet)} →</span>
                  <span className={`font-mono text-[11px] ${c.dumped >= 1 ? "text-[#ff8f84]" : "text-white/55"}`}>{tt("{l} launched · {d} dumped", { l: c.launches48h, d: c.dumped })}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- rugs ---------- */

function RugsTab() {
  const [list, setList] = useState<Moment[] | null>(null);
  useEffect(() => {
    const load = async () => {
      const b = await get<{ moments: Moment[] }>(`${NORTH}/v1/chain/moments?kind=dump&limit=30`);
      if (b) setList(b.moments);
    };
    void load();
    const t = window.setInterval(load, 8_000);
    return () => clearInterval(t);
  }, []);
  return (
    <section>
      <TabHead kicker={tt("live from the chain")} title={tt("Devs dumping, right now.")} text={tt("Every time a creator sells half or more of their own token. Tap one to see the transaction.")} />
      {!list ? (
        <Skeleton rows={6} />
      ) : (
        <div className="glass-card divide-y divide-white/[0.06] rounded-[22px]">
          <AnimatePresence initial={false}>
            {list.map((e) => (
              <motion.button
                key={e.seq}
                layout
                initial={{ opacity: 0, backgroundColor: "rgba(255,110,95,0.18)" }}
                animate={{ opacity: 1, backgroundColor: "rgba(255,110,95,0)" }}
                transition={{ duration: 1.2 }}
                type="button"
                onClick={() => e.tx && openLink(`https://solscan.io/tx/${e.tx}`)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="font-display block truncate text-[15px]">${sym(e.symbol)}</span>
                  <span className="block text-[12px] font-light text-[#ffb3ab]">{tChain(e.text)}</span>
                </span>
                <span className="font-mono shrink-0 text-[10.5px] text-white/40">{ago(e.at)}</span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

/* ---------- radar ---------- */

/**
 * The radar, as on the site: fresh coins with no red flags so far, each looked at again in turn, and the moment one
 * turns (the dev sells, the bundlers leave, the pool drains) it goes to the top in red. Never a list of coins to buy.
 */
function RadarTab({ onXRay }: { onXRay: (mint: string) => void }) {
  const { watched } = useRadar();
  const rank = (w: Watched) => (w.turnedAt ? 0 : w.verdict === "pass" ? 1 : 2);
  const list = Object.values(watched).sort((a, b) => rank(a) - rank(b) || (b.turnedAt ?? 0) - (a.turnedAt ?? 0) || b.firstSeen - a.firstSeen).slice(0, 30);
  const turned = list.filter((w) => w.turnedAt).length;
  return (
    <section>
      <TabHead
        kicker={tt("radar")}
        title={tt("No red flags. So far.")}
        text={tt("Fresh coins that pass our checks right now, each one looked at again every minute or two. When one turns, the dev sold or the bundlers left, it jumps to the top in red. Not a call: most of these still die.")}
      />
      {list.length === 0 ? (
        <Skeleton rows={5} />
      ) : (
        <>
          {turned > 0 && <p className="font-mono mb-2 text-[11px] text-[#ff8f84]">{tt("{n} turned while you watched", { n: turned })}</p>}
          <div className="grid gap-2">
            {list.map((w, i) => {
              const red = !!w.turnedAt;
              const color = red ? (w.verdict === "avoid" ? "#ff8f84" : "#f2d39b") : w.verdict === "pass" ? "#9df3b0" : "rgba(255,255,255,0.45)";
              const status = red ? (w.verdict === "avoid" ? tt("turned · avoid") : tt("turned · caution")) : w.verdict === "pass" ? tt("no red flags so far") : tt("checking");
              return (
                <motion.button
                  layout
                  key={w.mint}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.03 }}
                  onClick={() => {
                    haptic.tap();
                    onXRay(w.mint);
                  }}
                  className="glass-card rounded-[20px] p-4 text-left"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display truncate text-[17px]">${sym(w.symbol)}</span>
                    <span className="font-mono text-[10.5px] text-white/40">{w.graduated ? tt("graduated") : tt("{n} buyers", { n: w.buyers })}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[12px]" style={{ color }}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${w.verdict ? "" : "animate-pulse"}`} style={{ background: color }} />
                    {status}
                  </div>
                  {red && w.reason && <p className="mt-1 text-[12px] leading-snug" style={{ color }}>{tChain(w.reason)}</p>}
                </motion.button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- pieces ---------- */

function TabHead({ kicker, title, text }: { kicker: string; title: string; text: string }) {
  return (
    <div className="px-1 pb-4 pt-3">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-amber-100/70">{kicker}</p>
      <h2 className="font-display mt-2 text-[28px] leading-[1.05] tracking-tight">{title}</h2>
      <p className="mt-2 text-[13px] font-light leading-relaxed text-white/55">{text}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="font-mono mb-2 px-1 text-[10.5px] uppercase tracking-[0.16em] text-white/40">{children}</p>;
}

function Empty({ children, image }: { children: ReactNode; image?: string }) {
  return (
    <div className="glass-card overflow-hidden rounded-[22px]">
      {image && <img src={image} alt="" className="aspect-[16/10] w-full object-cover opacity-90" />}
      <p className="px-4 py-4 text-[13px] font-light leading-relaxed text-white/60">{children}</p>
    </div>
  );
}

/** The answer slides up from the bottom like a native sheet; Telegram's back button and a tap outside close it. */
function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const back = tg?.BackButton;
    back?.show();
    back?.onClick(onClose);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      back?.offClick(onClose);
      back?.hide();
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return createPortal(
    <motion.div className="zapp-sheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="zapp-sheet"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => info.offset.y > 120 && onClose()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="zapp-sheet-handle" />
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** The newest dev dump on the chain, rolling under the header. */
function Ticker() {
  const [e, setE] = useState<Moment | null>(null);
  useEffect(() => {
    const load = async () => {
      const b = await get<{ moments: Moment[] }>(`${NORTH}/v1/chain/moments?kind=dump&limit=1`);
      if (b?.moments[0]) setE(b.moments[0]);
    };
    void load();
    const t = window.setInterval(load, 6_000);
    return () => clearInterval(t);
  }, []);
  if (!e) return null;
  return (
    <div className="zapp-ticker">
      <AnimatePresence mode="wait">
        <motion.button
          key={e.seq}
          type="button"
          onClick={() => e.tx && openLink(`https://solscan.io/tx/${e.tx}`)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="glass-pill font-mono flex max-w-full items-center gap-2 px-3 py-1.5 text-[10.5px]"
        >
          <i className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff6e5f] shadow-[0_0_8px_rgba(255,110,95,0.9)]" />
          <span className="truncate text-white/80">
            <b className="font-medium text-white">${sym(e.symbol)}</b> · {tChain(e.text)}
          </span>
          <span className="shrink-0 text-white/40">{ago(e.at)}</span>
        </motion.button>
      </AnimatePresence>
    </div>
  );
}

function VerdictChip({ v }: { v: Ask["verdict"] }) {
  const t = TONE[v];
  return (
    <span className="font-mono shrink-0 rounded-full px-2.5 py-1 text-[10px]" style={{ color: t.color, background: `rgba(${t.glow},0.1)` }}>
      {tt(t.label)}
    </span>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="glass-card divide-y divide-white/[0.05] rounded-[22px]">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="px-4 py-3.5">
          <div className="zapp-shimmer h-3.5 w-24 rounded" />
          <div className="zapp-shimmer mt-2 h-2.5 w-40 rounded" />
        </div>
      ))}
    </div>
  );
}

function Thinking({ lines: raw = ["Reading the chain…", "Checking the dev's wallet…", "Counting who bought…", "The beaver is thinking…"], image = "/agents/beaver.webp" }: { lines?: string[]; image?: string }) {
  const lines = raw.map((l) => tt(l));
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((x) => (x + 1) % lines.length), 1100);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <div className="glass-card mt-4 flex items-center gap-4 rounded-[26px] p-5">
      <img src={image} alt="" className="zapp-breathe h-14 w-14 rounded-full" />
      <AnimatePresence mode="wait">
        <motion.p key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="text-[14px] font-light text-white/75">
          {lines[i]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function Spinner() {
  return <span className="zapp-spin inline-block h-4 w-4 rounded-full border-2 border-black/20 border-t-black" />;
}

/** The beaver's clearing behind everything: sharp on Ask, dimmed and blurred behind the other tabs. */
function Backdrop({ hero }: { hero: boolean }) {
  return (
    <div className={`zapp-bg ${hero ? "is-hero" : ""}`} aria-hidden>
      <div className={`zapp-hero ${hero ? "is-on" : ""}`}>
        <img src="/app/hero.jpg" alt="" />
        <div className="zapp-hero-fade" />
      </div>
      {Array.from({ length: 14 }, (_, i) => (
        <i key={i} className="zapp-firefly" style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 90}%`, animationDelay: `${(i * 0.7) % 6}s`, animationDuration: `${6 + (i % 5)}s` }} />
      ))}
    </div>
  );
}

/* ---------- icons: thin, drawn for the zoo ---------- */

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function IconXRay() {
  return (
    <Svg>
      <path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="8.5" cy="9" r="1" opacity="0.6" />
      <circle cx="15.5" cy="9.5" r="1.2" opacity="0.6" />
      <circle cx="9.5" cy="15.5" r="0.9" opacity="0.6" />
      <circle cx="15" cy="15" r="1" opacity="0.6" />
    </Svg>
  );
}
function IconAsk() {
  return (
    <Svg>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
      <path d="M8.5 11h5M11 8.5v5" opacity="0.5" />
    </Svg>
  );
}
function IconRugs() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5l-1.5 5 3 2.5-2 3.5 1 6" />
    </Svg>
  );
}
function IconClean() {
  return (
    <Svg>
      <path d="M12 3l7 3v5.5c0 4.3-3 7.7-7 9.5-4-1.8-7-5.2-7-9.5V6l7-3z" />
      <path d="M8.8 12.2l2.2 2.2 4.2-4.6" />
    </Svg>
  );
}
