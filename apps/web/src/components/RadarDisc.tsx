import { useEffect, useRef } from "react";

export interface Blip {
  mint: string;
  symbol: string;
  at: number;
  tier: "strong" | "watch";
}

/** 4x4 Bayer matrix, thresholds 0..15. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SWEEP_MS = 6_000;
const DECAY_MS = 650;
/** The disc's edge is this old: a signal two hours old sits on the rim. */
const SPAN_MS = 2 * 3_600_000;

const angleOf = (mint: string) => {
  let h = 0;
  for (let i = 0; i < mint.length; i++) h = (h * 31 + mint.charCodeAt(i)) >>> 0;
  return ((h % 3600) / 3600) * Math.PI * 2;
};

/**
 * The page's hero: a radar disc drawn as ordered dither in one ink on the background. A sweep turns once every six
 * seconds; what it passes resolves finer, then coarsens again. Each live signal is a blip: nearer the centre the
 * fresher it is, strong a solid square, watch an outline. Still when the reader asks for less motion.
 */
export default function RadarDisc({ blips, active, onActive }: { blips: Blip[]; active: string | null; onActive: (mint: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ blips, active });
  state.current = { blips, active };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const draw = (t: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = canvas.clientWidth;
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }
      const ink = getComputedStyle(canvas).color || "#fff";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = ink;
      const c = size / 2;
      const R = c - 2;
      const sweep = still ? -Math.PI / 4 : ((t % SWEEP_MS) / SWEEP_MS) * Math.PI * 2 - Math.PI / 2;
      // Dithered field: brightness falls off from the sweep line behind it, plus faint rings.
      for (let y = 0; y < size; y += 2) {
        for (let x = 0; x < size; x += 2) {
          const dx = x - c, dy = y - c;
          const r = Math.hypot(dx, dy);
          if (r > R) continue;
          let behind = sweep - Math.atan2(dy, dx);
          behind = ((behind % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          const trailMs = (behind / (Math.PI * 2)) * SWEEP_MS;
          const glow = trailMs < DECAY_MS ? 1 - trailMs / DECAY_MS : 0;
          const ring = Math.abs(((r / R) * 4) % 1) < 0.02 || r > R - 1.5 ? 0.5 : 0;
          const level = Math.max(0.05 + glow * 0.45, ring);
          // Coarse cells far from the sweep, fine ones right behind it.
          const cell = glow > 0.3 ? 2 : glow > 0 ? 4 : 6;
          const bx = Math.floor(x / cell) % 4, by = Math.floor(y / cell) % 4;
          if (level * 16 > BAYER[by * 4 + bx]!) ctx.fillRect(x, y, 1.5, 1.5);
        }
      }
      ctx.fillRect(c - 0.5, c - 0.5, 1, 1);
      const now = Date.now();
      const { blips: list, active: on } = state.current;
      for (const b of list) {
        const age = Math.min(1, Math.max(0, (now - b.at) / SPAN_MS));
        const a = angleOf(b.mint);
        const r = 10 + age * (R - 16);
        const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
        let behind = sweep - a;
        behind = ((behind % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const sharp = still || (behind / (Math.PI * 2)) * SWEEP_MS < DECAY_MS * 2;
        const s = b.mint === on ? 9 : sharp ? 6 : 5;
        ctx.globalAlpha = sharp || b.mint === on ? 1 : 0.55;
        if (b.tier === "strong") ctx.fillRect(x - s / 2, y - s / 2, s, s);
        else {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = ink;
          ctx.strokeRect(x - s / 2, y - s / 2, s, s);
        }
        ctx.globalAlpha = 1;
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Pointer over a blip highlights its row.
  const hit = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const c = box.width / 2, R = c - 2;
    const px = e.clientX - box.left, py = e.clientY - box.top;
    let best: string | null = null, d = 12;
    for (const b of blips) {
      const age = Math.min(1, Math.max(0, (Date.now() - b.at) / SPAN_MS));
      const a = angleOf(b.mint), r = 10 + age * (R - 16);
      const dd = Math.hypot(c + Math.cos(a) * r - px, c + Math.sin(a) * r - py);
      if (dd < d) (d = dd), (best = b.mint);
    }
    onActive(best);
  };

  return <canvas ref={ref} onPointerMove={hit} onPointerLeave={() => onActive(null)} role="img" aria-label={`${blips.length} live signals on the radar`} className="aspect-square w-full max-w-[320px] text-white" />;
}
