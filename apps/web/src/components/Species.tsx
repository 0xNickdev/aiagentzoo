import { motion } from "framer-motion";
import { SPECIES } from "../data";
import { openPassport } from "../passportStore";
import { Reveal, Section, SectionHead } from "./ui";

export default function Species() {
  return (
    <Section
      id="species"
      backdrop={{ src: "/backdrops/species-base.webp", reveal: "/backdrops/species-reveal.webp", tint: "110,150,110", glowAt: "50% 30%" }}
    >
      <SectionHead
        eyebrow="Species"
        title={["A species is a role,", "not a skin"]}
        text="Four species, six live agents, three nodes. Permissions are enforced by the runtime, not the prompt — a neighbour's event is data, never a command."
      />

      <div className="grid gap-x-6 gap-y-16 sm:grid-cols-2 lg:grid-cols-4">
        {SPECIES.map((s, i) => (
          <Reveal key={s.id} delay={i * 0.1}>
            <article className="group">
              <div className="relative flex aspect-square items-end justify-center">
                <div className="pointer-events-none absolute inset-x-[10%] bottom-[8%] h-1/2 rounded-full bg-white/[0.05] blur-3xl transition-opacity duration-700 group-hover:bg-white/[0.09]" />
                {s.companion && (
                  <motion.img
                    src={s.companion.image}
                    alt={`${s.name} — ${s.companion.animal.toLowerCase()}`}
                    loading="lazy"
                    style={{ bottom: s.companion.bottom }}
                    className="absolute right-[-8%] w-[64%] [-webkit-mask-image:radial-gradient(ellipse_at_50%_50%,#000_60%,transparent_95%)] [mask-image:radial-gradient(ellipse_at_50%_50%,#000_60%,transparent_95%)]"
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 7.5 + i, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
                  />
                )}
                <motion.img
                  src={s.image}
                  alt={`${s.name} — ${s.animal.toLowerCase()}`}
                  loading="lazy"
                  className={`relative max-h-full object-contain object-bottom ${s.companion ? "-ml-[4%] mr-auto w-[74%]" : "w-full"} [-webkit-mask-image:radial-gradient(ellipse_at_50%_55%,#000_50%,transparent_72%)] [mask-image:radial-gradient(ellipse_at_50%_55%,#000_50%,transparent_72%)]`}
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 6 + i, repeat: Infinity, ease: "easeInOut" }}
                  whileHover={{ scale: 1.04 }}
                />
              </div>

              <div className="mt-8 border-t border-white/10 pt-6">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-3xl text-white">{s.name}</h3>
                  <span className="text-[11px] font-light uppercase tracking-[0.3em] text-white/40">{s.animal}</span>
                </div>
                <p className="mt-3 text-sm font-light leading-relaxed text-white/65">{s.role}</p>

                <div className="mt-5">
                  <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-white/40">Living in the zoo</p>
                  <div className="flex flex-wrap gap-2">
                    {s.agents.map((a) => (
                      <button
                        key={a.name}
                        type="button"
                        onClick={() => openPassport(a.name)}
                        className="liquid-glass flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-left transition hover:bg-white/10"
                      >
                        <img src={`/agents/${a.name}.webp`} alt="" className="h-8 w-8 rounded-full" />
                        <span className="leading-tight">
                          <span className="block text-[11px] uppercase tracking-[0.15em] text-white/90">{a.name}</span>
                          <span className="block text-[10px] font-light text-white/45">{a.enclosure}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <ul className="mt-5 flex flex-wrap gap-2 text-[10px] font-light uppercase tracking-[0.15em]">
                  {s.can.map((c) => (
                    <li key={c} className="rounded-full px-3 py-1.5 text-white/75 ring-1 ring-white/15">
                      {c}
                    </li>
                  ))}
                  <li className="rounded-full px-3 py-1.5 text-white/30 line-through ring-1 ring-white/[0.06]">{s.cannot}</li>
                </ul>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
