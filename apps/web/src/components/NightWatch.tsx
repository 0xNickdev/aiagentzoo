import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { SPECIES, SPECIES_COLOR } from "../data";
import { NODE_URLS, useLiveZoo } from "../sim/live";
import { GuardianButton, WakeButton } from "./Guardian";
import { openPassport } from "../passportStore";
import { NightWatch as Engine, PARTS, type LogEntry, type Snapshot } from "../sim/nightWatch";
import { useLiveNumbers } from "./LiveStats";
import { Reveal, Section } from "./ui";

const SPEEDS = [1, 3, 8];
const LIVE_SECTIONS = ["Night in review", "Top volume", "Graduated", "Went to zero", "Suspicious", "Freshly promoted"];
const OBSERVATION_TARGET = 200;
const AGENTS = ["raven", "hedgehog", "owl", "otter", "beaver", "tortoise"];
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
  const live = useLiveZoo(engineRef);
  const liveNumbers = useLiveNumbers();

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const engine = new Engine((entry) => {
      if (entry === "reset") setLog([]);
      else setLog((prev) => [entry, ...prev].slice(0, 40));
    });
    engine.live = NODE_URLS.length > 0;
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

  const status: Snapshot["status"] = live.enabled ? (live.brief ? "published" : "building") : (snap?.status ?? "building");
  const parts = live.enabled ? LIVE_SECTIONS : PARTS;
  const done = live.enabled ? parts.map(() => Boolean(live.brief)) : (snap?.done ?? []);
  const progress = live.enabled ? (live.brief ? 1 : Math.min(live.stats.observed / OBSERVATION_TARGET, 1)) : (snap?.progress ?? 0);

  const tonight = liveNumbers?.stats?.tokensTonight;
  const stats: Array<[string | number, string]> = live.enabled
    ? [
        [live.stats.wakes, "wake-ups"],
        [tonight != null ? tonight.toLocaleString("en-US") : live.stats.observed, "tokens tonight"],
        [live.stats.signals, "signals accepted"],
        [live.stats.rejected, "rejected"],
      ]
    : [
        [snap?.cycles ?? 0, "cycles"],
        [(snap?.feed ?? 0).toFixed(1), "feed burned"],
        [snap?.signals ?? 0, "signals accepted"],
        [snap?.rejected ?? 0, "rejected"],
      ];

  return (
    <Section id="live" className="!py-16 sm:!py-20" backdrop={{ src: "/backdrops/watch.webp", tint: "90,130,165", glowAt: "50% 65%", opacity: 0.45 }}>
      {/* Compact head, so the map and the panel fit one screen under it. */}
      <Reveal className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[12px] text-white/55">
            {live.enabled ? `Live enclosures · ${live.connected}/${NODE_URLS.length} nodes online` : "Live enclosures · simulation"}
          </p>
          <h2 className="font-display mt-2 text-4xl text-white md:text-5xl">The Night Watch</h2>
        </div>
        <p className="max-w-md text-[14px] font-light leading-relaxed text-white/60 md:text-right">
          Three nodes, four species, zero humans in the loop. By 07:00 UTC the pack ships the Morning Brief.
        </p>
      </Reveal>

      <Reveal className="grid gap-3 lg:h-[clamp(600px,calc(100svh-210px),860px)] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative h-[480px] overflow-hidden rounded-3xl bg-[#040404] ring-1 ring-white/[0.06] sm:h-[600px] lg:h-full">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Map of enclosures with moving agents" />

          <div className="absolute left-4 top-4 flex items-center gap-2 sm:left-6 sm:top-5">
            <span className="font-display mr-2 text-3xl text-white">{snap?.clock ?? "22:00"}</span>
            {!live.enabled && (
              <>
                <button type="button" onClick={togglePause} className="liquid-glass rounded-full px-4 py-1.5 text-[11px] text-white/90">
                  {paused ? "Resume" : "Pause"}
                </button>
                <button type="button" onClick={cycleSpeed} className="liquid-glass rounded-full px-4 py-1.5 text-[11px] text-white/90">
                  ×{speed}
                </button>
              </>
            )}
          </div>

          {live.enabled && (
            <div className="absolute right-4 top-4 hidden max-w-[64%] flex-wrap justify-end gap-1.5 sm:flex sm:right-5 sm:top-5">
              {AGENTS.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => openPassport(name)}
                  className="liquid-glass flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-[11px] capitalize text-white/80 hover:text-white"
                >
                  <img src={`/agents/${name}.webp`} alt="" className="h-6 w-6 rounded-full" />
                  {name}
                </button>
              ))}
            </div>
          )}

          <div className="font-mono absolute bottom-4 left-4 flex flex-wrap gap-x-5 gap-y-2 text-[10.5px] text-white/50 sm:bottom-5 sm:left-6">
            {SPECIES.map((s) => (
              <span key={s.id} className="flex items-center gap-2">
                <i className="h-1.5 w-1.5 rounded-full" style={{ background: SPECIES_COLOR[s.id] }} />
                {s.name.toLowerCase()}
              </span>
            ))}
          </div>
        </div>

        <aside className="flex min-h-0 min-w-0 flex-col gap-3">
          {live.enabled && (
            <div className="liquid-glass rounded-3xl bg-black/30 p-5">
              <div className="font-mono flex items-center justify-between text-[10.5px] text-white/50">
                <span>your move</span>
                <span>real cycles</span>
              </div>
              <p className="mt-2 text-[13px] font-light leading-relaxed text-white/65">
                Wake a sentinel on its live node: it really scans, and the step lands in the log under your name.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <WakeButton agent="raven" />
                <WakeButton agent="owl" />
              </div>
              <GuardianButton className="mt-3" />
            </div>
          )}

          <div className="liquid-glass rounded-3xl p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-xl">Morning Brief</h3>
              <span className={`font-mono text-[10.5px] ${status === "building" ? "text-white/55" : "text-amber-100/85"}`}>{STATUS_LABEL[status]}</span>
            </div>
            <div className="mt-3 h-px w-full bg-white/10">
              <div className="h-px bg-white transition-[width] duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <ol className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] font-light">
              {parts.map((p, i) => (
                <li key={p} className={`flex gap-2 truncate transition-colors duration-500 ${done[i] ? "text-white/85" : "text-white/30"}`}>
                  <span>{done[i] ? "●" : "○"}</span>
                  {p}
                </li>
              ))}
            </ol>
            {live.brief && (
              <a href="#brief" className="font-mono mt-3 inline-block text-[11px] text-white/60 underline decoration-white/25 underline-offset-4 hover:text-white">
                read {live.brief.id} →
              </a>
            )}
          </div>

          <div className="liquid-glass grid grid-cols-4 gap-2 rounded-3xl px-5 py-4 lg:grid-cols-2 lg:gap-x-4 lg:gap-y-3">
            {stats.map(([value, label]) => (
              <div key={label} className="min-w-0">
                <b className="font-display block truncate text-2xl font-normal leading-none">{value}</b>
                <span className="font-mono mt-1 block truncate text-[10px] text-white/45">{label}</span>
              </div>
            ))}
          </div>

          {/* The log scrolls inside its card instead of stretching the page. */}
          <div className="liquid-glass flex min-h-[220px] flex-1 flex-col rounded-3xl p-5 lg:min-h-0">
            <div className="font-mono flex justify-between text-[10.5px] text-white/50">
              <span>public log</span>
              <span className="animate-pulse text-white/80">● live</span>
            </div>
            <ul className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 text-[12px] font-light leading-snug [mask-image:linear-gradient(to_bottom,#000_85%,transparent)] [scrollbar-width:thin]">
              <AnimatePresence initial={false}>
                {(live.enabled ? live.log : log).map((e) => (
                  <motion.li
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border-b border-dashed border-white/10 py-2 text-white/60"
                  >
                    <span className="font-mono mr-2 text-[10.5px] text-white/30">{e.time}</span>
                    <span style={{ color: e.species ? SPECIES_COLOR[e.species] : "#fff" }}>{e.who ?? "warden"}</span> {e.text}{" "}
                    <span className="font-mono text-[10.5px] text-white/25">#{e.hash}</span>
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
