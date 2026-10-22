import { AnimatePresence, motion } from "framer-motion";
import { type FormEvent, useEffect, useRef, useState } from "react";
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

/** Where the lit sphere sits in /backdrops/roadmap-trail.webp (2400 x 1348): its flame, and the glass around it. */
const IMG = { w: 2400, h: 1348, focusX: 0.6 };
const FLAME = { x: 1624, y: 925, r: 78 };

/**
 * The forest is the verdict display: the sphere burning on the trail is the one that answers. While the chain is read
 * its light swells; then it burns steady, shakes, or goes out, leaving an ember. Nothing is drawn on top that is not
 * light: a glow, a shadow over the flame, a coal.
 */
function Forest({ state }: { state: Flame }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; r: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const k = Math.max(width / IMG.w, height / IMG.h);
      const ox = (width - IMG.w * k) * IMG.focusX;
      const oy = (height - IMG.h * k) * 0.5;
      setAt({ x: ox + FLAME.x * k, y: oy + FLAME.y * k, r: FLAME.r * k });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} aria-hidden className="absolute inset-0 overflow-hidden">
      <div className="zoo-drift absolute inset-0">
        <img src="/backdrops/roadmap-trail.webp" alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: `${IMG.focusX * 100}% 50%` }} />
        {at && (
          <div className="zoo-light absolute" data-state={state} style={{ left: at.x, top: at.y, width: at.r * 2, height: at.r * 2, marginLeft: -at.r, marginTop: -at.r }}>
            <span className="zoo-light-glow absolute inset-[-260%] rounded-full" />
            <span className="zoo-light-dark absolute inset-[-220%] rounded-full" />
            <span className="zoo-light-out absolute inset-[-12%] rounded-full" />
            <span className="zoo-light-coal absolute left-1/2 top-[78%] h-[14%] w-[34%] -translate-x-1/2 rounded-full" />
          </div>
        )}
      </div>
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
      <Forest state={state} />
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,5,4,0.95)_0%,rgba(3,5,4,0.8)_38%,rgba(3,5,4,0.15)_62%,transparent_80%)]" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#030504] via-transparent to-[#030504]/60" />

      <SiteNav overlay />

      <main className="relative z-10 mx-auto grid min-h-[calc(100svh-80px)] max-w-7xl items-center gap-10 px-5 pb-20 pt-8 sm:px-8 ">
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

      </main>
    </div>
  );
}
