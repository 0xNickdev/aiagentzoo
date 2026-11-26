import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { DOCS_URL, EXTENSION_URL } from "../links";
import { useRoute } from "../router";
import { LangSwitch, t as tr } from "../i18n";
import { TokenCard, TokenChip } from "./site/ZooToken";

interface Item {
  label: string;
  href: string;
  /** Pages that light this item up besides its own. */
  also?: string[];
}

/** What a trader comes for, in the order they use it. */
const LINKS: Item[] = [
  { label: "X-Ray", href: "/xray", also: ["/callers", "/volume"] },
  { label: "Feed", href: "/feed" },
  { label: "Radar", href: "/radar" },
  { label: "Contests", href: "/contests", also: ["/play"] },
  { label: "Roadmap", href: "/roadmap" },
  { label: "Token", href: "/token" },
  { label: "Extension", href: EXTENSION_URL },
  { label: "API", href: DOCS_URL, also: ["/x402", "/connect", "/stats"] },
];

const external = (href: string) => href.startsWith("http");
const linkProps = (href: string) => (external(href) ? { target: "_blank", rel: "noopener noreferrer" } : {});

/** True once the page has scrolled under the bar, so its bottom edge can light up. */
function useScrolledUnder(): boolean {
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const on = () => setUnder(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return under;
}

/** The site's top bar: glass over the page, the five things a trader uses, and $ZOOAGENCY on every page. `active` marks the page on documents outside the app router. */
export default function SiteNav({ active }: { active?: string }) {
  const [open, setOpen] = useState(false);
  const appRoute = useRoute();
  const route = active ?? appRoute;
  const under = useScrolledUnder();
  const on = (i: Item) => route === i.href || !!i.also?.includes(route);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <header className="glass-bar sticky top-0 z-40" data-under={under || open}>
      <nav className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-5 px-4 sm:px-5" aria-label={tr("Site")}>
        <a href="/" className="flex shrink-0 items-center gap-2 text-white" aria-label="ZOOAI AGENCY">
          <img src="/logo.svg" alt="ZOOAI" className="h-[15px] w-auto" />
          <span className="mt-px text-[11px] tracking-[0.22em] text-dim">AGENCY</span>
        </a>
        <div className="hidden items-center gap-0.5 lg:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              {...linkProps(l.href)}
              aria-current={on(l) ? "page" : undefined}
              className={`flex h-8 items-center whitespace-nowrap rounded-[7px] px-3 text-[13px] transition-colors ${on(l) ? "bg-night-raised text-white" : "text-dim hover:bg-night-surface hover:text-fg-2"}`}
            >
              {tr(l.label)}
              {external(l.href) && <span className="ml-1 text-faint">↗</span>}
            </a>
          ))}
        </div>
        <span className="flex-1" />
        <div className="hidden items-center gap-3 lg:flex">
          <LangSwitch />
          <TokenChip />
        </div>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-line text-white lg:hidden"
          aria-label={open ? tr("Close menu") : tr("Open menu")}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-line bg-night px-4 pb-5 pt-2 lg:hidden">
          <div className="grid">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                {...linkProps(l.href)}
                onClick={() => setOpen(false)}
                aria-current={on(l) ? "page" : undefined}
                className={`flex h-11 items-center justify-between border-b border-line text-[15px] ${on(l) ? "text-white" : "text-fg-2"}`}
              >
                {tr(l.label)}
                {external(l.href) && <span className="text-faint">↗</span>}
              </a>
            ))}
          </div>
          <TokenCard id="menu-ca" className="mt-4" />
          <LangSwitch className="mt-4 w-fit" />
        </div>
      )}
    </header>
  );
}
