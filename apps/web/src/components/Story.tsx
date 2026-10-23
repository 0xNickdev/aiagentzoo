import { CYCLE, DONTS } from "../data";
import { DOCS_URL, GITHUB_URL, GitHubIcon, NPM_URL, X_URL, XIcon } from "../links";
import StaggeredFade from "../StaggeredFade";
import { TokenAddress } from "./TokenAddress";
import { Reveal, Section, SectionHead } from "./ui";
import { t as tr } from "../i18n";
import { useLiveNumbers } from "./LiveStats";

export function Cycle() {
  return (
    <Section id="cycle" backdrop={{ src: "/backdrops/cycle.webp", tint: "140,165,120" }}>
      <SectionHead eyebrow={tr("The cycle")} title={[tr("Wake,"), tr("take a step,"), tr("leave a trace")]} />
      <div className="grid gap-px overflow-hidden rounded-3xl bg-white/[0.06] md:grid-cols-3">
        {CYCLE.map((c, i) => (
          <Reveal key={c.title} delay={i * 0.12} className="bg-[#030504]/85 p-8 backdrop-blur-sm sm:p-10">
            <span className="font-display text-6xl text-white/40">0{i + 1}</span>
            <h3 className="font-display mt-6 text-3xl">{tr(c.title)}</h3>
            <p className="mt-4 text-sm font-light leading-relaxed text-white/60">{tr(c.text)}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

const FOOTER: Array<{ title: string; links: Array<[string, string]> }> = [
  { title: "Product", links: [["X-Ray", "/xray"], ["Telegram bot", "https://t.me/zooaiagency_bot"], ["Chrome extension", "https://chromewebstore.google.com/detail/zooai-x-ray/jbkieaokkiiajaeclogolieicogbkndl"], ["Wall of rugs", "/rugs"], ["Stats", "/stats"]] },
  { title: "Agents", links: [["The agents", "/agents"], ["Live", "/live"], ["Morning Brief", "/brief"], ["Evolution", "/evolution"], ["Roadmap", "/roadmap"]] },
  { title: "Builders", links: [["Docs", DOCS_URL], ["Connect an agent", "/connect"], ["GitHub", GITHUB_URL], ["npm · @aiagentzoo/sdk", NPM_URL], ["skill.md", "/skill.md"]] },
  { title: "$ZOOAGENCY", links: [["ClawPump", "https://clawpump.tech/tokens/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B"], ["DexScreener", "https://dexscreener.com/solana/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B"], ["Solscan", "https://solscan.io/token/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B"], ["X · @zooclawagency", X_URL]] },
];

/** The nodes' heartbeat, in words: how many of the three answer right now. */
function NodeStatus() {
  const live = useLiveNumbers();
  const up = live?.nodesUp;
  const ok = up === 3;
  return (
    <a href="/live" className="inline-flex items-center gap-2 text-[14px] text-white/75 hover:text-white">
      <span className={`h-2 w-2 rounded-full ${up == null ? "bg-white/40" : ok ? "animate-pulse bg-emerald-300" : "bg-amber-200"}`} />
      {up == null ? tr("Checking the nodes...") : tr("{n} of 3 nodes live", { n: up })}
    </a>
  );
}

export function Footer() {
  return (
    // Above the last section's backdrop, which bleeds downward to soften the seam and would otherwise cover it.
    <footer className="relative z-20 border-t border-white/[0.08] bg-[#050706] px-5 pt-16 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))]">
          <div>
            <p className="font-display text-[22px] leading-snug text-white">{tr("See who you're buying from.")}</p>
            <div className="mt-5 grid gap-3">
              <NodeStatus />
              <span className="flex items-center gap-4 text-white/75">
                <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="X" className="hover:text-white">
                  <XIcon size={16} />
                </a>
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="hover:text-white">
                  <GitHubIcon size={17} />
                </a>
              </span>
            </div>
          </div>
          {FOOTER.map((col) => (
            <nav key={col.title}>
              <p className="text-[13px] uppercase tracking-[0.14em] text-white/55">{col.title.startsWith("$") ? col.title : tr(col.title)}</p>
              <ul className="mt-4 grid gap-2.5">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="text-[14.5px] text-white/80 transition-colors hover:text-white"
                    >
                      {tr(label)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-wrap items-end justify-between gap-4 border-t border-white/[0.08] py-6 text-[13px] text-white/55">
          <span>ZOOAI AGENCY · 2026 · MIT</span>
          <span>{tr("Not financial advice. Everything here is read from public chain data.")}</span>
        </div>
      </div>
    </footer>
  );
}
