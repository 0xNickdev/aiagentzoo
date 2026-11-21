import { useEffect, useRef, useState } from "react";
import { Hammer, KeyRound, Radar, Rocket, Scissors, Server, Trophy } from "lucide-react";
import { pick, t } from "../../i18n";
import { STOPS, type Stop, type StopStatus } from "./data";

const ICON: Record<string, React.ElementType> = { built: Hammer, own: Server, final: Trophy, cut: Scissors, runner: Radar, accelerator: Rocket, pro: KeyRound };
const STATUS: Record<StopStatus, string> = { shipped: "Shipped", now: "Now", next: "Next" };

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The picked stop sits here on the ring: the top. */
const TOP = -90;
const step = 360 / STOPS.length;

/**
 * Seven stops on one ring, turning slowly. Picking a stop brings it to the top and holds the ring there;
 * a click on the empty sky lets it turn again. The nodes are moved straight on the DOM, so a turn re-renders nothing.
 */
export default function Orbit({ children }: { children?: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef<Array<HTMLButtonElement | null>>([]);
  const angle = useRef(TOP - step * STOPS.findIndex((s) => s.status === "now"));
  const [picked, setPicked] = useState<string | null>(null);
  const pickedRef = useRef<string | null>(null);
  const hover = useRef(false);
  pickedRef.current = picked;

  const shown: Stop = STOPS.find((s) => s.id === picked) ?? STOPS.find((s) => s.status === "now")!;
  const related = new Set(picked ? shown.related : []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const still = reduced();
    let raf = 0;
    let last = performance.now();
    let size = el.clientWidth;
    const ro = new ResizeObserver(() => (size = el.clientWidth));
    ro.observe(el);
    const place = () => {
      const r = size * 0.37;
      const half = size < 440 ? 20 : 22;
      nodes.current.forEach((n, i) => {
        if (!n) return;
        const a = ((angle.current + i * step) * Math.PI) / 180;
        // The far side of the ring sits a little back: the top of the box is "near".
        const depth = (1 - Math.sin(a)) / 2;
        n.style.transform = `translate(calc(-50% + ${(Math.cos(a) * r).toFixed(1)}px), calc(${(Math.sin(a) * r).toFixed(1)}px - ${half}px))`;
        n.style.zIndex = String(10 + Math.round(depth * 10));
      });
    };
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const id = pickedRef.current;
      if (id) {
        const target = TOP - step * STOPS.findIndex((s) => s.id === id);
        // The short way round.
        const d = ((((target - angle.current) % 360) + 540) % 360) - 180;
        angle.current += Math.abs(d) < 0.05 ? d : d * Math.min(1, dt / 220);
      } else if (!still && !hover.current) {
        angle.current += dt * 0.006;
      }
      place();
      raf = requestAnimationFrame(tick);
    };
    place();
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const Icon = ICON[shown.id] ?? Radar;

  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:grid-rows-[auto_1fr]">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{children}</div>
      <div
        ref={box}
        className="relative mx-auto aspect-square w-full max-w-[600px] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center"
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.sky != null) setPicked(null);
        }}
        onPointerEnter={() => (hover.current = true)}
        onPointerLeave={() => (hover.current = false)}
      >
        <svg data-sky viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <radialGradient id="orbit-glow" cx="200" cy="200" r="200" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#1a221e" />
              <stop offset="0.55" stopColor="#0a0e0c" stopOpacity="0.6" />
              <stop offset="1" stopColor="#030504" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle data-sky cx="200" cy="200" r="200" fill="url(#orbit-glow)" />
          {/* the outer dial: a tick every six degrees, a longer one at every stop's share of the ring */}
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i * 6 * Math.PI) / 180;
            const long = i % 5 === 0;
            const r1 = long ? 184 : 188;
            return <line key={i} x1={200 + Math.cos(a) * r1} y1={200 + Math.sin(a) * r1} x2={200 + Math.cos(a) * 192} y2={200 + Math.sin(a) * 192} stroke={long ? "#4a524e" : "#232c27"} strokeWidth="1" />;
          })}
          <circle cx="200" cy="200" r="148" fill="none" stroke="#333b37" strokeWidth="1" />
          <circle cx="200" cy="200" r="96" fill="none" stroke="#232c27" strokeWidth="1" strokeDasharray="2 5" />
          <circle cx="200" cy="200" r="52" fill="none" stroke="#18201c" strokeWidth="1" />
          {/* the top of the ring is where a picked stop is read */}
          <path d="M200 30v14" stroke="#ffffff" strokeWidth="1.5" />
        </svg>

        {/* the centre: the two eyes */}
        <div data-sky className="absolute left-1/2 top-1/2 flex h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-lit-edge bg-night">
          <span className="orbit-ping absolute inset-0 rounded-full border border-fg-4" />
          <span className="orbit-ping absolute inset-0 rounded-full border border-fg-4" style={{ animationDelay: "1.4s" }} />
          <svg viewBox="32 140 448 232" className="relative w-10" aria-hidden="true">
            <circle cx="148" cy="256" r="88" fill="none" stroke="#fff" strokeWidth="42" />
            <circle cx="148" cy="256" r="32" fill="#fff" />
            <circle cx="364" cy="256" r="88" fill="none" stroke="#fff" strokeWidth="42" />
            <circle cx="364" cy="256" r="32" fill="#fff" />
          </svg>
        </div>

        {STOPS.map((s, i) => {
          const I = ICON[s.id] ?? Radar;
          const on = picked === s.id;
          const rel = related.has(s.id);
          return (
            <button
              key={s.id}
              ref={(el) => void (nodes.current[i] = el)}
              type="button"
              onClick={() => setPicked(on ? null : s.id)}
              aria-pressed={on}
              className="group absolute left-1/2 top-1/2 flex w-[104px] flex-col items-center gap-1.5 outline-offset-4 sm:w-[128px]"
            >
              <span
                className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition-[transform,background-color,border-color,color] duration-300 sm:h-11 sm:w-11 ${
                  on
                    ? "scale-[1.18] border-white bg-white text-night"
                    : s.status === "shipped"
                      ? `bg-night-raised text-white ${rel ? "border-white" : "border-[#4a524e]"} group-hover:border-white`
                      : s.status === "now"
                        ? "border-white bg-night text-white"
                        : `border-dashed bg-night text-dim ${rel ? "border-white text-white" : "border-[#4a524e]"} group-hover:border-white group-hover:text-white`
                }`}
              >
                {s.status === "now" && !on && <span className="orbit-ping absolute -inset-1 rounded-full border border-white" />}
                <I size={16} strokeWidth={1.75} />
              </span>
              <span className={`whitespace-nowrap text-[11.5px] font-medium leading-none sm:text-[12.5px] ${on || rel ? "text-white" : "text-fg-3 group-hover:text-white"}`}>{pick(s.title, s.titleZh)}</span>
              <span className="whitespace-nowrap font-mono text-[9.5px] uppercase leading-none tracking-[0.08em] text-faint sm:text-[10px]">{pick(s.date, s.dateZh)}</span>
            </button>
          );
        })}
      </div>

      {/* what the picked stop says; with nothing picked, where we are now */}
      <div className="rm-frame mx-auto w-full max-w-[460px] lg:col-start-1 lg:row-start-2 lg:mx-0 lg:self-end">
        <Corners />
        <div className="rounded-[2px] border border-line-2 bg-night-surface p-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <span
              className={`inline-flex h-[22px] items-center gap-1.5 rounded-[4px] border px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] ${
                shown.status === "shipped" ? "border-white bg-white text-night" : shown.status === "now" ? "border-white text-white" : "border-dashed border-[#4a524e] text-dim"
              }`}
            >
              {shown.status === "now" && <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />}
              {t(STATUS[shown.status])}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">{pick(shown.date, shown.dateZh)}</span>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-2 text-white">
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <h2 className="text-[24px] font-semibold leading-none tracking-[-0.04em] text-white">{pick(shown.title, shown.titleZh)}</h2>
          </div>
          <p className="mt-4 min-h-[5.6em] text-[13.5px] leading-[1.6] text-fg-2">{pick(shown.text, shown.textZh)}</p>
          <div className="mt-4 border-t border-line pt-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{t("Connected")}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {shown.related.map((id) => {
                const r = STOPS.find((x) => x.id === id)!;
                return (
                  <button key={id} type="button" onClick={() => setPicked(id)} className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-line-2 px-2.5 text-[12px] text-fg-2 hover:border-[#4a524e] hover:text-white">
                    {pick(r.title, r.titleZh)}
                    <span className="text-faint">→</span>
                  </button>
                );
              })}
              <a href={shown.href} className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[5px] bg-white px-2.5 text-[12px] font-medium text-night hover:bg-lit-hover">
                {t("Read on")}
                <span>↓</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Four corner brackets that step outward when the frame is hovered. */
export function Corners() {
  return (
    <>
      <span className="rm-c rm-c-tl" aria-hidden="true" />
      <span className="rm-c rm-c-tr" aria-hidden="true" />
      <span className="rm-c rm-c-bl" aria-hidden="true" />
      <span className="rm-c rm-c-br" aria-hidden="true" />
    </>
  );
}
