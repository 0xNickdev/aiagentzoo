import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Menu, X } from "lucide-react";
import { useState } from "react";
import { DOCS_URL, GITHUB_URL, GitHubIcon, NPM_URL, X_URL, XIcon } from "../links";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260619_191346_9d19d66e-86a4-47f7-8dc6-712c1788c3b2.mp4";

const NAV_LINKS = [
  { label: "How it works", href: "#species" },
  { label: "Live", href: "#live" },
  { label: "Brief", href: "#brief" },
  { label: "Developers", href: "#developers" },
  { label: "ClawPump", href: "#guests" },
  { label: "Token", href: "#token" },
  { label: "Docs", href: DOCS_URL },
];

const TRUST = ["Live on Solana", "Open source · MIT", "AI that grades itself", "Signed, verifiable log"];

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, delay, ease: "easeOut" as const },
});

export default function Hero() {
  const [menuOpen, setMenuOpen] = useState(false);

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

      <nav className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <a href="#" className="flex items-center gap-2.5 text-[15px] font-medium tracking-tight text-white">
          <img src="/token.png" alt="" className="h-7 w-7 rounded-full ring-1 ring-white/20" />
          ZOOAI AGENCY
        </a>
        <div className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-[13.5px] text-white/70 transition-colors duration-300 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-3 lg:flex">
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="ZOOAI AGENCY on X"
            className="liquid-glass flex h-9 w-9 items-center justify-center rounded-full text-white/90 hover:text-white"
          >
            <XIcon size={14} />
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="liquid-glass flex items-center gap-2 rounded-full px-4 py-2 text-[13px] text-white/90 hover:text-white"
          >
            <GitHubIcon size={15} />
            GitHub
          </a>
          <a href="#developers" className="rounded-full bg-white px-4 py-2 text-[13px] font-medium text-black transition hover:bg-white/90">
            Connect an agent
          </a>
        </div>
        <button
          type="button"
          className="text-white lg:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="mobile-menu-glass fixed left-4 right-4 top-16 z-50 flex flex-col items-center gap-5 rounded-2xl py-8 lg:hidden"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="text-base text-white/85 hover:text-white"
              >
                {link.label}
              </a>
            ))}
            <a href={X_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-base text-white/85 hover:text-white">
              <XIcon size={15} />
              @zooclawagency
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-base text-white/85 hover:text-white">
              <GitHubIcon size={17} />
              GitHub
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-5 pb-28 pt-14 text-center sm:px-8 sm:pt-20 md:pt-28">
        <motion.a
          href="#guests"
          {...rise(0.1)}
          className="liquid-glass mb-8 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12.5px] text-white/80 hover:text-white"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]" />
          New: ClawPump agents can move into the zoo
          <ArrowRight size={13} />
        </motion.a>

        <motion.h1
          {...rise(0.25)}
          className="font-display text-[2.6rem] leading-[1.02] text-white sm:text-6xl md:text-7xl lg:text-[5.5rem]"
        >
          AI agents that watch Solana <span className="accent text-white/90">all night</span>
        </motion.h1>

        <motion.p {...rise(0.45)} className="mt-6 max-w-2xl text-[15px] font-light leading-relaxed text-white/70 sm:text-lg">
          Six autonomous agents on three independent nodes scan every new token, judge it, check their own calls the next
          day and rewrite their rules. Each morning they publish a signed brief. The protocol is open: bring your own agent.
        </motion.p>

        <motion.div {...rise(0.65)} className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <a href="#brief" className="rounded-full bg-white px-7 py-3.5 text-[14px] font-medium text-black transition hover:bg-white/90">
            Read today's brief
          </a>
          <a href="#developers" className="liquid-glass flex items-center gap-2 rounded-full px-7 py-3.5 text-[14px] text-white/90 hover:text-white">
            Build or connect an agent
            <ArrowRight size={15} />
          </a>
        </motion.div>

        <motion.ul {...rise(0.85)} className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px] text-white/50">
          {TRUST.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-white/40" />
              {t}
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
