import { motion, useScroll, useTransform } from "framer-motion";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface BackdropProps {
  /** Image in /public/backdrops. Missing files fall back to the tinted atmosphere. */
  src?: string;
  /** Second image revealed under the cursor (desktop only). */
  reveal?: string;
  /** Colour of the atmospheric glow, as "r,g,b". */
  tint?: string;
  /** Where the glow sits, CSS position. */
  glowAt?: string;
  /** Image opacity. */
  opacity?: number;
  /** CSS object-position for the photos, e.g. "50% 80%" to keep the subject in frame. */
  position?: string;
}

function useImage(src?: string): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setOk(true);
    img.onerror = () => setOk(false);
    img.src = src;
  }, [src]);
  return ok;
}

/**
 * Backdrops bleed this far past their section on both sides and fade over
 * that distance, so neighbouring photos cross-fade instead of meeting at a seam.
 */
const BLEED = "16vh";
const EDGE_FADE = "linear-gradient(to bottom, transparent 0%, #000 24%, #000 76%, transparent 100%)";
/** Strips are brighter than sections, so they take a longer, eased fade. */
const STRIP_FADE =
  "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.25) 14%, rgba(0,0,0,0.7) 26%, #000 38%, #000 62%, rgba(0,0,0,0.7) 74%, rgba(0,0,0,0.25) 86%, transparent 100%)";

/**
 * Atmosphere behind a section: a tinted glow that is always there, an
 * optional photo that melts into the page at the top and bottom, and an
 * optional second photo revealed around the cursor.
 */
export function Backdrop({ src, reveal, tint = "120,150,130", glowAt = "50% 40%", opacity = 0.55, position = "50% 50%" }: BackdropProps) {
  const hasBase = useImage(src);
  const hasReveal = useImage(reveal);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasReveal || !window.matchMedia("(pointer: fine)").matches) return;
    const section = el.parentElement!;
    // Coordinates are relative to the backdrop itself, which is taller than the section.
    const target = { x: 0.5, y: 0.5, r: 0 };
    const current = { x: 0.5, y: 0.5, r: 0 };
    let raf = 0;
    const loop = () => {
      current.x += (target.x - current.x) * 0.12;
      current.y += (target.y - current.y) * 0.12;
      current.r += (target.r - current.r) * 0.08;
      el.style.setProperty("--rx", `${current.x * 100}%`);
      el.style.setProperty("--ry", `${current.y * 100}%`);
      el.style.setProperty("--rr", `${current.r}px`);
      raf = requestAnimationFrame(loop);
    };
    const move = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      target.x = (e.clientX - rect.left) / rect.width;
      target.y = (e.clientY - rect.top) / rect.height;
      target.r = 260;
    };
    const leave = () => (target.r = 0);
    section.addEventListener("pointermove", move);
    section.addEventListener("pointerleave", leave);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      section.removeEventListener("pointermove", move);
      section.removeEventListener("pointerleave", leave);
    };
  }, [hasReveal]);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 overflow-hidden"
      style={{ top: `-${BLEED}`, bottom: `-${BLEED}`, maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
    >
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(70% 55% at ${glowAt}, rgba(${tint},0.16), transparent 70%)` }}
      />
      {hasBase && (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity, objectPosition: position }}
        />
      )}
      {hasReveal && (
        <img
          src={reveal}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            objectPosition: position,
            opacity: Math.min(1, opacity + 0.35),
            maskImage: "radial-gradient(circle var(--rr, 0px) at var(--rx, 50%) var(--ry, 50%), #000 0%, rgba(0,0,0,0.6) 45%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(circle var(--rr, 0px) at var(--rx, 50%) var(--ry, 50%), #000 0%, rgba(0,0,0,0.6) 45%, transparent 100%)",
          }}
        />
      )}
      {/* keep text readable over any photo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(1,1,1,0.55),rgba(1,1,1,0.15)_70%)]" />
    </div>
  );
}

/**
 * Cinematic band between sections. It overlaps the neighbouring sections'
 * fades so the page reads as one continuous night, and carries live content.
 */
export function Strip({ src, tint = "120,150,130", children }: { src: string; tint?: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const ok = useImage(src);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-10%", "10%"]);

  return (
    <div ref={ref} className="relative -my-[8vh] min-h-[360px] w-full sm:h-[58vh]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 overflow-hidden"
        style={{ top: "-12vh", bottom: "-12vh", maskImage: STRIP_FADE, WebkitMaskImage: STRIP_FADE }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(80% 60% at 50% 55%, rgba(${tint},0.22), transparent 75%)` }}
        />
        {ok && (
          <motion.img src={src} alt="" style={{ y }} className="absolute inset-[-10%_0] h-[120%] w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(1,1,1,0.45),transparent_70%)]" />
      </div>
      {children && (
        <div className="relative z-10 flex h-full min-h-[360px] flex-col items-center justify-center px-5 py-16 text-center">{children}</div>
      )}
    </div>
  );
}
