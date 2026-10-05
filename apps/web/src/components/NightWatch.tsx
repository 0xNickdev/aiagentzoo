import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { SPECIES, SPECIES_COLOR } from "../data";
import { NightWatch as Engine, PARTS, type LogEntry, type Snapshot } from "../sim/nightWatch";
import { Reveal, Section, SectionHead } from "./ui";

const SPEEDS = [1, 3, 8];
const STATUS_LABEL: Record<Snapshot["status"], string> = {
  building: "assembling",
  published: "published",
  partial: "partially published",
};

export default function NightWatch() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const engine = new Engine((entry) => {
      if (entry === "reset") setLog([]);
      else setLog((prev) => [entry, ...prev].slice(0, 40));
    });
    engineRef.current = engine;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let sinceSnap = 0;
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      engine.step(dt);
      engine.draw(ctx, w, h, now);
      sinceSnap += dt;
      if (sinceSnap > 0.15) {
        sinceSnap = 0;
        setSnap(engine.snapshot());
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const togglePause = () => {
    const engine = engineRef.current!;
    engine.paused = !engine.paused;
    setPaused(engine.paused);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    engineRef.current!.speed = next;
    setSpeed(next);
  };

  return (
    <Section id="live">
      <SectionHead
        eyebrow="Live enclosures · simulation"
        title={["The Night Watch"]}
        text="Three nodes, four species, zero humans in the loop. By 07:00 the pack has to ship the Morning Brief."
      />

      <Reveal className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative min-h-[460px] overflow-hidden rounded-3xl bg-[#040404] ring-1 ring-white/[0.06] sm:min-h-[620px]">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Map of enclosures with moving agents" />

          <div className="absolute left-4 top-4 flex items-center gap-2 sm:left-6 sm:top-6">
            <span className="font-garamond mr-2 text-3xl tracking-tight text-white sm:text-4xl">{snap?.clock ?? "22:00"}</span>
            <button type="button" onClick={togglePause} className="liquid-glass rounded-full px-4 py-1.5 text-[11px] uppercase tracking-[0.2em] text-white/90">
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" onClick={cycleSpeed} className="liquid-glass rounded-full px-4 py-1.5 text-[11px] uppercase tracking-[0.2em] text-white/90">
              ×{speed}
            </button>
          </div>

          <div className="absolute bottom-4 left-4 flex flex-wrap gap-x-5 gap-y-2 text-[10px] font-light uppercase tracking-[0.2em] text-white/50 sm:bottom-6 sm:left-6">
            {SPECIES.map((s) => (
              <span key={s.id} className="flex items-center gap-2">
                <i className="h-1.5 w-1.5 rounded-full" style={{ background: SPECIES_COLOR[s.id] }} />
                {s.name}
              </span>
            ))}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="liquid-glass rounded-3xl p-6">
            <div className="flex justify-between text-[10px] font-light uppercase tracking-[0.25em] text-white/50">
              <span>Artifact</span>
              <span className={snap?.status === "building" ? "text-white/70" : "text-white"}>{STATUS_LABEL[snap?.status ?? "building"]}</span>
            </div>
            <h3 className="font-garamond mt-3 text-3xl uppercase tracking-tight">Morning Brief</h3>
            <div className="mt-4 h-px w-full bg-white/10">
              <div className="h-px bg-white transition-[width] duration-700" style={{ width: `${Math.round((snap?.progress ?? 0) * 100)}%` }} />
            </div>
            <ol className="mt-4 grid gap-1.5 text-[13px] font-light">
              {PARTS.map((p, i) => (
                <li key={p} className={`flex gap-3 transition-colors duration-500 ${snap?.done[i] ? "text-white" : "text-white/30"}`}>
                  <span>{snap?.done[i] ? "●" : "○"}</span>
                  {p}
                </li>
              ))}
            </ol>
          </div>

          <div className="liquid-glass grid grid-cols-2 gap-5 rounded-3xl p-6">
            {[
              [snap?.cycles ?? 0, "cycles"],
              [(snap?.feed ?? 0).toFixed(1), "feed burned"],
              [snap?.signals ?? 0, "signals accepted"],
              [snap?.rejected ?? 0, "rejected"],
            ].map(([value, label]) => (
              <div key={label}>
                <b className="font-garamond block text-3xl font-normal leading-none">{value}</b>
                <span className="mt-1 block text-[10px] font-light uppercase tracking-[0.2em] text-white/50">{label}</span>
              </div>
            ))}
          </div>

          <div className="liquid-glass flex min-h-[260px] flex-1 flex-col rounded-3xl p-6">
            <div className="flex justify-between text-[10px] font-light uppercase tracking-[0.25em] text-white/50">
              <span>Public log</span>
              <span className="animate-pulse text-white/80">● live</span>
            </div>
            <ul className="mt-3 max-h-[300px] overflow-hidden text-[12px] font-light leading-snug [mask-image:linear-gradient(to_bottom,#000_70%,transparent)]">
              <AnimatePresence initial={false}>
                {log.map((e) => (
                  <motion.li
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border-b border-dashed border-white/10 py-2 text-white/60"
                  >
                    <span className="mr-2 text-white/30">{e.time}</span>
                    <span style={{ color: e.species ? SPECIES_COLOR[e.species] : "#fff" }}>{e.who ?? "warden"}</span>{" "}
                    {e.text} <span className="text-white/25">#{e.hash}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </aside>
      </Reveal>
    </Section>
  );
}
