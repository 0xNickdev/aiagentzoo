import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLiveNumbers } from "../LiveStats";
import { Section, SectionHead } from "../ui";
import { MILESTONES } from "./milestones";

// three.js is ~600 kB: it loads only when the roadmap scrolls into view.
const RoadmapScene = lazy(() => import("./RoadmapScene"));

function canRenderWebGL(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** The plain list: shown without WebGL, and always available to screen readers. */
function MilestoneList({ live, className = "" }: { live: ReturnType<typeof useLiveNumbers>; className?: string }) {
  return (
    <ol className={`grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {MILESTONES.map((m, i) => (
        <li key={m.id} className="rounded-2xl bg-black/40 p-5 ring-1 ring-white/10">
          <p className={`font-mono text-[10.5px] ${m.status === "shipped" ? "text-emerald-200/80" : "text-white/45"}`}>
            {String(i + 1).padStart(2, "0")} · {m.status === "shipped" ? "● shipped" : "○ next"} · {m.metric(live)}
          </p>
          <h3 className="font-display mt-2 text-lg">{m.title}</h3>
          <p className="mt-1 text-[13.5px] font-light leading-relaxed text-white/60">{m.text}</p>
        </li>
      ))}
    </ol>
  );
}

/** Spells out the lines drawn in the scene. */
function Relations({ m }: { m: (typeof MILESTONES)[number] }) {
  const name = (id: string) => MILESTONES.find((x) => x.id === id)?.title ?? id;
  const unlocks = MILESTONES.filter((x) => x.links.includes(m.id)).map((x) => x.title);
  return (
    <dl className="font-mono mt-3 grid gap-1 text-[10.5px] leading-relaxed text-white/50">
      {m.links.length > 0 && (
        <div>
          <dt className="inline text-white/35">builds on </dt>
          <dd className="inline text-white/70">{m.links.map(name).join(" · ")}</dd>
        </div>
      )}
      {unlocks.length > 0 && (
        <div>
          <dt className="inline text-white/35">unlocks </dt>
          <dd className="inline text-white/70">{unlocks.join(" · ")}</dd>
        </div>
      )}
    </dl>
  );
}

function MilestoneCard({ id, live }: { id: string; live: ReturnType<typeof useLiveNumbers> }) {
  const i = MILESTONES.findIndex((m) => m.id === id);
  const m = MILESTONES[i]!;
  return (
    <div className="w-full rounded-2xl bg-black/65 p-5 ring-1 ring-white/15 backdrop-blur-md sm:w-[300px]">
      <p className={`font-mono text-[10.5px] ${m.status === "shipped" ? "text-emerald-200/85" : "text-white/50"}`}>
        {String(i + 1).padStart(2, "0")} · {m.status === "shipped" ? "● shipped" : "○ next"}
      </p>
      <p className="font-display mt-2 text-xl text-white">{m.title}</p>
      <p className="mt-2 text-[13px] font-light leading-relaxed text-white/65">{m.text}</p>
      <p className="font-mono mt-4 text-[12.5px] text-white">{m.metric(live)}</p>
      <Relations m={m} />
      {m.proof && (
        <a
          href={m.proof.href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono mt-2 inline-block text-[11px] text-white/55 underline decoration-white/25 underline-offset-4 hover:text-white"
        >
          verify: {m.proof.label} ↗
        </a>
      )}
    </div>
  );
}

export interface Stage {
  /** Top of the interactive stage, in canvas pixels. */
  top: number;
  height: number;
}

/** The canvas bleeds past the section and melts into its neighbours, like the other backdrops. */
const BLEED = "12vh";
const EDGE_FADE = "linear-gradient(to bottom, transparent 0%, #000 14%, #000 86%, transparent 100%)";

export default function Roadmap() {
  const live = useLiveNumbers();
  const [active, setActive] = useState<{ id: string; pinned: boolean } | null>(null);
  const section = useRef<HTMLElement>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
  const stageBox = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [webgl] = useState(canRenderWebGL);
  const [seen, setSeen] = useState(false);
  const [visible, setVisible] = useState(false);
  const portrait = useMedia("(max-aspect-ratio: 1/1)");

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setVisible(!!entry?.isIntersecting);
        if (entry?.isIntersecting) setSeen(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    // Where the stage sits inside the canvas, so the 3D frame lines up with it.
    const measure = () => {
      const c = canvasBox.current?.getBoundingClientRect();
      const s = stageBox.current?.getBoundingClientRect();
      if (c && s) setStage({ top: s.top - c.top, height: s.height });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, [webgl]);

  const shipped = MILESTONES.filter((m) => m.status === "shipped").length;
  const head = (
    <SectionHead
      eyebrow="Roadmap"
      title={["A living network first,", "the token second"]}
      text={`${shipped} of ${MILESTONES.length} milestones are live in production and can be checked against the nodes. Hover a sphere to see what it builds on and what it unlocks.`}
    />
  );

  if (!webgl) {
    return (
      <Section id="roadmap" backdrop={{ src: "/backdrops/roadmap.webp", tint: "120,145,175", glowAt: "50% 70%" }}>
        {head}
        <MilestoneList live={live} />
      </Section>
    );
  }

  return (
    <section ref={section} id="roadmap" className="relative px-5 py-20 sm:px-8 sm:py-24 md:py-28">
      <div
        ref={canvasBox}
        className="absolute inset-x-0"
        style={{ top: `-${BLEED}`, bottom: `-${BLEED}`, maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
      >
        {seen && stage && (
          <Suspense fallback={null}>
            <RoadmapScene live={live} running={visible} portrait={portrait} stage={stage} onActive={setActive} />
          </Suspense>
        )}
      </div>
      <div className="pointer-events-none relative z-10 mx-auto max-w-7xl">
        {head}
        <div ref={stageBox} className="relative h-[760px] md:h-[600px]">
          <div
            className={`absolute right-0 top-0 transition-all duration-300 max-sm:bottom-10 max-sm:left-0 max-sm:top-auto ${
              active ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            } ${active?.pinned ? "pointer-events-auto" : ""}`}
          >
            {active && <MilestoneCard id={active.id} live={live} />}
          </div>
          <div className="font-mono absolute bottom-3 left-0 flex gap-5 text-[10.5px] text-white/45">
            <span>● shipped</span>
            <span>○ next</span>
            <span className="hidden sm:inline">hover · click to pin</span>
          </div>
        </div>
      </div>
      <MilestoneList live={live} className="sr-only" />
    </section>
  );
}
