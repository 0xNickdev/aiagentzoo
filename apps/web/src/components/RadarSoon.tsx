import { useEffect, useRef } from "react";
import { t } from "../i18n";
import { BOT_URL, ZOOAGENCY_CLAWPUMP_URL } from "../links";
import { RADAR_RELEASE_AT } from "../radarRelease";
import RadarDisc from "./RadarDisc";
import { Btn } from "./site/Panel";

const FONT = "600 {s}px Geist, -apple-system, sans-serif";
const DIGIT_W = 0.6; // slot width per digit, in font sizes
const COLON_W = 0.32;

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  size: number;
  alpha: number;
  /** ms timestamp until which the grain drifts before it springs to its target */
  wait: number;
  /** free grains drift off and fade; they belong to no glyph */
  free: boolean;
  life: number;
}

interface Slot {
  ch: string;
  x: number; // left edge, css px
  y: number; // baseline, css px
  w: number;
  ps: P[];
}

const glyphCache = new Map<string, Array<[number, number]>>();

/** Points inside a glyph drawn in Geist, relative to its slot's left edge and baseline. */
function glyphPoints(ch: string, fs: number, n: number): Array<[number, number]> {
  const key = `${ch}:${Math.round(fs)}:${n}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const w = Math.ceil(fs * DIGIT_W) + 4, h = Math.ceil(fs * 1.05);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.font = FONT.replace("{s}", String(fs));
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#fff";
  const base = Math.round(fs * 0.86);
  g.fillText(ch, w / 2, base);
  const data = g.getImageData(0, 0, w, h).data;
  const inside: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]! > 128) inside.push([x - 2, y - base]);
  // Random subset, jittered a little inside each pixel.
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n && inside.length; i++) {
    const [x, y] = inside[Math.floor(Math.random() * inside.length)]!;
    out.push([x + Math.random(), y + Math.random()]);
  }
  glyphCache.set(key, out);
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.min(99, Math.floor(s / 3600)))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function grain(x: number, y: number): P {
  return { x, y, vx: 0, vy: 0, tx: x, ty: y, size: 1.5 + Math.random(), alpha: 0.55 + Math.random() * 0.45, wait: 0, free: false, life: 1 };
}

/** HH:MM:SS drawn out of particles: each new digit condenses out of the grains of the old one. */
function ParticleClock({ onZero }: { onZero: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zero = useRef(onZero);
  zero.current = onZero;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let slots: Slot[] = [];
    let free: P[] = [];
    let fs = 100, perDigit = 800, W = 0, H = 0, dpr = 1;
    let raf = 0, timer = 0, burstAt = 0, done = false, ready = false;

    const layout = () => {
      W = canvas.parentElement!.clientWidth;
      const twoRows = W < 560;
      fs = twoRows ? Math.min(W / (4 * DIGIT_W + COLON_W + 0.1), 200) : Math.min(W / (6 * DIGIT_W + 2 * COLON_W + 0.1), 280);
      fs = Math.floor(fs);
      const lineH = fs * 0.82;
      H = Math.ceil(twoRows ? lineH * 2 + fs * 0.12 : lineH);
      perDigit = Math.round(Math.min(1200, Math.max(600, fs * fs * 0.014)));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.height = `${H}px`;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const text = clockText(RADAR_RELEASE_AT - Date.now());
      const rows = twoRows ? [text.slice(0, 5), text.slice(6)] : [text];
      const old = slots;
      slots = [];
      rows.forEach((row, r) => {
        const width = [...row].reduce((a, ch) => a + (ch === ":" ? COLON_W : DIGIT_W) * fs, 0);
        let x = (W - width) / 2;
        const y = fs * 0.72 + r * (lineH + fs * 0.12);
        for (const ch of row) {
          const w = (ch === ":" ? COLON_W : DIGIT_W) * fs;
          slots.push({ ch: "", x, y, w, ps: [] });
          x += w;
        }
      });
      // Re-seed: every slot condenses its current character from where grains were.
      const pool = old.flatMap((s) => s.ps);
      slots.forEach((s, i) => setChar(s, rows.join("")[i]!, pool, true));
    };

    const colonPoints = (n: number): Array<[number, number]> => {
      const r = fs * 0.055, out: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        const dot = i % 2 ? -fs * 0.15 : -fs * 0.47;
        out.push([fs * COLON_W * 0.5 + Math.cos(a) * d, dot + Math.sin(a) * d]);
      }
      return out;
    };

    function setChar(s: Slot, ch: string, pool: P[] = [], initial = false) {
      if (s.ch === ch && !initial) return;
      s.ch = ch;
      const pts = ch === ":" ? colonPoints(Math.round(perDigit * 0.3)) : glyphPoints(ch, fs, perDigit);
      const order = [...pts].sort(() => Math.random() - 0.5);
      const now = performance.now();
      const keep = s.ps.length ? s.ps : pool.splice(0, pts.length);
      // A quarter of the old glyph lets go and drifts away; the rest morph into the new shape.
      const release = initial ? 0 : Math.floor(keep.length * 0.25);
      for (let i = 0; i < release; i++) {
        const p = keep.splice(Math.floor(Math.random() * keep.length), 1)[0]!;
        p.free = true;
        p.life = 1;
        p.vx += (Math.random() - 0.5) * 1.2;
        p.vy += (Math.random() - 0.5) * 1.2;
        free.push(p);
      }
      const next: P[] = [];
      order.forEach(([px, py], i) => {
        const tx = s.x + px, ty = s.y + py;
        let p = keep[i];
        if (!p) {
          // Spawned out of the drift around the slot.
          const a = Math.random() * Math.PI * 2, d = fs * (0.2 + Math.random() * 0.5);
          p = grain(s.x + s.w / 2 + Math.cos(a) * d, s.y - fs * 0.35 + Math.sin(a) * d);
          p.alpha = 0;
        } else if (!initial) {
          p.vx += (Math.random() - 0.5) * 2.2;
          p.vy += (Math.random() - 0.5) * 2.2 - 0.4;
        }
        p.tx = tx;
        p.ty = ty;
        p.wait = initial || still ? 0 : now + 90 + Math.random() * 260;
        if (still) (p.x = tx), (p.y = ty);
        next.push(p);
      });
      for (let i = order.length; i < keep.length; i++) {
        keep[i]!.free = true;
        free.push(keep[i]!);
      }
      s.ps = next;
    }

    const tick = () => {
      const left = RADAR_RELEASE_AT - Date.now();
      if (left <= 0 && !burstAt) {
        burstAt = performance.now();
        for (const s of slots)
          for (const p of s.ps) {
            const a = Math.atan2(p.y - H / 2, p.x - W / 2) + (Math.random() - 0.5);
            const v = 3 + Math.random() * 7;
            p.vx = Math.cos(a) * v;
            p.vy = Math.sin(a) * v;
            p.free = true;
            free.push(p);
          }
        slots.forEach((s) => (s.ps = []));
        if (still) return void zero.current();
        return;
      }
      if (burstAt) return;
      const chars = clockText(left);
      const flat = slots.length === 8 ? chars : chars.slice(0, 5) + chars.slice(6);
      slots.forEach((s, i) => setChar(s, flat[i]!));
    };

    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      const k = 0.075, damp = 0.8;
      const pulse = 0.55 + 0.45 * Math.sin(now / 520);
      for (const s of slots) {
        const colon = s.ch === ":";
        for (const p of s.ps) {
          if (!still) {
            if (now < p.wait) {
              // Dissolving: noise-driven drift before it settles into the new glyph.
              p.vx += Math.sin(p.y * 0.035 + now * 0.002) * 0.12;
              p.vy += Math.cos(p.x * 0.031 - now * 0.0017) * 0.12 - 0.02;
              p.vx *= 0.94;
              p.vy *= 0.94;
            } else {
              p.vx = (p.vx + (p.tx - p.x) * k) * damp;
              p.vy = (p.vy + (p.ty - p.y) * k) * damp;
            }
            p.x += p.vx;
            p.y += p.vy;
            if (p.alpha < 0.55) p.alpha += 0.03;
          }
          ctx.globalAlpha = colon ? p.alpha * (still ? 0.8 : pulse) : p.alpha;
          ctx.fillRect(p.x, p.y, p.size, p.size);
        }
      }
      const fade = burstAt ? 0.018 : 0.03;
      free = free.filter((p) => {
        p.vx += Math.sin(p.y * 0.03 + now * 0.002) * 0.08;
        p.vy += Math.cos(p.x * 0.03 - now * 0.0015) * 0.08 - 0.03;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= fade;
        if (p.life <= 0) return false;
        ctx.globalAlpha = p.alpha * p.life;
        ctx.fillRect(p.x, p.y, p.size, p.size);
        return true;
      });
      ctx.globalAlpha = 1;
      if (burstAt && now - burstAt > 1100 && !done) {
        done = true;
        zero.current();
        return;
      }
      if (!still) raf = requestAnimationFrame(draw);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      if (document.hidden) return;
      tick();
      timer = window.setInterval(() => {
        tick();
        if (still) draw(performance.now());
      }, 250);
      raf = requestAnimationFrame(draw);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
    const vis = () => (document.hidden ? stop() : ready && start());
    let rw = 0;
    const ro = new ResizeObserver(() => {
      if (!ready || canvas.parentElement!.clientWidth === rw) return;
      rw = canvas.parentElement!.clientWidth;
      glyphCache.clear();
      layout();
    });

    let alive = true;
    const probe = FONT.replace("{s}", "100");
    (document.fonts?.load(probe) ?? Promise.resolve()).catch(() => {}).then(() => {
      if (!alive) return;
      ready = true;
      rw = canvas.parentElement!.clientWidth;
      layout();
      start();
    });
    ro.observe(canvas.parentElement!);
    document.addEventListener("visibilitychange", vis);
    return () => {
      alive = false;
      stop();
      ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  return (
    <div className="w-full">
      <canvas ref={ref} className="block w-full" role="timer" aria-label={clockText(RADAR_RELEASE_AT - Date.now())} />
    </div>
  );
}

/** The radar before it opens: the disc sweeping behind a particle countdown. */
export default function RadarSoon({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="relative flex min-h-[calc(100svh-60px)] flex-col items-center justify-center overflow-hidden px-4 py-12 text-center sm:px-5">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.22]" aria-hidden>
        <RadarDisc blips={[]} active={null} onActive={() => {}} sweepMs={14_000} className="aspect-square w-[min(120vw,920px)] max-w-none text-white" />
      </div>
      <div className="relative z-10 flex w-full max-w-[1240px] flex-col items-center">
        <h1 className="text-[28px] font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-[40px]">{t("Runner radar")}</h1>
        <p className="mt-3 text-[14px] text-fg-2 sm:text-[16px]">{t("Opens to holders of 500,000 $ZOOAGENCY in")}</p>
        <div className="my-8 w-full sm:my-10">
          <ParticleClock onZero={onOpen} />
        </div>
        <p className="max-w-[60ch] text-[13.5px] leading-[1.55] text-fg-2 sm:text-[15px]">
          {t("Frozen on 21 Nov, graded in public: its sharpest picks graduated 46% of the time, against 1.3% for a random launch.")}
        </p>
        <p className="mt-2 max-w-[60ch] text-[13.5px] leading-[1.55] text-dim sm:text-[15px]">{t("Signals at minute five, live in the site and in Telegram.")}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <Btn href={ZOOAGENCY_CLAWPUMP_URL} primary className="h-10 px-4 text-[13.5px]">{t("Get $ZOOAGENCY")}</Btn>
          <Btn href={BOT_URL} className="h-10 px-4 text-[13.5px]">{t("Open the bot")}</Btn>
        </div>
      </div>
    </section>
  );
}
