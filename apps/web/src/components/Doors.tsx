import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { nodeOf } from "../zoo";

interface Numbers {
  launchesSeen: number | null;
  chainLive: boolean;
  tokensTonight: number | null;
  callsTonight: number | null;
  accuracy: number | null;
  turn: number | null;
  alive: number | null;
  fallen: number | null;
  nextTurnIn: number | null;
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n.toLocaleString("en-US"));

/** The numbers each door shows, read live from the nodes; any that fail stay as dashes. */
function useDoorNumbers(): Numbers | null {
  const [n, setN] = useState<Numbers | null>(null);
  useEffect(() => {
    let live = true;
    const get = async (url: string) => {
      try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    };
    const load = async () => {
      const [canyon, north] = await Promise.all([nodeOf("beaver").catch(() => undefined), nodeOf("raven").catch(() => undefined)]);
      const [stats, chain, evo] = await Promise.all([
        canyon ? get(`${canyon.url}/v1/stats`) : null,
        north ? get(`${north.url}/v1/chain`) : null,
        canyon ? get(`${canyon.url}/v1/evolution`) : null,
      ]);
      if (!live) return;
      const creatures = (evo?.creatures ?? []) as Array<{ diedNight: string | null }>;
      setN({
        launchesSeen: chain?.seen?.launches ?? null,
        chainLive: Boolean(chain?.live),
        tokensTonight: stats?.tokensTonight ?? null,
        callsTonight: stats?.callsTonight ?? null,
        accuracy: stats?.accuracy ?? null,
        turn: evo?.generation ?? null,
        alive: evo ? creatures.filter((c) => !c.diedNight).length : null,
        fallen: evo ? creatures.filter((c) => c.diedNight).length : null,
        nextTurnIn: evo?.nextGenerationInNights ?? null,
      });
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return n;
}

interface Door {
  href: string;
  eyebrow: string;
  title: string;
  line: string;
  image: string;
  /** Where the subject sits, so the crop keeps it above the copy. */
  focus: string;
  stats: Array<[string, string]>;
  cta: string;
  live?: boolean;
}

export default function Doors() {
  const n = useDoorNumbers();
  const doors: Door[] = [
    {
      href: "/live",
      eyebrow: "LIVE",
      title: "The Night Watch",
      line: "Three nodes, six agents and the chain itself, as it happens.",
      image: "/doors/live.webp",
      focus: "50% 24%",
      live: n?.chainLive,
      stats: [
        ["launches read from the chain", fmt(n?.launchesSeen)],
        ["tokens watched tonight", fmt(n?.tokensTonight)],
      ],
      cta: "Watch live",
    },
    {
      href: "/brief",
      eyebrow: "MORNING BRIEF",
      title: "What they found",
      line: "Every morning at 07:00 UTC: launches, rugs, graduations and the pack's calls, signed.",
      image: "/doors/brief.webp",
      focus: "50% 64%",
      stats: [
        ["calls made tonight", fmt(n?.callsTonight)],
        ["right when re-checked", n?.accuracy === null || n?.accuracy === undefined ? "-" : `${Math.round(n.accuracy * 100)}%`],
      ],
      cta: "Read today's brief",
    },
    {
      href: "/evolution",
      eyebrow: "THE NURSERY",
      title: "Who survives",
      line: "Eight judges that never learn. Every three nights the weakest dies and the best breed.",
      image: "/doors/nursery.webp",
      focus: "50% 64%",
      stats: [
        ["alive · fallen", n?.alive === null || n?.alive === undefined ? "-" : `${n.alive} · ${n.fallen}`],
        ["next turn", n?.nextTurnIn === null || n?.nextTurnIn === undefined ? "-" : n.nextTurnIn === 0 ? "tonight" : `in ${n.nextTurnIn} night${n.nextTurnIn === 1 ? "" : "s"}`],
      ],
      cta: "Enter the nursery",
    },
  ];

  return (
    <section className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-wrap items-end justify-between gap-6"
      >
        <div>
          <p className="font-mono text-[11px] tracking-[0.18em] text-white/45">THREE WAYS IN</p>
          <h2 className="font-display mt-3 text-5xl sm:text-6xl">See it work</h2>
        </div>
        <p className="max-w-sm text-[14px] font-light leading-relaxed text-white/55">
          Everything below is live: read from the nodes and the chain as you look at it.
        </p>
      </motion.div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {doors.map((d, i) => (
          <motion.a
            key={d.href}
            href={d.href}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.9, delay: 0.08 * i, ease: [0.22, 1, 0.36, 1] }}
            className="group relative flex flex-col overflow-hidden rounded-3xl bg-[#050706] ring-1 ring-white/10 transition hover:ring-white/25"
          >
            <div className="relative h-[300px] overflow-hidden sm:h-[360px]">
              <img
                src={d.image}
                alt=""
                loading="lazy"
                style={{ objectPosition: d.focus }}
                className="absolute inset-0 h-full w-full object-cover opacity-85 transition duration-[1.2s] ease-out group-hover:scale-[1.05] group-hover:opacity-100"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,4,0.55)_0%,rgba(3,5,4,0)_28%,rgba(3,5,4,0)_70%,#050706_100%)]" />
              <p className="font-mono absolute left-7 top-6 flex items-center gap-2 text-[10.5px] tracking-[0.18em] text-white/75">
                {d.live !== undefined && (
                  <span className={`h-1.5 w-1.5 rounded-full ${d.live ? "animate-pulse bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]" : "bg-white/30"}`} />
                )}
                {d.eyebrow}
              </p>
            </div>
            <div className="relative flex flex-1 flex-col px-7 pb-7 pt-2">
              <h3 className="font-display text-4xl">{d.title}</h3>
              <p className="mt-3 max-w-xs text-[14px] font-light leading-relaxed text-white/60">{d.line}</p>
              <dl className="font-mono mt-auto grid grid-cols-2 gap-4 border-t border-white/10 pt-5">
                {d.stats.map(([k, v]) => (
                  <div key={k}>
                    <dd className="text-xl text-white">{v}</dd>
                    <dt className="mt-1 text-[10px] tracking-[0.06em] text-white/45">{k}</dt>
                  </div>
                ))}
              </dl>
              <span className="mt-6 inline-flex items-center gap-2 text-[13.5px] text-white/80 transition group-hover:gap-3 group-hover:text-white">
                {d.cta} <ArrowRight size={14} />
              </span>
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
