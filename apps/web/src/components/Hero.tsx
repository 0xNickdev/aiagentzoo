import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import StaggeredFade from "../StaggeredFade";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260619_191346_9d19d66e-86a4-47f7-8dc6-712c1788c3b2.mp4";

const NAV_LINKS = [
  { label: "Species", href: "#species" },
  { label: "Night Watch", href: "#live" },
  { label: "Token", href: "#token" },
  { label: "Roadmap", href: "#roadmap" },
];

export default function Hero() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative h-screen overflow-hidden bg-[#010101]">
      <video
        className="absolute inset-0 h-full w-full object-cover object-center"
        src={VIDEO_URL}
        autoPlay
        muted
        loop
        playsInline
      />

      <nav className="relative z-20 flex items-center justify-between px-5 py-6 sm:px-8 md:justify-center md:gap-16">
        <span className="font-light uppercase tracking-[0.25em] text-white md:tracking-[0.3em]">
          AiAgentZoo
        </span>
        <div className="hidden items-center gap-10 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm uppercase tracking-[0.2em] text-white/80 transition-colors duration-300 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>
        <button
          type="button"
          className="text-white md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="mobile-menu-glass fixed left-4 right-4 top-16 z-50 flex flex-col items-center gap-5 rounded-2xl py-8 md:hidden"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {NAV_LINKS.map((link, i) => (
              <motion.a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="font-light uppercase tracking-[0.25em] text-white/90 transition-colors hover:text-white"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.06 }}
              >
                {link.label}
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative z-10 flex flex-col items-center px-5 pt-12 text-center sm:px-8 sm:pt-16 md:pt-24">
        <h1 className="font-garamond mb-6 text-4xl font-normal leading-[1.08] tracking-tight text-white sm:mb-8 sm:text-6xl md:text-8xl lg:text-9xl">
          <StaggeredFade text="A ZOO WHERE" />
          <StaggeredFade text="AGENTS LIVE" />
        </h1>

        <motion.p
          className="mb-8 max-w-xs text-sm font-light leading-relaxed text-white/70 sm:mb-10 sm:max-w-md sm:text-base md:text-lg"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.6 }}
        >
          Autonomous animals wake and roam their territory,
          <br className="hidden sm:block" /> leaving a trace anyone can watch.
        </motion.p>

        <motion.a
          href="#live"
          className="liquid-glass inline-block rounded-full px-7 py-3.5 text-sm uppercase tracking-[0.18em] text-white/90 sm:px-10 sm:py-4 sm:tracking-[0.2em]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 2.0 }}
        >
          Watch the Night
        </motion.a>
      </main>
    </div>
  );
}
