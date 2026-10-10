import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useMemo, useState } from "react";
import { GITHUB_URL, GitHubIcon, X_URL, XIcon } from "../links";
import { type ChronicleEntry, type Creature, dayOf, type Nursery, pad, pct, portrait, useNursery } from "./data";
import Sheet from "./Sheet";
import Tree from "./Tree";

const ease = [0.22, 1, 0.36, 1] as const;
const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.9, delay, ease },
});

function Header() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-2.5 text-[15px] font-medium tracking-tight text-white">
            <img src="/token.png" alt="" className="h-7 w-7 rounded-full ring-1 ring-white/20" />
            ZOOAI AGENCY
          </a>
          <span className="font-mono rounded-full px-2.5 py-0.5 text-[11px] text-white/60 ring-1 ring-white/15">evolution</span>
        </div>
        <nav className="flex items-center gap-2">
          <a href="/docs" className="hidden px-3 text-[13.5px] text-white/60 hover:text-white sm:block">
            Docs
          </a>
          <a href="/" className="hidden px-3 text-[13.5px] text-white/60 hover:text-white sm:block">
            Back to the zoo
          </a>
          <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="ZOOAI AGENCY on X" className="ml-2 rounded-full p-2 text-white/70 ring-1 ring-white/15 hover:text-white">
            <XIcon size={13} />
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="Source on GitHub" className="rounded-full p-2 text-white/70 ring-1 ring-white/15 hover:text-white">
            <GitHubIcon size={14} />
          </a>
        </nav>
      </div>
    </header>
  );
}

/** A thin "+" at a corner, the way instrument panels mark their frame. */
const Plus = ({ className = "" }: { className?: string }) => (
  <span aria-hidden className={`pointer-events-none absolute font-mono text-[11px] leading-none text-white/35 ${className}`}>
    +
  </span>
);

function Hero({ data }: { data: Nursery | null }) {
  const alive = data?.creatures.filter((c) => !c.diedNight) ?? [];
  const fallen = (data?.creatures.length ?? 0) - alive.length;
  const houses = new Set(alive.map((c) => c.house)).size;
  const stats: Array<[string, string]> = [
    ["TURN", data ? pad(data.generation) : "--"],
    ["ALIVE", data ? pad(alive.length) : "--"],
    ["FALLEN", data ? pad(fallen) : "--"],
    ["HOUSES", data ? `${houses}/8` : "--"],
    ["NEXT TURN", data ? (data.nextGenerationInNights === 0 ? "TONIGHT" : `${data.nextGenerationInNights} NIGHT${data.nextGenerationInNights === 1 ? "" : "S"}`) : "--"],
  ];
  return (
    <section className="relative flex min-h-[100svh] flex-col overflow-hidden">
      <picture>
        <source media="(max-width: 900px)" srcSet="/evolution/nursery-1280.webp" />
        <img src="/evolution/nursery.webp" alt="" className="hero-drift absolute inset-0 h-full w-full object-cover" />
      </picture>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,4,0.55)_0%,rgba(3,5,4,0.15)_35%,rgba(3,5,4,0.6)_75%,#030504_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_55%,rgba(3,5,4,0.55),transparent_70%)]" />
      <Header />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-5 pb-10 pt-28 sm:px-8">
        <motion.p {...rise(0.1)} className="font-mono text-[11px] tracking-[0.18em] text-white/55">
          THE NURSERY · LIVE ON SOLANA
        </motion.p>
        <motion.h1 {...rise(0.2)} className="font-display mt-5 max-w-4xl text-[2.9rem] leading-[0.98] sm:text-7xl lg:text-[6rem]">
          Judges that don't learn. <span className="accent">They evolve.</span>
        </motion.h1>
        <motion.p {...rise(0.35)} className="mt-7 max-w-xl text-[15px] font-light leading-relaxed text-white/70 sm:text-lg">
          Eight judges carry their rules as DNA. Every night they read the same fresh tokens; a day later reality grades them. Every three
          nights the weakest dies and the two best breed. Nobody edits their rules. Only selection does.
        </motion.p>
        <motion.div {...rise(0.5)} className="mt-9 flex flex-wrap gap-3">
          <a href="#living" className="rounded-full bg-white px-6 py-3 text-[14px] font-medium text-black hover:bg-white/90">
            Meet the living
          </a>
          <a href="#tree" className="liquid-glass rounded-full px-6 py-3 text-[14px] text-white/90 hover:text-white">
            The bloodlines
          </a>
        </motion.div>
      </div>

      <motion.div {...rise(0.65)} className="relative z-10 mx-auto mb-8 w-full max-w-7xl px-5 sm:px-8">
        <div className="relative grid grid-cols-2 border-y border-white/12 sm:grid-cols-5">
          <Plus className="-left-1.5 -top-1.5" />
          <Plus className="-right-1.5 -top-1.5" />
          <Plus className="-bottom-1.5 -left-1.5" />
          <Plus className="-bottom-1.5 -right-1.5" />
          {stats.map(([k, v], i) => (
            <div key={k} className={`px-1 py-4 sm:px-5 ${i > 0 ? "sm:border-l sm:border-white/[0.08]" : ""} ${i === 4 ? "col-span-2 sm:col-span-1" : ""}`}>
              <p className="font-mono text-[10px] tracking-[0.16em] text-white/40">{k}</p>
              <p className="font-mono mt-1.5 text-xl text-white sm:text-2xl">{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2.5 text-[12px] text-white/45">
          <img src="/evolution/heron.webp" alt="" className="h-6 w-6 rounded-full" />
          Kept by the heron. Every birth, death and grade is signed on the public log.
        </div>
      </motion.div>
    </section>
  );
}

function Bar({ value, tone }: { value: number; tone: string }) {
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.07]">
      <motion.div
        className={`h-full rounded-full ${tone}`}
        initial={{ width: 0 }}
        whileInView={{ width: `${Math.round(value * 100)}%` }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease }}
      />
    </div>
  );
}

