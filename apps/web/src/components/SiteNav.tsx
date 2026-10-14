import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { DOCS_URL, GITHUB_URL, GitHubIcon, X_URL, XIcon } from "../links";
import { useRoute } from "../router";

export const NAV_LINKS = [
  { label: "Ask", href: "/ask" },
  { label: "Play", href: "/play" },
  { label: "Rugs", href: "/rugs" },
  { label: "Live", href: "/live" },
  { label: "Brief", href: "/brief" },
  { label: "Evolution", href: "/evolution" },
  { label: "Agents", href: "/agents" },
  { label: "Docs", href: DOCS_URL },
];

/** The tools a visitor uses, grouped under one menu on wide screens so the bar stays calm. */
const TOOLS = [
  { label: "Ask the beaver", href: "/ask", note: "is it a rug?" },
  { label: "Humans vs the beaver", href: "/play", note: "play, win SOL" },
  { label: "Wall of rugs", href: "/rugs", note: "worst devs, 48h" },
];
const TOOL_HREFS = new Set(TOOLS.map((t) => t.href));

/** The site header: over the hero video on the home page, a sticky bar everywhere else. */
/** `active` marks the current page on documents outside the app router (/docs, /evolution). */
export default function SiteNav({ overlay = false, active }: { overlay?: boolean; active?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const appRoute = useRoute();
  const route = active ?? appRoute;

  return (
    <header className={overlay ? "relative z-20" : "sticky top-0 z-40 border-b border-white/[0.07] bg-[#030504]/75 backdrop-blur-xl"}>
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        <a href="/" className="flex items-center gap-2.5 text-white" aria-label="ZOOAI AGENCY">
          <img src="/logo-wordmark.png" alt="ZOOAI" className="h-[22px] w-auto sm:h-6" />
          <span className="font-mono mt-0.5 text-[10.5px] tracking-[0.22em] text-white/50">AGENCY</span>
        </a>
        <div className="hidden items-center gap-8 lg:flex">
          <div className="group relative">
            <button type="button" className={`flex items-center gap-1 text-[13.5px] transition-colors duration-300 hover:text-white ${TOOL_HREFS.has(route) ? "text-white" : "text-white/65"}`}>
              Tools <span className="text-[10px] opacity-60 transition-transform group-hover:rotate-180">▾</span>
            </button>
            <div className="invisible absolute left-1/2 top-full z-50 w-64 -translate-x-1/2 pt-3 opacity-0 transition-all duration-200 group-hover:visible group-hover:opacity-100">
              <div className="liquid-glass rounded-2xl bg-[#070908]/90 p-2 shadow-2xl backdrop-blur-xl">
                {TOOLS.map((t) => (
                  <a key={t.href} href={t.href} className={`block rounded-xl px-3.5 py-2.5 transition hover:bg-white/[0.06] ${route === t.href ? "bg-white/[0.06]" : ""}`}>
                    <span className="block text-[13.5px] text-white">{t.label}</span>
                    <span className="font-mono block text-[10.5px] text-white/45">{t.note}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
          {NAV_LINKS.filter((l) => !TOOL_HREFS.has(l.href)).map((link) => (
            <a
              key={link.label}
              href={link.href}
              aria-current={route === link.href ? "page" : undefined}
              className={`text-[13.5px] transition-colors duration-300 hover:text-white ${route === link.href ? "text-white" : "text-white/65"}`}
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
          <a href="/agents" className="rounded-full bg-white px-4 py-2 text-[13px] font-medium text-black transition hover:bg-white/90">
            Connect an agent
          </a>
        </div>
        <button type="button" className="text-white lg:hidden" aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen((open) => !open)}>
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
              <a key={link.label} href={link.href} onClick={() => setMenuOpen(false)} className={`text-base hover:text-white ${route === link.href ? "text-white" : "text-white/80"}`}>
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
    </header>
  );
}
