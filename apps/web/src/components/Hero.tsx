import { motion } from "framer-motion";
import { type FormEvent, useState } from "react";
import { ArrowRight } from "lucide-react";
import { navigate } from "../router";
import SiteNav from "./SiteNav";
import { CAPill } from "./TokenAddress";
import { pick, t } from "../i18n";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260619_191346_9d19d66e-86a4-47f7-8dc6-712c1788c3b2.mp4";

const mintIn = (text: string) => text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, delay, ease: [0.215, 0.61, 0.355, 1] as const },
});

export default function Hero() {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  // The x-ray is the front door: paste a token here, read it there.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const mint = mintIn(input);
    if (!mint) return setError(true);
    navigate(`/xray?mint=${mint}`);
  };

  return (
    <div className="relative min-h-[100svh] overflow-hidden">
      <video
        className="absolute inset-0 h-full w-full object-cover object-center opacity-90 lg:translate-x-[22%] lg:scale-110"
        // Fade the video itself into the page so the tinted night below shows through: no seam.
        style={{ maskImage: "linear-gradient(to bottom, #000 60%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, #000 60%, transparent 100%)" }}
        src={VIDEO_URL}
        autoPlay
        muted
        loop
        playsInline
      />
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
              className="rounded-full bg-white px-7 py-3.5 text-[15px] font-medium text-black transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:opacity-70"
            >
              {t("X-ray it")}
            </button>
          </motion.form>
          {error && <p className="mt-3 text-[14px] text-[#ff8a7e]">{t("Paste a token address or link.")}</p>}


          {(
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
