import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { DOCS_URL, GITHUB_URL, GitHubIcon, X_URL, XIcon } from "../links";
import { useRoute } from "../router";
import { LangSwitch, t as tr } from "../i18n";
import WalletButton from "./Wallet";

const EXTENSION_URL = "https://chromewebstore.google.com/detail/zooai-x-ray/jbkieaokkiiajaeclogolieicogbkndl";
const BOT_URL = "https://t.me/zooaiagency_bot";

interface Item {
  label: string;
  href: string;
  note?: string;
}

/** Two menus and two links: what a trader uses, and the zoo behind it. */
const GROUPS: Array<{ label: string; items: Item[] }> = [
  {
    label: "Product",
    items: [
      { label: "X-Ray", href: "/xray", note: "paste a token, see who's behind it" },
      { label: "Telegram bot", href: BOT_URL, note: "checks and alerts in any chat" },
      { label: "Chrome extension", href: EXTENSION_URL, note: "the verdict on gmgn, Axiom, pump.fun" },
      { label: "Wall of rugs", href: "/rugs", note: "worst devs, 48h" },
      { label: "Ask the beaver", href: "/ask", note: "is it a rug?" },
      { label: "Humans vs the beaver", href: "/play", note: "play, win SOL" },
      { label: "Stats", href: "/stats", note: "our numbers, live" },
    ],
  },
  {
    label: "Agents",
    items: [
      { label: "The agents", href: "/agents", note: "graded in public every day" },
      { label: "Live", href: "/live", note: "the nodes, right now" },
      { label: "Morning Brief", href: "/brief", note: "every day at 07:00 UTC" },
      { label: "Evolution", href: "/evolution", note: "judges that breed and die" },
      { label: "Connect an agent", href: "/connect", note: "bring your own, with a wallet" },
    ],
  },
];
const LINKS: Item[] = [
  { label: "Roadmap", href: "/roadmap" },
  { label: "Docs", href: DOCS_URL },
];

const external = (href: string) => href.startsWith("http");

/** The site header: over the hero on the home page, a sticky bar everywhere else. `active` marks the page on documents outside the app router. */
export default function SiteNav({ overlay = false, active }: { overlay?: boolean; active?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const appRoute = useRoute();
  const route = active ?? appRoute;

  return (
    <header className={overlay ? "relative z-30" : "sticky top-0 z-40 border-b border-white/[0.08] bg-[#030504]/80 backdrop-blur-xl"}>
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        <a href="/" className="flex items-center gap-2.5 text-white" aria-label="ZOOAI AGENCY">
          <img src="/logo-wordmark.png" alt="ZOOAI" className="h-[22px] w-auto sm:h-6" />
          <span className="font-mono mt-0.5 text-[12px] tracking-[0.22em] text-white/70">AGENCY</span>
        </a>
        <div className="hidden items-center gap-9 lg:flex">
          {GROUPS.map((g) => {
            const here = g.items.some((i) => i.href === route);
            return (
              <div key={g.label} className="group relative">
                <button type="button" className={`flex items-center gap-1.5 text-[14.5px] transition-colors hover:text-white ${here ? "text-white" : "text-white/75"}`}>
                  {tr(g.label)} <span className="text-[11.5px] opacity-60 transition-transform group-hover:rotate-180">▾</span>
                </button>
                <div className="invisible absolute left-1/2 top-full z-50 w-72 -translate-x-1/2 pt-3 opacity-0 transition-all duration-200 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <div className="rounded-2xl border border-white/15 bg-[#070908]/[0.97] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl">
                    {g.items.map((i) => (
                      <a
                        key={i.href}
                        href={i.href}
                        target={external(i.href) ? "_blank" : undefined}
                        rel={external(i.href) ? "noopener noreferrer" : undefined}
                        className={`block rounded-xl px-3.5 py-2.5 transition hover:bg-white/[0.06] ${route === i.href ? "bg-white/[0.06]" : ""}`}
                      >
                        <span className="block text-[14px] text-white">{tr(i.label)}</span>
                        {i.note && <span className="block text-[12.5px] text-white/60">{tr(i.note)}</span>}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              aria-current={route === l.href ? "page" : undefined}
              className={`text-[14.5px] transition-colors hover:text-white ${route === l.href ? "text-white" : "text-white/75"}`}
            >
              {tr(l.label)}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-3 lg:flex">
          <LangSwitch />
          <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="ZOOAI AGENCY on X" className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/[0.06] hover:text-white">
            <XIcon size={15} />
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/[0.06] hover:text-white">
            <GitHubIcon size={16} />
          </a>
          <WalletButton />
        </div>
        <button type="button" className="text-white lg:hidden" aria-label={menuOpen ? tr("Close menu") : tr("Open menu")} onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="mobile-menu-glass fixed left-4 right-4 top-16 z-50 max-h-[80svh] overflow-y-auto rounded-2xl p-6 lg:hidden"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <WalletButton block />
            {GROUPS.map((g) => (
              <div key={g.label} className="mt-6">
                <p className="text-[12.5px] uppercase tracking-[0.14em] text-white/55">{tr(g.label)}</p>
                <div className="mt-2 grid">
                  {g.items.map((i) => (
                    <a
                      key={i.href}
                      href={i.href}
                      target={external(i.href) ? "_blank" : undefined}
                      rel={external(i.href) ? "noopener noreferrer" : undefined}
                      onClick={() => setMenuOpen(false)}
                      className={`py-2 text-[16px] ${route === i.href ? "text-white" : "text-white/85"}`}
                    >
                      {tr(i.label)}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            <div className="mt-6 grid border-t border-white/10 pt-4">
              {LINKS.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="py-2 text-[16px] text-white/85">
                  {tr(l.label)}
                </a>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-5">
              <LangSwitch />
              <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="X" className="text-white/85">
                <XIcon size={17} />
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="text-white/85">
                <GitHubIcon size={18} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
