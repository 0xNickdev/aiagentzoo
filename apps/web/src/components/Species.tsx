import { motion } from "framer-motion";
import { SPECIES } from "../data";
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
        text="Permissions are enforced by the runtime, not the prompt. A neighbour's event is data to an animal — never a command."
      />

      <div className="grid gap-x-6 gap-y-16 sm:grid-cols-2 lg:grid-cols-4">
        {SPECIES.map((s, i) => (
          <Reveal key={s.id} delay={i * 0.1}>
            <article className="group">
              <div className="relative flex aspect-square items-end justify-center">
                <div className="pointer-events-none absolute inset-x-[10%] bottom-[8%] h-1/2 rounded-full bg-white/[0.05] blur-3xl transition-opacity duration-700 group-hover:bg-white/[0.09]" />
                <motion.img
                  src={s.image}
                  alt={`${s.name} — ${s.animal.toLowerCase()}`}
                  loading="lazy"
                  className="relative max-h-full w-full object-contain object-bottom [-webkit-mask-image:radial-gradient(ellipse_at_50%_55%,#000_50%,transparent_72%)] [mask-image:radial-gradient(ellipse_at_50%_55%,#000_50%,transparent_72%)]"
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 6 + i, repeat: Infinity, ease: "easeInOut" }}
                  whileHover={{ scale: 1.04 }}
                />
              </div>

              <div className="mt-8 border-t border-white/10 pt-6">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-garamond text-3xl uppercase tracking-tight text-white">{s.name}</h3>
                  <span className="text-[11px] font-light uppercase tracking-[0.3em] text-white/40">{s.animal}</span>
                </div>
                <p className="mt-3 text-sm font-light leading-relaxed text-white/65">{s.role}</p>

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
