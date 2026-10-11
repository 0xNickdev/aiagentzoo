import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { DOCS_URL, GITHUB_URL, GitHubIcon, X_URL, XIcon } from "../links";
import { useRoute } from "../router";

export const NAV_LINKS = [
  { label: "Live", href: "/live" },
  { label: "Brief", href: "/brief" },
  { label: "Evolution", href: "/evolution" },
  { label: "Agents", href: "/agents" },
  { label: "Docs", href: DOCS_URL },
];

/** The site header: over the hero video on the home page, a sticky bar everywhere else. */
/** `active` marks the current page on documents outside the app router (/docs, /evolution). */
export default function SiteNav({ overlay = false, active }: { overlay?: boolean; active?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const appRoute = useRoute();
  const route = active ?? appRoute;

  return (
    <header className={overlay ? "relative z-20" : "sticky top-0 z-40 border-b border-white/[0.07] bg-[#030504]/75 backdrop-blur-xl"}>
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        <a href="/" className="flex items-center gap-2.5 text-[15px] font-medium tracking-tight text-white">
          <img src="/token.png" alt="" className="h-7 w-7 rounded-full ring-1 ring-white/20" />
          ZOOAI AGENCY
        </a>
        <div className="hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map((link) => (
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
