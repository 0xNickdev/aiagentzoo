import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LiveNumbers, useLiveNumbers } from "../LiveStats";
import { SectionHead } from "../ui";
import { type Milestone, MILESTONES } from "./milestones";
import { SPOTS, VIDEO_SIZE } from "./spots";

const VIDEO_DESKTOP = "/video/roadmap-1600.mp4";
const VIDEO_MOBILE = "/video/roadmap-960.mp4";
const POSTER = "/video/roadmap-poster.webp";
/** Horizontal focus of the crop on narrow screens: the path sits a little left of centre. */
const FOCUS_X = 0.36;
const EDGE_FADE = "linear-gradient(to bottom, transparent 0%, #000 12%, #000 86%, transparent 100%)";

type Live = LiveNumbers | null;

/** The plain list, for screen readers and when the video cannot play. */
function MilestoneList({ live, className = "" }: { live: Live; className?: string }) {
  return (
    <ol className={`grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {MILESTONES.map((m, i) => (
        <li key={m.id} className="rounded-2xl bg-black/40 p-5 ring-1 ring-white/10">
          <p className={`font-mono text-[10.5px] ${m.status === "shipped" ? "text-amber-100/80" : "text-white/45"}`}>
            {String(i + 1).padStart(2, "0")} · {m.status === "shipped" ? "● shipped" : "○ next"} · {m.metric(live)}
          </p>
          <h3 className="font-display mt-2 text-lg">{m.title}</h3>
          <p className="mt-1 text-[13.5px] font-light leading-relaxed text-white/60">{m.text}</p>
        </li>
      ))}
    </ol>
  );
}

function Relations({ m }: { m: Milestone }) {
  const name = (id: string) => MILESTONES.find((x) => x.id === id)?.title ?? id;
  const unlocks = MILESTONES.filter((x) => x.links.includes(m.id)).map((x) => x.title);
  return (
    <dl className="font-mono mt-3 grid gap-1 text-[10.5px] leading-relaxed text-white/50">
      {m.links.length > 0 && (
        <div>
          <dt className="inline text-white/35">builds on </dt>
          <dd className="inline text-white/75">{m.links.map(name).join(" · ")}</dd>
        </div>
      )}
      {unlocks.length > 0 && (
        <div>
          <dt className="inline text-white/35">unlocks </dt>
          <dd className="inline text-white/75">{unlocks.join(" · ")}</dd>
        </div>
      )}
    </dl>
  );
}

/** Characters roll before a reading settles, like an instrument. */
function Scramble({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const glyphs = "0123456789#%+/·";
    const total = 14;
    let frame = 0;
    const id = setInterval(() => {
      frame += 1;
      const settled = Math.floor((frame / total) * text.length);
      setShown(
        text
          .split("")
          .map((c, i) => (i < settled || c === " " ? c : glyphs[Math.floor(Math.random() * glyphs.length)]))
          .join(""),
      );
      if (frame >= total) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, [text]);
  return <>{shown}</>;
}

/** How the video frame maps onto the stage under object-fit: cover. */
interface Cover {
  scale: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

function useCover(stage: RefObject<HTMLDivElement | null>, focusX: number): Cover | null {
  const [cover, setCover] = useState<Cover | null>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const scale = Math.max(width / VIDEO_SIZE.w, height / VIDEO_SIZE.h);
      setCover({
        scale,
        ox: (width - VIDEO_SIZE.w * scale) * focusX,
        oy: (height - VIDEO_SIZE.h * scale) * 0.5,
        width,
        height,
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [stage, focusX]);
  return cover;
}

/**
 * A card that refracts the video behind it: a canvas redraws the visible
 * frame under the card each animation frame, and an SVG displacement filter
 * bends it with per-channel offsets for the rainbow edge.
 */
function GlassCard({
  video,
  stage,
  cover,
  children,
  className = "",
}: {
  video: RefObject<HTMLVideoElement | null>;
  stage: RefObject<HTMLDivElement | null>;
  cover: Cover;
  children: ReactNode;
  className?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = video.current;
      const c = canvas.current;
      const k = card.current;
      const s = stage.current;
      if (!v || !c || !k || !s || !v.videoWidth) return;
      const sr = s.getBoundingClientRect();
      const kr = k.getBoundingClientRect();
      // The canvas spans the whole stage, shifted so its pixels line up with the video behind the card.
      c.style.left = `${sr.left - kr.left}px`;
      c.style.top = `${sr.top - kr.top}px`;
      if (c.width !== Math.round(sr.width) || c.height !== Math.round(sr.height)) {
        c.width = Math.round(sr.width);
        c.height = Math.round(sr.height);
        c.style.width = `${sr.width}px`;
        c.style.height = `${sr.height}px`;
      }
      const ctx = c.getContext("2d");
      try {
        ctx?.drawImage(v, cover.ox, cover.oy, VIDEO_SIZE.w * cover.scale, VIDEO_SIZE.h * cover.scale);
      } catch {
        // Frame not decodable yet.
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [video, stage, cover]);

  return (
    <div ref={card} className={`relative overflow-hidden rounded-[28px] ${className}`}>
      <canvas ref={canvas} aria-hidden className="pointer-events-none absolute" style={{ filter: "url(#roadmap-glass)" }} />
      {/* Frost and a lit rim on top of the refraction, text above both. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[28px] bg-[rgba(8,12,14,0.42)]"
        style={{ boxShadow: "inset 0 1.5px 2px rgba(255,255,255,0.28), inset 0 -1px 2px rgba(0,0,0,0.3)" }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

function GlassFilter() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        <filter id="roadmap-glass" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.015" numOctaves="3" result="noise" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 100 0" result="alpha" />
          <feGaussianBlur in="alpha" stdDeviation="40" result="blurred" />
          <feComponentTransfer in="blurred" result="edge">
            <feFuncA type="linear" slope="-1.3" intercept="1" />
          </feComponentTransfer>
          <feComposite in="noise" in2="edge" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="bevel" />
          <feDisplacementMap in="SourceGraphic" in2="bevel" scale="60" xChannelSelector="R" yChannelSelector="G" result="rd" />
          <feColorMatrix in="rd" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feDisplacementMap in="SourceGraphic" in2="bevel" scale="52" xChannelSelector="R" yChannelSelector="G" result="gd" />
          <feColorMatrix in="gd" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feDisplacementMap in="SourceGraphic" in2="bevel" scale="44" xChannelSelector="R" yChannelSelector="G" result="bd" />
          <feColorMatrix in="bd" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feBlend in="r" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="b" mode="screen" />
        </filter>
      </defs>
    </svg>
  );
}

function MilestoneCard({ m, index, live }: { m: Milestone; index: number; live: Live }) {
  return (
    <div className="p-5">
      <p className={`font-mono text-[10.5px] ${m.status === "shipped" ? "text-amber-100/85" : "text-white/50"}`}>
        {String(index + 1).padStart(2, "0")} · {m.status === "shipped" ? "● shipped" : "○ next"}
      </p>
      <p className="font-display mt-2 text-xl text-white">{m.title}</p>
      <p className="mt-2 text-[13px] font-light leading-relaxed text-white/70">{m.text}</p>
      <p className="font-mono mt-4 text-[12.5px] text-white">
        <Scramble text={m.metric(live)} />
      </p>
      <Relations m={m} />
      {m.proof && (
        <a
          href={m.proof.href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono mt-3 inline-block text-[11px] text-white/60 underline decoration-white/25 underline-offset-4 hover:text-white"
        >
          verify: {m.proof.label} ↗
        </a>
      )}
    </div>
  );
}

export default function Roadmap() {
  const live = useLiveNumbers();
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const narrow = useMemo(() => window.matchMedia("(max-width: 767px)").matches, []);
  const cover = useCover(stage, narrow ? FOCUS_X : 0.5);
  const active = hovered ?? pinned;
  const activeIndex = active ? MILESTONES.findIndex((m) => m.id === active) : -1;
  const activeM = activeIndex >= 0 ? MILESTONES[activeIndex]! : null;

  // The video loads only as the roadmap approaches, and pauses when it leaves.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const v = video.current;
        if (entry?.isIntersecting) {
          setNear(true);
          if (v && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) void v.play().catch(() => undefined);
        } else v?.pause();
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const related = useMemo(() => {
    if (!activeM) return new Set<string>();
    return new Set([...activeM.links, ...MILESTONES.filter((m) => m.links.includes(activeM.id)).map((m) => m.id)]);
  }, [activeM]);

  const at = useCallback(
    (id: string) => {
      const s = SPOTS[id]!;
      if (!cover) return { x: 0, y: 0, r: 0 };
      return {
        x: cover.ox + (s.x / 100) * VIDEO_SIZE.w * cover.scale,
        y: cover.oy + (s.y / 100) * VIDEO_SIZE.h * cover.scale,
        r: (s.r / 100) * VIDEO_SIZE.w * cover.scale,
      };
    },
    [cover],
  );
  /** Crosshairs sit just above and right of each sphere, like a survey mark. */
  const mark = (id: string) => {
    const p = at(id);
    return { x: p.x + p.r * 0.75, y: p.y - p.r * 0.95 };
  };

  const shipped = MILESTONES.filter((m) => m.status === "shipped").length;

  return (
    <section ref={section} id="roadmap" className="relative py-20 sm:py-24 md:py-28">
      <GlassFilter />
      <div className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead
          eyebrow="Roadmap"
          title={["A living network first,", "the token second"]}
          text={`${shipped} of ${MILESTONES.length} milestones are live in production and can be checked against the nodes. Each glowing sphere is one of them; hover one to see what it builds on and what it unlocks.`}
        />
      </div>

      <div
        ref={stage}
        className="relative -mt-6 h-[112vw] w-full overflow-hidden md:h-[min(56.5vw,92vh)]"
        onClick={(e) => {
          if (e.target === e.currentTarget) setPinned(null);
        }}
      >
        <div className="pointer-events-none absolute inset-0" style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}>
          <video
            ref={video}
            className="h-full w-full object-cover"
            style={{ objectPosition: `${(narrow ? FOCUS_X : 0.5) * 100}% 50%` }}
            poster={POSTER}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden
            src={near ? (narrow ? VIDEO_MOBILE : VIDEO_DESKTOP) : undefined}
          />
        </div>

        {cover && (
          <>
            {/* Links to everything the active milestone builds on or unlocks. */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              {activeM &&
                [...related].map((id) => {
                  const a = mark(activeM.id);
                  const b = mark(id);
                  const len = Math.hypot(b.x - a.x, b.y - a.y);
                  return (
                    <line
                      key={`${activeM.id}-${id}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="rgba(255,246,230,0.75)"
                      strokeWidth={1}
                      strokeDasharray={len}
                      strokeDashoffset={len}
                      style={{ animation: "roadmap-draw 520ms cubic-bezier(.16,1,.3,1) forwards" }}
                    />
                  );
                })}
            </svg>

            {MILESTONES.map((m, i) => {
              const p = at(m.id);
              const k = mark(m.id);
              const isActive = active === m.id;
              const dim = !!activeM && !isActive && !related.has(m.id);
              const hit = Math.max(p.r * 1.35, 18);
              return (
                <div key={m.id}>
                  {/* Glow ring on the active sphere. */}
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute rounded-full transition-all duration-500 ${isActive ? "opacity-100" : "opacity-0"}`}
                    style={{
                      left: p.x - p.r * 1.3,
                      top: p.y - p.r * 1.3,
                      width: p.r * 2.6,
                      height: p.r * 2.6,
                      boxShadow: `0 0 0 1px rgba(255,240,215,0.55), 0 0 ${p.r * 1.2}px ${p.r * 0.3}px rgba(255,200,120,0.35)`,
                    }}
                  />
                  {/* Survey mark and index. */}
                  <span
                    aria-hidden
                    className={`font-mono pointer-events-none absolute flex items-center gap-1.5 text-[10.5px] text-white transition-opacity duration-300 ${
                      dim ? "opacity-15" : isActive ? "opacity-100" : "opacity-60"
                    }`}
                    style={{ left: k.x - 5, top: k.y - 5 }}
                  >
                    <span className="relative block h-[10px] w-[10px]">
                      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/80" />
                      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/80" />
                    </span>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {/* Reading next to a linked milestone. */}
                  {related.has(m.id) && (
                    <span
                      className="font-mono pointer-events-none absolute whitespace-nowrap text-[11px] leading-tight text-white/90"
                      style={{ left: k.x + 30, top: k.y - 6 }}
                    >
                      <Scramble text={m.metric(live)} />
                      <span className="block text-[10px] text-white/50">{m.title}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`${String(i + 1).padStart(2, "0")} ${m.title}`}
                    className="absolute rounded-full focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/70"
                    style={{ left: p.x - hit, top: p.y - hit, width: hit * 2, height: hit * 2 }}
                    onMouseEnter={() => setHovered(m.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(m.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() => setPinned((s) => (s === m.id ? null : m.id))}
                  />
                </div>
              );
            })}

            {activeM && (
              <div className="pointer-events-none absolute bottom-6 left-4 right-4 sm:left-auto sm:right-8 sm:top-8 sm:bottom-auto sm:w-[320px]">
                <GlassCard video={video} stage={stage} cover={cover} className={pinned === activeM.id && !hovered ? "pointer-events-auto" : ""}>
                  <MilestoneCard m={activeM} index={activeIndex} live={live} />
                </GlassCard>
              </div>
            )}
          </>
        )}

        <div className="font-mono pointer-events-none absolute bottom-4 left-5 flex gap-5 text-[10.5px] text-white/50 sm:left-8">
          <span>● shipped</span>
          <span>○ next</span>
          <span className="hidden sm:inline">hover · click to pin</span>
        </div>
      </div>

      <MilestoneList live={live} className="sr-only" />
    </section>
  );
}
