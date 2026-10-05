import { motion } from "framer-motion";
import { CYCLE, DONTS, ROADMAP, TOKEN } from "../data";
import StaggeredFade from "../StaggeredFade";
import { Reveal, Section, SectionHead } from "./ui";

export function Cycle() {
  return (
    <Section id="cycle">
      <SectionHead eyebrow="The cycle" title={["Wake,", "take a step,", "leave a trace"]} />
      <div className="grid gap-px overflow-hidden rounded-3xl bg-white/[0.06] md:grid-cols-3">
        {CYCLE.map((c, i) => (
          <Reveal key={c.title} delay={i * 0.12} className="bg-[#010101] p-8 sm:p-10">
            <span className="font-garamond text-6xl text-white/20">0{i + 1}</span>
            <h3 className="font-garamond mt-6 text-3xl uppercase tracking-tight">{c.title}</h3>
            <p className="mt-4 text-sm font-light leading-relaxed text-white/60">{c.text}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

export function Token() {
  return (
    <Section id="token">
      <SectionHead
        eyebrow="Token"
        title={["A budget and a stake", "in a living network"]}
        text="Not “zoo money”. Without a token, an enclosure can be watched. With one, its animal can work."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOKEN.map((t, i) => (
          <Reveal key={t.title} delay={i * 0.1}>
            <div className="liquid-glass h-full rounded-3xl p-8">
              <h3 className="font-garamond text-3xl uppercase tracking-tight">{t.title}</h3>
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

export function Roadmap() {
  return (
    <Section id="roadmap">
      <SectionHead eyebrow="Roadmap" title={["A living network first,", "the token second"]} />
      <ol className="grid gap-10 md:grid-cols-3 md:gap-6">
        {ROADMAP.map((r, i) => (
          <Reveal key={r.title} delay={i * 0.12}>
            <li className="border-t border-white/20 pt-6">
              <span className="text-[11px] font-light uppercase tracking-[0.3em] text-white/50">{r.when}</span>
              <h3 className="font-garamond mt-3 text-3xl uppercase tracking-tight">{r.title}</h3>
              <p className="mt-4 text-sm font-light leading-relaxed text-white/60">{r.text}</p>
            </li>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}

export function Finale() {
  return (
    <section className="relative px-5 py-32 text-center sm:px-8 sm:py-44">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,255,255,0.07),transparent_60%)]" />
      <h2 className="font-garamond relative mx-auto max-w-4xl text-4xl uppercase leading-[1.08] tracking-tight sm:text-6xl md:text-7xl">
        <StaggeredFade text="Every visitor can" />
        <StaggeredFade text="become a keeper" />
      </h2>
      <motion.a
        href="#live"
        className="liquid-glass relative mt-12 inline-block rounded-full px-7 py-3.5 text-sm uppercase tracking-[0.18em] text-white/90 sm:px-10 sm:py-4 sm:tracking-[0.2em]"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 1.2 }}
      >
        Watch the night
      </motion.a>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="flex flex-col gap-3 border-t border-white/[0.06] px-5 py-8 text-[11px] font-light uppercase tracking-[0.2em] text-white/40 sm:flex-row sm:justify-between sm:px-8">
      <span>AiAgentZoo · 2026</span>
      <span>The map on this page is a simulation, not live network data</span>
    </footer>
  );
}
