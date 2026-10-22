import { AnimatePresence, motion } from "framer-motion";
import { type FormEvent, useState } from "react";
import { ArrowRight } from "lucide-react";
import { navigate } from "../router";
import SiteNav from "./SiteNav";
import { CAPill } from "./TokenAddress";
import { pick, t, tChain } from "../i18n";
import { NODE_URLS } from "../sim/live";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";

const mintIn = (text: string) => text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, delay, ease: [0.215, 0.61, 0.355, 1] as const },
});

type Flame = "idle" | "think" | "pass" | "caution" | "avoid" | "unknown";
interface Check {
  mint: string;
  symbol?: string;
  verdict: "pass" | "caution" | "avoid" | "unknown";
  reasons: string[];
}

const VERDICT: Record<Check["verdict"], { label: string; line: string; color: string }> = {
  avoid: { label: "Avoid", line: "The flame went out.", color: "#ff8a7e" },
  caution: { label: "Caution", line: "The flame is shaking.", color: "#f2d39b" },
  pass: { label: "No red flags so far", line: "Steady flame. Not a call that it goes up.", color: "#9df3b0" },
  unknown: { label: "Not seen yet", line: "We have not read this token on the chain yet.", color: "rgba(255,255,255,0.7)" },
};

/**
 * The glass sphere from the forest, and the verdict's display: it waits with a small flame, flares while the chain is
 * read, then burns steady, shakes, or goes out. Only state uses amber.
 */
function Sphere({ state, className = "" }: { state: Flame; className?: string }) {
  return (
    <div className={`zoo-sphere relative aspect-square ${className}`} data-state={state} aria-hidden>
      <div className="zoo-sphere-glow absolute inset-[-30%] rounded-full" />
      <div className="absolute inset-0 rounded-full border border-white/25 bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.35),rgba(255,255,255,0.04)_38%,rgba(255,255,255,0.02)_62%,rgba(255,255,255,0.12)_100%)] shadow-[inset_0_0_40px_rgba(255,255,255,0.06),0_30px_60px_rgba(0,0,0,0.5)] backdrop-blur-[2px]" />
      <div className="zoo-flame absolute bottom-[24%] left-1/2 h-[38%] w-[22%] -translate-x-1/2" />
      <div className="zoo-ember absolute bottom-[22%] left-1/2 h-[6%] w-[16%] -translate-x-1/2 rounded-full" />
      <div className="absolute left-[22%] top-[14%] h-[16%] w-[26%] rotate-[-25deg] rounded-full bg-white/35 blur-[6px]" />
      <div className="absolute -bottom-[6%] left-1/2 h-[8%] w-[60%] -translate-x-1/2 rounded-[50%] bg-black/50 blur-[6px]" />
    </div>
  );
}

