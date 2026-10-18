import { motion } from "framer-motion";
import { type FormEvent, useState } from "react";
import { ArrowRight } from "lucide-react";
import { NPM_URL } from "../links";
import { navigate } from "../router";
import SiteNav from "./SiteNav";
import { CAPill } from "./TokenAddress";
import { pick, t, t as tr } from "../i18n";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260619_191346_9d19d66e-86a4-47f7-8dc6-712c1788c3b2.mp4";

const TRUST = ["Free, no sign-up", "pump.fun · LaunchLab · Meteora", "Read straight from Solana", "Open source · MIT"];

const mintIn = (text: string) => text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, delay, ease: "easeOut" as const },
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
    <div className="relative min-h-screen overflow-hidden">
      <video
        className="absolute inset-0 h-full w-full object-cover object-center opacity-80"
        // Fade the video itself into the page so the tinted night below shows through: no seam.
        style={{
          maskImage: "linear-gradient(to bottom, #000 55%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 55%, transparent 100%)",
        }}
        src={VIDEO_URL}
        autoPlay
        muted
        loop
        playsInline
      />
      {/* Keeps the copy legible over any frame of the video. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_45%,rgba(3,5,4,0.55),transparent_75%)]" />

      <SiteNav overlay />

      <main className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-5 pb-28 pt-14 text-center sm:px-8 sm:pt-20 md:pt-28">
        <motion.div {...rise(0.05)} className="mb-3 max-w-full">
          <CAPill />
        </motion.div>
        <motion.a
          href="/rugs"
          {...rise(0.1)}
          className="liquid-glass mb-8 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12.5px] text-white/80 hover:text-white"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]" />
          {t("Wall of rugs: the devs who dump, live from the chain")}
          <ArrowRight size={13} />
        </motion.a>

        <motion.h1
          {...rise(0.25)}
          className="font-display text-[2.6rem] leading-[1.02] text-white sm:text-6xl md:text-7xl lg:text-[5.5rem]"
        >
          {pick(
            <>
              See who you're
              <br />
              <span className="accent">buying from.</span>
            </>,
            <>
              看清你在<span className="accent">从谁手里买。</span>
            </>,
          )}
        </motion.h1>

        <motion.p {...rise(0.45)} className="mt-6 max-w-2xl text-[15px] font-light leading-relaxed text-white/75 sm:text-lg">
          {t("Paste any Solana token. See the dev's own wallets, the snipers in the first five seconds, and who paid for them. Free, read straight from the chain, graded in public.")}
        </motion.p>

        <motion.form {...rise(0.6)} onSubmit={submit} className="liquid-glass mt-9 flex w-full max-w-2xl flex-col gap-2 rounded-3xl p-2 sm:flex-row sm:rounded-full">
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(false);
            }}
            placeholder={t("token address or pump.fun link")}
            spellCheck={false}
            autoComplete="off"
            className="font-mono min-w-0 flex-1 bg-transparent px-5 py-3 text-[14px] text-white outline-none placeholder:text-white/40"
            aria-label={t("Token address")}
          />
          <button type="submit" className="rounded-full bg-white px-7 py-3 text-[14px] font-medium text-black transition hover:bg-white/90">
            {t("X-ray it")}
          </button>
        </motion.form>
        {error && <p className="mt-3 text-[13px] text-[#ff9a8f]">{t("Paste a token address or link.")}</p>}

        <motion.div {...rise(0.75)} className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px]">
          <a href="#species" className="flex items-center gap-1.5 text-white/70 hover:text-white">
            {t("How it works: eight agents that grade their own calls")}
            <ArrowRight size={14} />
          </a>
          <a href="/brief" className="text-white/55 hover:text-white">
            {t("Read today's brief")}
          </a>
        </motion.div>

        <motion.ul {...rise(0.85)} className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px] text-white/50">
          {TRUST.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-white/40" />
              {tr(t)}
            </li>
          ))}
          <li>
            <a href={NPM_URL} target="_blank" rel="noopener noreferrer" className="font-mono text-white/60 hover:text-white">
              npm i @aiagentzoo/sdk
            </a>
          </li>
        </motion.ul>
      </main>
    </div>
  );
}