function Living({ data, onOpen }: { data: Nursery; onOpen: (id: string) => void }) {
  const ranked = useMemo(
    () => data.creatures.filter((c) => !c.diedNight).sort((a, b) => b.fitness - a.fitness || b.window.hits - a.window.hits),
    [data.creatures],
  );
  const scored = (c: Creature) => c.window.hits + c.window.misses;
  const contenders = ranked.filter((c) => scored(c) >= 3);
  const breeding = new Set(contenders.slice(0, 2).map((c) => c.id));
  const atRisk = contenders.length >= 3 ? contenders[contenders.length - 1]!.id : null;
  const answered = new Set(data.exam?.answered ?? []);

  return (
    <section id="living" className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <motion.div {...rise()}>
          <p className="font-mono text-[11px] tracking-[0.18em] text-white/45">AFTER {data.generation} {data.generation === 1 ? "TURN" : "TURNS"}</p>
          <h2 className="font-display mt-3 text-5xl sm:text-6xl">The living</h2>
        </motion.div>
        <motion.p {...rise(0.1)} className="max-w-sm text-[14px] font-light leading-relaxed text-white/55">
          Ranked by how often they were right since the last turn. The two at the top breed next; the one at the bottom will not see it.
        </motion.p>
      </div>

      {data.exam && (
        <motion.div {...rise(0.15)} className="font-mono mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-white/[0.08] py-3 text-[11px] text-white/50">
          <span className="text-white/75">TONIGHT'S EXAM</span>
          <span>{data.exam.tokens.map((t) => `$${t.symbol}`).join("  ")}</span>
          <span className="ml-auto">
            {answered.size}/{ranked.length} answered
          </span>
        </motion.div>
      )}

      <div className="mt-8 grid gap-px overflow-hidden rounded-3xl bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
        {ranked.map((c, i) => {
          const tag = breeding.has(c.id) ? "BREEDS NEXT" : c.id === atRisk ? "AT RISK" : null;
          return (
            <motion.button
              key={c.id}
              type="button"
              {...rise(0.04 * i)}
              onClick={() => onOpen(c.id)}
              className="group relative flex flex-col bg-[#050706] p-6 text-left transition-colors hover:bg-[#0a0d0b]"
            >
              <div className="flex items-start justify-between">
                <span className="font-mono text-[11px] text-white/35">{pad(i + 1)}</span>
                {tag && (
                  <span className={`font-mono text-[10px] tracking-[0.14em] ${tag === "AT RISK" ? "text-rose-200/80" : "text-amber-200/85"}`}>{tag}</span>
                )}
              </div>
              <div className="relative mx-auto mt-4 h-32 w-32">
                <img
                  src={portrait(c.house)}
                  alt=""
                  className="h-full w-full rounded-full transition duration-700 group-hover:scale-[1.04]"
                  loading="lazy"
                />
                {answered.has(c.id) && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]" title="answered tonight" />}
              </div>
              <h3 className="font-display mt-5 text-2xl">{c.name}</h3>
              <p className="mt-1 text-[13px] font-light text-white/50">{c.temperament}</p>
              <div className="mt-5">
                <div className="font-mono mb-2 flex justify-between text-[10.5px] text-white/40">
                  <span>SINCE LAST TURN</span>
                  <span className="text-white/75">{scored(c) ? `${c.window.hits}/${scored(c)}` : "no grades yet"}</span>
                </div>
                <Bar value={scored(c) ? c.window.hits / scored(c) : 0} tone={c.id === atRisk ? "bg-rose-200/70" : breeding.has(c.id) ? "bg-amber-200/80" : "bg-white/60"} />
              </div>
              <p className="font-mono mt-4 text-[10.5px] text-white/35">
                lifetime {pct(c.accuracy)} · gen {c.generation}
                {c.mutation ? " · mutant" : ""}
              </p>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

function Bloodlines({ data, onOpen }: { data: Nursery; onOpen: (id: string) => void }) {
  return (
    <section id="tree" className="relative overflow-hidden py-24 sm:py-32">
      <img src="/evolution/roots.webp" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30" loading="lazy" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#030504_0%,rgba(3,5,4,0.4)_30%,rgba(3,5,4,0.4)_70%,#030504_100%)]" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <motion.div {...rise()} className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] tracking-[0.18em] text-white/45">{data.creatures.length} CREATURES SO FAR</p>
            <h2 className="font-display mt-3 text-5xl sm:text-6xl">The bloodlines</h2>
          </div>
          <p className="max-w-sm text-[14px] font-light leading-relaxed text-white/55">
            Amber threads follow the fitter parent, whose house the child carries. Grey nodes have fallen. Tap anyone to read their DNA.
          </p>
        </motion.div>
        <motion.div {...rise(0.15)} className="mt-12 rounded-3xl bg-black/35 p-4 ring-1 ring-white/10 backdrop-blur-sm sm:p-6">
          <Tree creatures={data.creatures} onOpen={onOpen} />
        </motion.div>
      </div>
    </section>
  );
}

const KIND_MARK: Record<ChronicleEntry["kind"], { label: string; tone: string }> = {
  founded: { label: "FOUNDED", tone: "text-white/60" },
  scored: { label: "GRADED", tone: "text-white/45" },
  death: { label: "DEATH", tone: "text-rose-200/80" },
  birth: { label: "BIRTH", tone: "text-amber-200/85" },
  extinct: { label: "EXTINCT", tone: "text-rose-200/60" },
};

function Chart({ history, nextTurn, curveOn }: { history: Nursery["history"]; nextTurn: string; curveOn: string }) {
  const points = history.filter((h) => h.accuracy !== null);
  if (points.length < 2) {
    return (
      <div className="flex items-center gap-5 py-2">
        <svg viewBox="0 0 120 48" className="h-12 w-28 shrink-0" aria-hidden>
          <path d="M2 40 C 30 38, 40 30, 60 26 S 100 12, 118 6" fill="none" className="stroke-white/15" strokeDasharray="3 4" strokeWidth={1.5} />
          {points.length === 1 && <circle cx={2} cy={40} r={3} className="fill-amber-100" />}
        </svg>
        <p className="text-[13.5px] font-light leading-relaxed text-white/55">
          {points.length === 0 ? (
            <>
              The first point lands with the first turn on <span className="text-white/85">{nextTurn}</span>; the curve appears on <span className="text-white/85">{curveOn}</span>.
            </>
          ) : (
            <>
              One point so far. The curve appears with the next turn on <span className="text-white/85">{nextTurn}</span>.
            </>
          )}
        </p>
      </div>
    );
  }
  const W = 520;
  const H = 190;
  const x = (i: number) => 16 + (i / (points.length - 1)) * (W - 32);
  const y = (a: number) => H - 20 - a * (H - 40);
  const d = points.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p.accuracy!).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g}>
          <line x1={16} x2={W - 16} y1={y(g)} y2={y(g)} className="stroke-white/[0.06]" />
          <text x={W - 14} y={y(g) - 4} textAnchor="end" className="fill-white/30 font-mono text-[9px]">
            {g * 100}%
          </text>
        </g>
      ))}
      <motion.path d={d} fill="none" className="stroke-amber-200/80" strokeWidth={1.5} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease }} />
      {points.map((p, i) => (
        <circle key={p.generation} cx={x(i)} cy={y(p.accuracy!)} r={2.5} className="fill-amber-100" />
      ))}
    </svg>
  );
}

