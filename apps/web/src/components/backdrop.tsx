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

const EDGE_FADE = "linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)";

/**
 * Atmosphere behind a section: a tinted glow that is always there, an
 * optional photo that melts into the page at the top and bottom, and an
 * optional second photo revealed around the cursor.
 */
export function Backdrop({ src, reveal, tint = "120,150,130", glowAt = "50% 40%", opacity = 0.55 }: BackdropProps) {
  const hasBase = useImage(src);
  const hasReveal = useImage(reveal);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasReveal || !window.matchMedia("(pointer: fine)").matches) return;
    const section = el.parentElement!;
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
      const rect = section.getBoundingClientRect();
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
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(70% 55% at ${glowAt}, rgba(${tint},0.16), transparent 70%)` }}
      />
      {hasBase && (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity, maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
        />
      )}
      {hasReveal && (
        <img
          src={reveal}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{
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
 * Full-bleed cinematic band between sections, with a slow parallax and
 * an optional line of copy over it.
 */
export function Strip({ src, tint = "120,150,130", children }: { src: string; tint?: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const ok = useImage(src);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-12%", "12%"]);

  return (
    <div ref={ref} className="relative h-[55vh] min-h-[340px] w-full overflow-hidden sm:h-[70vh]">
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(80% 60% at 50% 55%, rgba(${tint},0.22), transparent 75%)` }}
      />
      {ok && (
        <motion.img
          src={src}
          alt=""
          aria-hidden
          style={{ y, maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
          className="absolute inset-[-12%_0] h-[124%] w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-[#010101] via-transparent to-[#010101]" />
      {children && (
        <div className="relative z-10 flex h-full items-center justify-center px-5 text-center">{children}</div>
      )}
    </div>
  );
}
