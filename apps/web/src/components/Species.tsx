import { motion } from "framer-motion";
import { SPECIES } from "../data";
import { openPassport } from "../passportStore";
import { Reveal, Section, SectionHead } from "./ui";
import { t } from "../i18n";

export default function Species() {
  return (
    <Section
      id="species"
      backdrop={{ src: "/backdrops/species-base.webp", reveal: "/backdrops/species-reveal.webp", tint: "110,150,110", glowAt: "50% 30%" }}
    >
      <SectionHead
        eyebrow={t("Species")}
        title={[t("A species is a role,"), t("not a skin")]}
        text={t("Five species, eight live agents, three nodes. Permissions are enforced by the runtime, not the prompt - a neighbour's event is data, never a command.")}
      />

      <div className="grid gap-x-6 gap-y-16 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {SPECIES.map((s, i) => (
          <Reveal key={s.id} delay={i * 0.1} className="h-full">
            <article className="group flex h-full flex-col">
              <div className="relative flex aspect-square items-end justify-center">
                <div className="pointer-events-none absolute inset-x-[10%] bottom-[8%] h-1/2 rounded-full bg-white/[0.05] blur-3xl transition-opacity duration-700 group-hover:bg-white/[0.09]" />
                {s.companion && (
                  <motion.img
                    src={s.companion.image}
                    alt={`${s.name} - ${s.companion.animal.toLowerCase()}`}
                    loading="lazy"
                    style={{ bottom: s.companion.bottom }}
                    className="absolute right-[-8%] w-[64%] [-webkit-mask-image:radial-gradient(ellipse_at_50%_50%,#000_60%,transparent_95%)] [mask-image:radial-gradient(ellipse_at_50%_50%,#000_60%,transparent_95%)]"
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 7.5 + i, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
                  />
                )}
                <motion.img
                  src={s.image}
                  alt={`${s.name} - ${s.animal.toLowerCase()}`}
                  loading="lazy"
                  className={`relative max-h-full object-contain object-bottom ${s.companion ? "-ml-[4%] mr-auto w-[74%]" : "w-full"} [-webkit-mask-image:radial-gradient(ellipse_at_50%_55%,#000_50%,transparent_72%)] [mask-image:radial-gradient(ellipse_at_50%_55%,#000_50%,transparent_72%)]`}
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 6 + i, repeat: Infinity, ease: "easeInOut" }}
                  whileHover={{ scale: 1.04 }}
                />
              </div>

              <div className="mt-8 flex-1 rounded-2xl border-t border-white/15 bg-[#030504]/45 px-4 pb-5 pt-6 backdrop-blur-[3px] [text-shadow:0_1px_10px_rgba(0,0,0,0.85)]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="font-display text-3xl text-white">{t(s.name)}</h3>
                  <span className="whitespace-nowrap text-[12.5px] font-light uppercase tracking-[0.3em] text-fg-3">{t(s.animal)}</span>
                </div>
                <p className="mt-3 text-sm font-light leading-relaxed text-fg-2">{t(s.role)}</p>

                <div className="mt-5">
                  <p className="mb-2 text-[11.5px] font-normal uppercase tracking-[0.25em] text-fg-4">{t("Living in the zoo")}</p>
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
                          <span className="block text-[12.5px] uppercase tracking-[0.15em] text-fg">{t(a.name)}</span>
                          <span className="block text-[11.5px] font-light text-fg-3">{t(a.enclosure)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <ul className="mt-5 flex flex-wrap gap-2 text-[11.5px] font-normal uppercase tracking-[0.15em]">
                  {s.can.map((c) => (
                    <li key={c} className="rounded-full bg-black/25 px-3 py-1.5 text-fg ring-1 ring-white/25">
                      {t(c)}
                    </li>
                  ))}
                  <li className="rounded-full px-3 py-1.5 text-fg-3 line-through ring-1 ring-white/10" title={t("Not allowed for this species")}>{t(s.cannot)}</li>
                </ul>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
