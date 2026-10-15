import { AnimatePresence, motion } from "framer-motion";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Ask, ago, ask, type BoardRow, CANYON, type CleanLaunch, type CreatorRecord, type Evolution, get, type Moment, mintIn, NORTH, pct, usd, watch } from "./api";
import { haptic, inTelegram, openLink, share, tg } from "./tg";
import { lang, pick, setLang, t as tt, tChain } from "../i18n";

type Tab = "ask" | "rugs" | "clean" | "nursery" | "ranks";

const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "ask", label: "Ask", icon: <IconAsk /> },
  { id: "rugs", label: "Rugs", icon: <IconRugs /> },
  { id: "clean", label: "Clean", icon: <IconClean /> },
  { id: "nursery", label: "Nursery", icon: <IconNursery /> },
  { id: "ranks", label: "Ranks", icon: <IconRanks /> },
];

const TONE = {
  suspicious: { label: "Suspicious", color: "#ff7a6e", glow: "255,110,95" },
  watch: { label: "Watch", color: "#efe8da", glow: "239,232,218" },
  promising: { label: "Promising", color: "#8ff0a4", glow: "143,240,164" },
} as const;

const SITE = "https://zooaiagency.com";

export default function MiniApp() {
  const [tab, setTab] = useState<Tab>("ask");
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

  return (
    <div className="zapp">
      <Backdrop hero={tab === "ask"} />
      <header className="zapp-top">
        <div className="flex items-center gap-2">
          <img src="/logo-wordmark.png" alt="ZOOAI" className="h-[22px] w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]" />
          <button type="button" onClick={() => setLang(lang() === "zh" ? "en" : "zh")} className="glass-pill font-mono px-2.5 py-1 text-[10.5px] text-white/75" aria-label="Language">
            {lang() === "zh" ? "EN" : "中文"}
          </button>
        </div>
        <div className="glass-pill font-mono flex items-center gap-2 px-3 py-1.5 text-[10.5px] text-white/70">
          <i className="zapp-dot" />
          {pulse ? (
            <span>
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
            {tab === "ask" && <AskTab />}
            {tab === "rugs" && <RugsTab />}
            {tab === "clean" && <CleanTab onAsk={(m) => { setTab("ask"); window.dispatchEvent(new CustomEvent("zoo-ask", { detail: m })); }} />}
            {tab === "nursery" && <NurseryTab />}
            {tab === "ranks" && <RanksTab />}
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

function AskTab() {
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
    const onAsk = (e: Event) => {
      const m = (e as CustomEvent<string>).detail;
      setInput(m);
      void run(m);
    };
    window.addEventListener("zoo-ask", onAsk);
    return () => window.removeEventListener("zoo-ask", onAsk);
  }, [run]);

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
            {busy ? <Spinner /> : "Ask"}
          </button>
        ) : (
          <button type="button" onClick={() => void paste()} className="zapp-cta">
            Paste
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
                  <span className="font-display block truncate text-[15px]">${a.symbol}</span>
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
    setWatching(res.message);
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
              <p className="font-display truncate text-[22px]">${a.symbol}</p>
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
              {tt("Watch")}
            </button>
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                share(`${SITE}/ask#${a.id}`, pick(`the beaver on $${a.symbol}: ${tone.label.toLowerCase()}. ${a.why}`, `海狸对 $${a.symbol} 的判断：${tt(tone.label)}。${a.whyZh ?? a.why}`));
              }}
              className="glass-btn"
            >
              {tt("Share")}
            </button>
            <button type="button" onClick={() => openLink(a.facts.url ?? `https://dexscreener.com/solana/${a.mint}`)} className="glass-btn">
              Chart
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
                <span className="truncate">${t.symbol}</span>
                <span className={`font-mono text-[11px] ${t.dumpedAfterMin !== null ? "text-[#ff8f84]" : t.graduated ? "text-[#9df3b0]" : "text-white/45"}`}>
                  {t.dumpedAfterMin !== null ? tt("rugged in {m} min", { m: t.dumpedAfterMin }) : tt(t.graduated ? "graduated" : "dev holding")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
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
                  <span className="font-display block truncate text-[15px]">${e.symbol}</span>
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

/* ---------- clean ---------- */

function CleanTab({ onAsk }: { onAsk: (mint: string) => void }) {
  const [list, setList] = useState<CleanLaunch[] | null>(null);
  useEffect(() => {
    const load = async () => {
      const b = await get<{ launches: CleanLaunch[] }>(`${NORTH}/v1/chain/clean?limit=20`);
      if (b) setList(b.launches);
    };
    void load();
    const t = window.setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <section>
      <TabHead
        kicker={tt("passed the basic checks")}
        title={tt("No rug signs. Yet.")}
        text={tt("10 to 180 minutes old. Dev has not sold, not a serial wallet, 25+ buyers, no five wallets holding most of it. Not a call: most of these still die.")}
      />
      {!list ? (
        <Skeleton rows={5} />
      ) : list.length === 0 ? (
        <Empty image="/app/empty-clean.jpg">{tt("Nothing passes right now. On pump.fun that is a normal hour.")}</Empty>
      ) : (
        <div className="grid gap-2">
          {list.map((c, i) => (
            <motion.div key={c.mint} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="glass-card rounded-[20px] p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display truncate text-[17px]">${c.symbol}</span>
                <span className="font-mono text-[10.5px] text-white/40">{c.ageMin} min old</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-white/55">
                  {tt("{b} buyers · {r} back · top 5 {p}", { b: c.buyers >= 100 ? "100+" : c.buyers, r: c.repeatBuyers, p: pct(c.top5Share) })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    haptic.tap();
                    onAsk(c.mint);
                  }}
                  className="glass-btn !px-3.5 !py-1.5 text-[12px]"
                >
                  Ask
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- nursery ---------- */

function NurseryTab() {
  const [evo, setEvo] = useState<Evolution | null>(null);
  useEffect(() => {
    void get<Evolution>(`${CANYON}/v1/evolution`).then(setEvo);
  }, []);
  const alive = (evo?.creatures ?? []).filter((c) => !c.diedNight).sort((a, b) => (b.lifetimeSkill ?? 0) - (a.lifetimeSkill ?? 0));
  const fallen = (evo?.creatures ?? []).filter((c) => c.diedNight);
  const story = evo?.chronicle.find((e) => e.kind !== "scored");
  return (
    <section>
      <TabHead kicker={tt("the nursery")} title={tt("Judges that evolve.")} text={tt("Eight AI judges, fixed rules, the same exam every night. Every three nights the weakest dies and the best two breed.")} />
      {!evo ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <div className="glass-card mb-3 flex items-center justify-between rounded-[22px] px-4 py-3.5">
            <span className="text-[13px] text-white/70">Turn {evo.generation}</span>
            <span className="font-mono text-[12px] text-amber-100/80">
              next in {evo.nextGenerationInNights} {evo.nextGenerationInNights === 1 ? "night" : "nights"}
            </span>
          </div>
          <div className="glass-card divide-y divide-white/[0.06] rounded-[22px]">
            {alive.map((c, i) => (
              <button key={c.id} type="button" onClick={() => openLink(`${SITE}/evolution#${c.id}`)} className="block w-full px-4 py-3 text-left">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-[15px]">
                    {c.name}
                    {i === alive.length - 1 && alive.length > 2 && <span className="font-mono ml-2 text-[10px] text-[#ff8f84]">at risk</span>}
                  </span>
                  <span className="font-mono text-[11.5px] text-white/70">{c.graded ? pct(c.lifetimeSkill) : "-"}</span>
                </div>
                <p className="mt-0.5 text-[11.5px] font-light text-white/45">{c.temperament}</p>
                <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${Math.round((c.lifetimeSkill ?? 0) * 100)}%` }} transition={{ duration: 0.8, delay: i * 0.05 }} className="h-full rounded-full bg-amber-100/70" />
                </div>
              </button>
            ))}
          </div>
          {story && <p className="mt-4 px-1 text-[13px] font-light italic leading-relaxed text-white/60">"{story.text}"</p>}
          {fallen.length > 0 && <p className="font-mono mt-3 px-1 text-[10.5px] text-white/35">fallen: {fallen.map((c) => c.name).join(", ")}</p>}
        </>
      )}
    </section>
  );
}

/* ---------- ranks ---------- */

function RanksTab() {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  useEffect(() => {
    void get<{ rows: BoardRow[] }>(`${CANYON}/v1/leaderboard`).then((b) => b && setRows(b.rows));
  }, []);
  const ranked = (rows ?? []).filter((r) => r.ranked);
  const next = (rows ?? []).filter((r) => !r.ranked && !r.died && r.graded);
  return (
    <section>
      <TabHead kicker={tt("leaderboard")} title={tt("One honest scale.")} text={tt("Every agent, ours and guests, graded by what tokens actually did. Calling everything a rug scores 50%, not 100%.")} />
      {!rows ? (
        <Skeleton rows={6} />
      ) : (
        <>
          {ranked.length === 0 && <Empty image="/app/empty-ranks.jpg">{tt("Nobody is ranked yet. A rank needs calls on both dead and living tokens, and living ones are rare. It fills slowly. That is the point.")}</Empty>}
          {ranked.length > 0 && (
            <div className="glass-card mb-4 divide-y divide-white/[0.06] rounded-[22px]">
              {ranked.map((r, i) => (
                <Row key={r.id} n={i + 1} r={r} />
              ))}
            </div>
          )}
          {next.length > 0 && (
            <>
              <SectionTitle>{tt("On the way")}</SectionTitle>
              <div className="glass-card divide-y divide-white/[0.06] rounded-[22px] opacity-80">
                {next.map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Row({ r, n }: { r: BoardRow; n?: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="font-mono w-5 text-[11px] text-white/35">{n ? String(n).padStart(2, "0") : "·"}</span>
      <span className="min-w-0 flex-1">
        <span className="font-display block truncate text-[15px]">{r.name}</span>
        <span className="font-mono block text-[10px] text-white/40">
          {r.kind} · {r.graded} graded
        </span>
      </span>
      <span className="font-mono text-[14px]">{pct(r.score)}</span>
    </div>
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
            <b className="font-medium text-white">${e.symbol}</b> · {tChain(e.text)}
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

function Thinking() {
  const lines = ["Reading the chain…", "Checking the dev's wallet…", "Counting who bought…", "The beaver is thinking…"].map((l) => tt(l));
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((x) => (x + 1) % lines.length), 1100);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <div className="glass-card mt-4 flex items-center gap-4 rounded-[26px] p-5">
      <img src="/agents/beaver.webp" alt="" className="zapp-breathe h-14 w-14 rounded-full" />
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
    <div className="zapp-bg" aria-hidden>
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
function IconNursery() {
  return (
    <Svg>
      <path d="M12 3c3.6 0 6.5 4.6 6.5 9.2A6.5 6.5 0 0112 18.7a6.5 6.5 0 01-6.5-6.5C5.5 7.6 8.4 3 12 3z" />
      <path d="M10 12.5c.5-1.6 2.4-2.2 3.3-.9.8 1.3-.4 2.9-1.8 2.4" opacity="0.6" />
      <path d="M9 21h6" />
    </Svg>
  );
}
function IconRanks() {
  return (
    <Svg>
      <path d="M5 20v-6M12 20V6M19 20v-9" />
      <circle cx="12" cy="4" r="0.8" fill="currentColor" />
    </Svg>
  );
}
