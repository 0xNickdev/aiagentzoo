import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { lang, t } from "../../i18n";

interface Entry {
  id: string;
  chapter: string;
  status: string;
  title: string;
  zh?: { title?: string };
}
interface Chapter {
  id: string;
  label: string;
  zh?: { label?: string };
}

/** The home page's door to /roadmap: one screen, what is shipped, the next three steps, and the way in. */
export default function RoadmapTeaser() {
  const [plan, setPlan] = useState<{ chapters: Chapter[]; items: Entry[]; buried: unknown[] } | null>(null);
  useEffect(() => {
    fetch("/roadmap.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => p && setPlan(p))
      .catch(() => {});
  }, []);
  const zh = lang() === "zh";
  const shipped = plan?.items.filter((i) => i.status === "shipped").length;
  const next = plan?.items.filter((i) => i.status === "building" || i.status === "next").slice(0, 3) ?? [];
  const month = (id: string) => {
    const c = plan?.chapters.find((x) => x.id === id);
    return (zh && c?.zh?.label) || c?.label || "";
  };

  return (
    <section id="roadmap" className="relative flex min-h-[100svh] items-end overflow-hidden px-5 pb-20 pt-32 sm:px-8">
      <img src="/backdrops/roadmap-trail.webp" alt="" aria-hidden loading="lazy" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "58% 50%" }} />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#030504]/90 via-[#030504]/55 to-[#030504]/25" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#030504] via-transparent to-[#030504]" />
      <div className="relative mx-auto w-full max-w-7xl">
        <p className="font-mono text-[12.5px] uppercase tracking-[0.22em] text-white/55">{t("Roadmap · Oct - Dec 2026")}</p>
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1 }}
          className="font-display mt-4 max-w-3xl text-5xl leading-[1.02] text-white sm:text-7xl"
        >
          {t("The trail.")} <span className="accent">{t("Walked, and ahead.")}</span>
        </motion.h2>
        <p className="mt-5 max-w-lg text-[15px] font-light leading-relaxed text-white/65">
          {shipped != null ? t("{n} things shipped since October 6, each with the commit that proves it. Here is what comes next.", { n: shipped }) : t("Everything we shipped, with the commit that proves it. Everything next, and the part holders decide. Everything we buried, and why.")}
        </p>
        <div className="mt-10 grid max-w-4xl sm:grid-cols-3">
          {next.map((it) => (
            <div key={it.id} className="border-t border-white/[0.14] py-5 pr-6">
              <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-white/60">
                <span className={it.status === "building" ? "text-amber-100/85" : ""}>{it.status === "building" ? "◐" : "○"}</span> {month(it.chapter)}
              </p>
              <p className="mt-2 text-[17px] text-white">{(zh && it.zh?.title) || it.title}</p>
            </div>
          ))}
        </div>
        <a href="/roadmap" className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[14px] font-medium text-black transition hover:bg-white/90">
          {t("Open the roadmap")} <ArrowRight size={15} />
        </a>
      </div>
    </section>
  );
}