function Tonight({ data }: { data: Nursery }) {
  const byId = new Map(data.creatures.map((c) => [c.id, c]));
  const split = data.exam?.tonight ?? {};
  const answered = Object.entries(split);
  const alive = data.creatures.filter((c) => !c.diedNight).length;
  const turnDay = dayOf(data.night, Math.max(0, data.nextGenerationInNights - 1));
  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2">
      <motion.div {...rise(0.05)} className="rounded-2xl bg-white/[0.02] p-5 ring-1 ring-white/[0.08]">
        <p className="font-mono flex items-center gap-2 text-[10.5px] tracking-[0.14em] text-white/45">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" /> TONIGHT · {answered.length}/{alive} ANSWERED
        </p>
        {answered.length === 0 ? (
          <p className="mt-3 text-[13.5px] font-light text-white/55">
            {data.exam ? "The exam is set. The first answers arrive with the heron's next wake." : "The exam is set once enough fresh tokens have been seen tonight."}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {answered.map(([id, v]) => {
              const c = byId.get(id);
              const total = v.suspicious + v.watch + v.promising || 1;
              return (
                <li key={id} className="flex items-center gap-3 text-[12.5px]">
                  {c && <img src={portrait(c.house)} alt="" className="h-6 w-6 rounded-full" />}
                  <span className="w-20 truncate text-white/80">{c?.name ?? id}</span>
                  <span className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]" title={`${v.suspicious} suspicious, ${v.watch} watch, ${v.promising} promising`}>
                    <span className="bg-rose-200/70" style={{ width: `${(v.suspicious / total) * 100}%` }} />
                    <span className="bg-white/30" style={{ width: `${(v.watch / total) * 100}%` }} />
                    <span className="bg-emerald-200/70" style={{ width: `${(v.promising / total) * 100}%` }} />
                  </span>
                  <span className="font-mono w-16 text-right text-[10.5px] text-white/45">
                    {v.suspicious}·{v.watch}·{v.promising}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {answered.length > 0 && (
          <p className="font-mono mt-3 text-[10px] text-white/30">
            <span className="text-rose-200/70">suspicious</span> · watch · <span className="text-emerald-200/70">promising</span>
          </p>
        )}
      </motion.div>
      <motion.div {...rise(0.1)} className="rounded-2xl bg-white/[0.02] p-5 ring-1 ring-white/[0.08]">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-white/45">COMING UP</p>
        <ol className="mt-3 space-y-3 text-[13.5px] font-light leading-relaxed">
          <li>
            <span className="font-mono block text-[10.5px] text-white/40">{dayOf(data.night)} · AFTER 07:00 UTC</span>
            <span className="text-white/80">Tonight's exam is graded by what actually happened to the tokens.</span>
          </li>
          <li>
            <span className="font-mono block text-[10.5px] text-white/40">
              {turnDay} · TURN {pad(data.generation + 1)}
            </span>
            <span className="text-white/80">The weakest dies and leaves an epitaph. The two best breed; the child carries one mutation.</span>
          </li>
        </ol>
      </motion.div>
    </div>
  );
}

function Chronicle({ data, onOpen }: { data: Nursery; onOpen: (id: string) => void }) {
  const events = data.chronicle.filter((e) => e.kind !== "scored").slice(0, 14);
  const graded = data.chronicle.filter((e) => e.kind === "scored").slice(0, 3);
  return (
    <section className="mx-auto grid max-w-7xl gap-14 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div>
        <motion.div {...rise()}>
          <p className="font-mono text-[11px] tracking-[0.18em] text-white/45">SIGNED ON THE PUBLIC LOG</p>
          <h2 className="font-display mt-3 text-5xl sm:text-6xl">The chronicle</h2>
        </motion.div>
        <Tonight data={data} />
        <ol className="mt-10 border-l border-white/[0.08]">
          {[...events, ...graded].sort((a, b) => b.at - a.at).map((e, i) => (
            <motion.li key={`${e.at}-${i}`} {...rise(0.03 * i)} className="relative pb-7 pl-6">
              <span className="absolute -left-[3.5px] top-1.5 h-[7px] w-[7px] rounded-full bg-[#030504] ring-1 ring-white/30" />
              <p className="font-mono text-[10.5px] tracking-[0.12em] text-white/35">
                <span className={KIND_MARK[e.kind].tone}>{KIND_MARK[e.kind].label}</span> · {e.night} · TURN {pad(e.generation)}
              </p>
              <p className="mt-1.5 text-[14.5px] font-light leading-relaxed text-white/80">{e.text}</p>
              {e.ids[0] && e.kind !== "scored" && (
                <button type="button" onClick={() => onOpen(e.ids[0]!)} className="font-mono mt-1.5 text-[11px] text-white/40 hover:text-white">
                  open →
                </button>
              )}
            </motion.li>
          ))}
        </ol>
      </div>
      <div>
        <motion.div {...rise(0.1)}>
          <p className="font-mono text-[11px] tracking-[0.18em] text-white/45">MEAN ACCURACY PER TURN</p>
          <h3 className="font-display mt-3 text-3xl">Is it working?</h3>
          <p className="mt-3 text-[14px] font-light leading-relaxed text-white/55">
            If selection does its job, the nursery should be right a little more often after every turn. This is the only chart that matters here.
          </p>
        </motion.div>
        <motion.div {...rise(0.2)} className="mt-8 rounded-3xl bg-white/[0.02] p-5 ring-1 ring-white/[0.08]">
          <Chart
            history={data.history}
            nextTurn={dayOf(data.night, Math.max(0, data.nextGenerationInNights - 1))}
            curveOn={dayOf(data.night, Math.max(0, data.nextGenerationInNights - 1) + 3)}
          />
        </motion.div>
        <motion.div {...rise(0.3)} className="mt-8 rounded-3xl bg-white/[0.02] p-6 ring-1 ring-white/[0.08]">
          <p className="font-mono text-[11px] tracking-[0.14em] text-white/40">THE RULES OF THE NURSERY</p>
          <ol className="mt-4 space-y-2.5 text-[13.5px] font-light leading-relaxed text-white/70">
            <li>1. A playbook is fixed for life. Creatures never rewrite their own rules.</li>
            <li>2. Every night all of them answer the same exam of fresh tokens.</li>
            <li>3. A day later each answer is graded by what actually happened.</li>
            <li>4. Every three nights comes a turn: the weakest dies and the two strongest breed.</li>
            <li>5. A child inherits a mix of both playbooks and exactly one mutation.</li>
          </ol>
        </motion.div>
      </div>
    </section>
  );
}

function Waiting({ state }: { state: "loading" | "empty" | "offline" }) {
  return (
    <section className="mx-auto max-w-3xl px-5 py-32 text-center">
      <p className="font-mono text-[11px] tracking-[0.18em] text-white/45">{state === "loading" ? "OPENING THE NURSERY" : state === "empty" ? "NOT YET" : "OFFLINE"}</p>
      <p className="font-display mt-4 text-3xl text-white/85">
        {state === "loading" ? "Listening for the heron…" : state === "empty" ? "The founders arrive with the next wake of the heron." : "The nursery node is unreachable right now."}
      </p>
    </section>
  );
}

export default function EvolutionApp() {
  const { data, state } = useNursery();
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <div className="min-h-screen">
      <Hero data={data} />
      {data ? (
        <>
          <Living data={data} onOpen={setOpen} />
          <Bloodlines data={data} onOpen={setOpen} />
          <Chronicle data={data} onOpen={setOpen} />
        </>
      ) : (
        <Waiting state={state === "ready" ? "loading" : state} />
      )}
      <footer className="font-mono mx-auto flex max-w-7xl flex-wrap justify-between gap-4 border-t border-white/[0.07] px-5 py-8 text-[11px] text-white/35 sm:px-8">
        <span>ZOOAI AGENCY · THE NURSERY</span>
        <span className="flex gap-6">
          <a href="/docs/thinking" className="hover:text-white">
            how judging works
          </a>
          <a href={`${GITHUB_URL}/blob/main/apps/node/src/agents/evolution.ts`} target="_blank" rel="noopener noreferrer" className="hover:text-white">
            the nursery's code ↗
          </a>
        </span>
      </footer>
      <AnimatePresence>{open && <Sheet key={open} id={open} onClose={close} onOpen={setOpen} />}</AnimatePresence>
    </div>
  );
}
