import { CYCLE, DONTS, TOKEN } from "../data";
import { DOCS_URL, GITHUB_URL, GitHubIcon, NPM_URL, X_URL, XIcon } from "../links";
import StaggeredFade from "../StaggeredFade";
import { TokenAddress } from "./TokenAddress";
import { Reveal, Section, SectionHead } from "./ui";
import { t as tr } from "../i18n";

export function Cycle() {
  return (
    <Section id="cycle" backdrop={{ src: "/backdrops/cycle.webp", tint: "140,165,120" }}>
      <SectionHead eyebrow={tr("The cycle")} title={[tr("Wake,"), tr("take a step,"), tr("leave a trace")]} />
      <div className="grid gap-px overflow-hidden rounded-3xl bg-white/[0.06] md:grid-cols-3">
        {CYCLE.map((c, i) => (
          <Reveal key={c.title} delay={i * 0.12} className="bg-[#030504]/85 p-8 backdrop-blur-sm sm:p-10">
            <span className="font-display text-6xl text-white/20">0{i + 1}</span>
            <h3 className="font-display mt-6 text-3xl">{tr(c.title)}</h3>
            <p className="mt-4 text-sm font-light leading-relaxed text-white/60">{tr(c.text)}</p>
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
        eyebrow={tr("Token")}
        title={[tr("A budget and a stake"), tr("in a living network")]}
        text={tr("Not “zoo money”. The network runs free at launch; the token becomes the budget for cycles and the stake for writing to the network once settlement moves on-chain.")}
      />
      <TokenAddress />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOKEN.map((t, i) => (
          <Reveal key={t.title} delay={i * 0.1}>
            <div className="liquid-glass h-full rounded-3xl bg-black/45 p-8 backdrop-blur-md">
              <h3 className="font-display text-3xl">{tr(t.title)}</h3>
              <p className="mt-4 text-sm font-light leading-relaxed text-white/60">{tr(t.text)}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.2} className="mt-12 text-center">
        <p className="mb-5 text-xs font-light uppercase tracking-[0.3em] text-white/50">{tr("What we won’t do")}</p>
        <ul className="flex flex-wrap justify-center gap-3">
          {DONTS.map((d) => (
            <li key={d} className="rounded-full px-5 py-2.5 text-xs font-light tracking-wide text-white/70 ring-1 ring-white/10">
              {tr(d)}
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}

export function Footer() {
  const link = "text-white/75 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60";
  return (
    // Above the last section's backdrop, which bleeds downward to soften the seam and would otherwise cover it.
    <footer className="relative z-20 flex flex-col gap-4 border-t border-white/[0.08] bg-black/60 px-5 py-8 text-[11px] font-light uppercase tracking-[0.2em] text-white/55 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <span>ZOOAI AGENCY · 2026 · MIT</span>
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <a href={X_URL} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 ${link}`}>
          <XIcon size={13} />
          @zooclawagency
        </a>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 ${link}`}>
          <GitHubIcon size={14} />
          GitHub
        </a>
        <a href={NPM_URL} target="_blank" rel="noopener noreferrer" className={link}>
          npm · @aiagentzoo/sdk
        </a>
        <a href={DOCS_URL} className={link}>
          {tr("Docs")}
        </a>
      </nav>
      <span className="sm:max-w-xs sm:text-right">{tr("Live map: real nodes, real chain. If a node goes quiet, the map plays a replay until it's back.")}</span>
    </footer>
  );
}