export default function Hero() {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [state, setState] = useState<Flame>("idle");
  const [check, setCheck] = useState<Check | null>(null);

  // The x-ray is the front door: the sphere answers here first, the full x-ray is one tap on.
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mint = mintIn(input);
    if (!mint) return setError(true);
    setCheck(null);
    setState("think");
    const started = Date.now();
    try {
      const r = await fetch(`${NORTH}/v1/check/${mint}`);
      if (!r.ok) throw new Error(String(r.status));
      const c = (await r.json()) as Check;
      // Let the flame flare for a moment even when the chain answers instantly.
      await new Promise((ok) => setTimeout(ok, Math.max(0, 1100 - (Date.now() - started))));
      const v = ["pass", "caution", "avoid"].includes(c.verdict) ? c.verdict : "unknown";
      setCheck({ ...c, mint, verdict: v });
      setState(v);
    } catch {
      navigate(`/xray?mint=${mint}`);
    }
  };

  const v = check ? VERDICT[check.verdict] : null;

  return (
    <div className="relative min-h-[100svh] overflow-hidden">
      <img src="/backdrops/roadmap-trail.webp" alt="" aria-hidden className="zoo-drift absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "60% 50%" }} />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#030504]/95 via-[#030504]/70 to-[#030504]/25" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#030504] via-transparent to-[#030504]/60" />

      <SiteNav overlay />

      <main className="relative z-10 mx-auto grid min-h-[calc(100svh-80px)] max-w-7xl items-center gap-10 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <div>
          <motion.div {...rise(0.05)} className="mb-8 max-w-full">
            <CAPill />
          </motion.div>
          <motion.h1 {...rise(0.15)} className="font-display text-[48px] font-semibold leading-[0.98] text-white sm:text-7xl lg:text-[96px]">
            {pick(
              <>
                Know the dev
                <br />
                <span className="accent">before you ape.</span>
              </>,
              <>
                买之前，
                <br />
                <span className="accent">先看清开发者。</span>
              </>,
            )}
          </motion.h1>
          <motion.p {...rise(0.3)} className="mt-7 max-w-xl text-[17px] leading-relaxed text-white/80 sm:text-lg">
            {t("Paste any Solana token. In a second you see the dev's other launches, the snipers in the first five seconds and who paid for them. Free, read straight from the chain.")}
          </motion.p>

          <motion.form {...rise(0.45)} onSubmit={submit} className="mt-9 flex w-full max-w-2xl flex-col gap-2 rounded-3xl border border-white/15 bg-[#030504]/60 p-2 backdrop-blur-xl sm:flex-row sm:rounded-full">
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(false);
              }}
              placeholder={t("token address or pump.fun link")}
              spellCheck={false}
              autoComplete="off"
              className="font-mono min-w-0 flex-1 bg-transparent px-5 py-3.5 text-[15px] text-white outline-none placeholder:text-white/50"
              aria-label={t("Token address")}
            />
            <button
              type="submit"
              disabled={state === "think"}
              className="rounded-full bg-white px-7 py-3.5 text-[15px] font-medium text-black transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:opacity-70"
            >
              {state === "think" ? t("Reading the chain...") : t("Light it up")}
            </button>
          </motion.form>
          {error && <p className="mt-3 text-[14px] text-[#ff8a7e]">{t("Paste a token address or link.")}</p>}

          <AnimatePresence>
            {check && v && (
              <motion.div
                key={check.mint}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="mt-6 max-w-2xl border-l-2 pl-5"
                style={{ borderColor: v.color }}
                aria-live="polite"
              >
                <Sphere state={state} className="float-right ml-4 w-16 lg:hidden" />
                <p className="text-[13px] uppercase tracking-[0.14em]" style={{ color: v.color }}>
                  {check.symbol ? `$${check.symbol} · ` : ""}
                  {t(v.label)}
                </p>
                <p className="font-display mt-1 text-[22px] text-white">{t(v.line)}</p>
                {check.reasons.slice(0, 2).map((r) => (
                  <p key={r} className="mt-1.5 text-[15px] leading-relaxed text-white/75">
                    {tChain(r).replace(/^./, (x) => x.toUpperCase())}
                  </p>
                ))}
                <a href={`/xray?mint=${check.mint}`} className="mt-4 inline-flex items-center gap-2 text-[15px] text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                  {t("Open the full X-Ray")} <ArrowRight size={15} />
                </a>
              </motion.div>
            )}
          </AnimatePresence>

          {!check && (
            <motion.div {...rise(0.6)} className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-2 text-[15px]">
              <a href="/rugs" className="inline-flex items-center gap-1.5 text-white/80 hover:text-white">
                {t("Wall of rugs, live")} <ArrowRight size={15} />
              </a>
              <a href="https://t.me/zooaiagency_bot" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white">
                {t("Open the Telegram bot")}
              </a>
              <a href="/roadmap" className="text-white/70 hover:text-white">
                {t("Roadmap")}
              </a>
            </motion.div>
          )}
        </div>

        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4, delay: 0.3, ease: [0.215, 0.61, 0.355, 1] }} className="hidden justify-center lg:flex">
          <Sphere state={state} className="w-[min(360px,28vw)]" />
        </motion.div>
      </main>
    </div>
  );
}
