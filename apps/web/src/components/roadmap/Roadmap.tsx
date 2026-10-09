import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLiveNumbers } from "../LiveStats";
import { Reveal, Section, SectionHead } from "../ui";
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

export default function Roadmap() {
  const live = useLiveNumbers();
  const [active, setActive] = useState<{ id: string; pinned: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [webgl] = useState(canRenderWebGL);
  const [seen, setSeen] = useState(false);
  const [visible, setVisible] = useState(false);
  const portrait = useMedia("(max-aspect-ratio: 1/1)");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setVisible(!!entry?.isIntersecting);
        if (entry?.isIntersecting) setSeen(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const shipped = MILESTONES.filter((m) => m.status === "shipped").length;

  return (
    <Section id="roadmap" backdrop={{ src: "/backdrops/roadmap.webp", tint: "120,145,175", glowAt: "50% 70%" }}>
      <SectionHead
        eyebrow="Roadmap"
        title={["A living network first,", "the token second"]}
        text={`${shipped} of ${MILESTONES.length} milestones are live in production and can be checked against the nodes. Hover a sphere to see what it builds on.`}
      />
      {webgl ? (
        <Reveal>
          <div ref={box} className="relative -mx-5 h-[760px] sm:-mx-8 md:h-[600px]">
            {seen && (
              <Suspense fallback={null}>
                <RoadmapScene live={live} running={visible} portrait={portrait} onActive={setActive} />
              </Suspense>
            )}
            <div
              className={`absolute right-5 top-0 transition-all duration-300 sm:right-8 max-sm:left-5 max-sm:top-auto max-sm:bottom-10 ${
                active ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
              } ${active?.pinned ? "" : "pointer-events-none"}`}
            >
              {active && <MilestoneCard id={active.id} live={live} />}
            </div>
            <div className="font-mono pointer-events-none absolute bottom-3 left-5 flex gap-5 text-[10.5px] text-white/45 sm:left-8">
              <span>● shipped</span>
              <span>○ next</span>
              <span className="hidden sm:inline">hover · click to pin</span>
            </div>
          </div>
          <MilestoneList live={live} className="sr-only" />
        </Reveal>
      ) : (
        <MilestoneList live={live} />
      )}
    </Section>
  );
}
