import { BOT_URL, DOCS_URL, EXTENSION_URL, GITHUB_URL, GitHubIcon, NPM_URL, X_URL, XIcon, ZOOAGENCY_DEXSCREENER_URL, ZOOAGENCY_SOLSCAN_URL } from "../../links";
import { LangSwitch, t } from "../../i18n";
import { TokenCard } from "./ZooToken";

const COLUMNS: Array<{ title: string; links: Array<[string, string]> }> = [
  {
    title: "Product",
    links: [
      ["X-Ray", "/xray"],
      ["Live feed", "/feed"],
      ["Contests", "/contests"],
      ["Chrome extension", EXTENSION_URL],
      ["Telegram bot", BOT_URL],
      ["Caller Truth", "/callers"],
      ["Real volume", "/volume"],
    ],
  },
  {
    title: "Builders",
    links: [
      ["API docs", DOCS_URL],
      ["x402: pay per check", "/x402"],
      ["Connect an agent", "/connect"],
      ["Stats", "/stats"],
      ["skill.md", "/skill.md"],
      ["GitHub", GITHUB_URL],
      ["npm · @aiagentzoo/sdk", NPM_URL],
    ],
  },
  {
    title: "$ZOOAGENCY",
    links: [
      ["DexScreener", ZOOAGENCY_DEXSCREENER_URL],
      ["Solscan", ZOOAGENCY_SOLSCAN_URL],
      ["X · @zooclawagency", X_URL],
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-night px-4 pt-12 sm:px-5">
      <div className="mx-auto max-w-[1440px]">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.3fr)]">
          <div>
            <p className="text-[18px] font-medium tracking-[-0.02em] text-white">{t("See who you're buying from.")}</p>
            <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-dim">{t("Every Solana launch read from the chain: the dev, the first buyers, who paid for them.")}</p>
            <div className="mt-5 flex items-center gap-4 text-dim">
              <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="X" className="hover:text-white">
                <XIcon size={15} />
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="hover:text-white">
                <GitHubIcon size={16} />
              </a>
              <LangSwitch />
            </div>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-[12px] text-faint">{col.title.startsWith("$") ? col.title : t(col.title)}</p>
              <ul className="mt-3 grid gap-2">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="text-[13px] text-fg-2 transition-colors hover:text-white"
                    >
                      {t(label)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
          {/* The home page has its own $ZOOAGENCY panel right above, so the footer card stays off there. */}
          {typeof window !== "undefined" && window.location.pathname === "/" ? null : <TokenCard id="footer-ca" className="self-start" />}
        </div>
        <div className="mt-12 flex flex-wrap items-end justify-between gap-3 border-t border-line py-5 text-[12px] text-faint">
          <span>ZOOAI AGENCY · 2026 · MIT</span>
          <span>{t("Not financial advice. Everything here is read from public chain data.")}</span>
        </div>
      </div>
    </footer>
  );
}
