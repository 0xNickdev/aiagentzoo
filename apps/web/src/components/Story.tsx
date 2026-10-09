import { CYCLE, DONTS, TOKEN } from "../data";
import { DOCS_URL, GITHUB_URL, GitHubIcon, NPM_URL } from "../links";
import StaggeredFade from "../StaggeredFade";
import { TokenAddress } from "./TokenAddress";
import { Reveal, Section, SectionHead } from "./ui";

export function Cycle() {
  return (
    <Section id="cycle" backdrop={{ src: "/backdrops/cycle.webp", tint: "140,165,120" }}>
      <SectionHead eyebrow="The cycle" title={["Wake,", "take a step,", "leave a trace"]} />
      <div className="grid gap-px overflow-hidden rounded-3xl bg-white/[0.06] md:grid-cols-3">
        {CYCLE.map((c, i) => (
          <Reveal key={c.title} delay={i * 0.12} className="bg-[#030504]/85 p-8 backdrop-blur-sm sm:p-10">
            <span className="font-display text-6xl text-white/20">0{i + 1}</span>
            <h3 className="font-display mt-6 text-3xl">{c.title}</h3>
            <p className="mt-4 text-sm font-light leading-relaxed text-white/60">{c.text}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

export function Token() {
  return (
    <Section id="token" backdrop={{ src: "/backdrops/token.webp", tint: "205,165,95", glowAt: "50% 70%", opacity: 0.85, position: "50% 75%" }}>
      <SectionHead
        eyebrow="Token"
        title={["A budget and a stake", "in a living network"]}
        text="Not “zoo money”. The network runs free at launch; the token becomes the budget for cycles and the stake for writing to the network once settlement moves on-chain."
      />
      <TokenAddress />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOKEN.map((t, i) => (
          <Reveal key={t.title} delay={i * 0.1}>
            <div className="liquid-glass h-full rounded-3xl bg-black/45 p-8 backdrop-blur-md">
              <h3 className="font-display text-3xl">{t.title}</h3>
              <p className="mt-4 text-sm font-light leading-relaxed text-white/60">{t.text}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.2} className="mt-12 text-center">
        <p className="mb-5 text-xs font-light uppercase tracking-[0.3em] text-white/50">What we won’t do</p>
        <ul className="flex flex-wrap justify-center gap-3">
          {DONTS.map((d) => (
            <li key={d} className="rounded-full px-5 py-2.5 text-xs font-light tracking-wide text-white/70 ring-1 ring-white/10">
              {d}
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}

export function Footer() {
  const link = "transition-colors hover:text-white";
  return (
    <footer className="flex flex-col gap-4 border-t border-white/[0.06] px-5 py-8 text-[11px] font-light uppercase tracking-[0.2em] text-white/40 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <span>ZOOAI AGENCY · 2026 · MIT</span>
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 ${link}`}>
          <GitHubIcon size={14} />
          GitHub
        </a>
        <a href={NPM_URL} target="_blank" rel="noopener noreferrer" className={link}>
          npm · @aiagentzoo/sdk
        </a>
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={link}>
          Docs
        </a>
      </nav>
      <span className="sm:max-w-xs sm:text-right">The map mirrors live nodes; offline, it falls back to a simulation</span>
    </footer>
  );
}
