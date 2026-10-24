import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useMemo, useState } from "react";
import { GITHUB_URL } from "../links";
import SiteNav from "../components/SiteNav";
import { type ChronicleEntry, type Creature, dayOf, type Nursery, pad, pct, portrait, useNursery } from "./data";
import Sheet from "./Sheet";
import Tree from "./Tree";
import { pick, t } from "../i18n";

const ease = [0.22, 1, 0.36, 1] as const;
const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.9, delay, ease },
});

function Header() {
  return (
    <div className="absolute inset-x-0 top-0 z-30">
      <SiteNav overlay active="/evolution" />
    </div>
  );
}

/** A thin "+" at a corner, the way instrument panels mark their frame. */
const Plus = ({ className = "" }: { className?: string }) => (
  <span aria-hidden className={`pointer-events-none absolute text-[12.5px] leading-none text-fg-4 ${className}`}>
    +
  </span>
);

function Hero({ data }: { data: Nursery | null }) {
  const alive = data?.creatures.filter((c) => !c.diedNight) ?? [];
  const fallen = (data?.creatures.length ?? 0) - alive.length;
  const houses = new Set(alive.map((c) => c.house)).size;
  const stats: Array<[string, string]> = [
    [t("Turn"), data ? pad(data.generation) : "--"],
    [pick("Alive", "存活"), data ? pad(alive.length) : "--"],
    [t("Fallen"), data ? pad(fallen) : "--"],
    [t("Houses"), data ? `${houses}/8` : "--"],
    [
      t("Next turn"),
      data
        ? data.nextGenerationInNights === 0
          ? t("Tonight")
          : t(data.nextGenerationInNights === 1 ? "{n} night" : "{n} nights", { n: data.nextGenerationInNights })
        : "--",
    ],
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
        <motion.p {...rise(0.1)} className="text-[12.5px] text-fg-4">
          {t("The Nursery · live on Solana")}
        </motion.p>
        <motion.h1 {...rise(0.2)} className="font-display mt-5 max-w-4xl text-[2.9rem] leading-[0.98] sm:text-7xl lg:text-[6rem]">
          {t("Judges that don't learn.")} <span className="accent">{t("They evolve.")}</span>
        </motion.h1>
        <motion.p {...rise(0.35)} className="mt-7 max-w-xl text-[15px] leading-relaxed text-fg-3 sm:text-lg">
          {t("Eight judges carry their rules as DNA. Every night they read the same fresh tokens; a day later reality grades them. Every three nights the weakest dies and the two best breed. Nobody edits their rules. Only selection does.")}
        </motion.p>
        <motion.div {...rise(0.5)} className="mt-9 flex flex-wrap gap-3">
          <a href="#living" className="rounded-full bg-white px-6 py-3 text-[14px] font-medium text-black hover:bg-white/90">
            {t("Meet the living")}
          </a>
          <a href="#tree" className="liquid-glass rounded-full px-6 py-3 text-[14px] text-fg hover:text-white">
            {t("The bloodlines")}
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
              <p className="text-[11.5px] text-fg-4">{k}</p>
              <p className="mt-1.5 text-xl tabular-nums text-white sm:text-2xl">{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2.5 text-[12px] text-fg-3">
          <img src="/evolution/heron.webp" alt="" className="h-6 w-6 rounded-full" />
          {t("Kept by the heron. Every birth, death and grade is signed on the public log.")}
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
    () => data.creatures.filter((c) => !c.diedNight).sort((a, b) => b.fitness - a.fitness || a.window.watched - b.window.watched),
    [data.creatures],
  );
  // Standings come from the node, from the same selection the heron runs at the turn.
  const breeding = new Set(data.preview?.parents ?? []);
  const atRisk = data.preview?.dies ?? null;
  const answered = new Set(data.exam?.answered ?? []);

  return (
    <section id="living" className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <motion.div {...rise()}>
          <p className="text-[12.5px] text-fg-3">{t(data.generation === 1 ? "After {n} turn" : "After {n} turns", { n: data.generation })}</p>
          <h2 className="font-display mt-3 text-5xl sm:text-6xl">{t("The living")}</h2>
        </motion.div>
        <motion.p {...rise(0.1)} className="max-w-sm text-[14px] leading-relaxed text-fg-4">
          {t('Ranked by how well they tell the dead from the living since the last turn. The two at the top breed next; the one at the bottom will not see it. Answering "watch" counts as a miss.')}
        </motion.p>
      </div>

      {data.exam && (
        <motion.div {...rise(0.15)} className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-white/[0.08] py-3 text-[12.5px] text-fg-3">
          <span className="text-fg-3">{t("Tonight's exam")}</span>
          <span>{data.exam.tokens.map((tok) => `$${tok.symbol}`).join("  ")}</span>
          <span className="ml-auto tabular-nums">{t("{a}/{b} answered", { a: answered.size, b: ranked.length })}</span>
        </motion.div>
      )}

      <div className="mt-8 grid gap-px overflow-hidden rounded-3xl bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
        {ranked.map((c, i) => {
          const tag = breeding.has(c.id) ? "breeds" : c.id === atRisk ? (c.starving ? "starving" : "risk") : c.starving ? "starving" : null;
          return (
            <motion.button
              key={c.id}
              type="button"
              {...rise(0.04 * i)}
              onClick={() => onOpen(c.id)}
              className="group relative flex flex-col bg-[#050706] p-6 text-left transition-colors hover:bg-[#0a0d0b]"
            >
              <div className="flex items-start justify-between">
                <span className="text-[12.5px] tabular-nums text-fg-4">{pad(i + 1)}</span>
                {tag && (
                  <span className={`text-[11.5px] ${tag === "breeds" ? "text-warn" : "text-danger"}`}>
                    {tag === "breeds" ? t("Breeds next") : tag === "starving" ? t("Starving") : t("At risk")}
                  </span>
                )}
              </div>
              <div className="relative mx-auto mt-4 h-32 w-32">
                <img
                  src={portrait(c.house)}
                  alt=""
                  className="h-full w-full rounded-full transition duration-700 group-hover:scale-[1.04]"
                  loading="lazy"
                />
                {answered.has(c.id) && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]" title={t("answered tonight")} />}
              </div>
              <h3 className="font-display mt-5 text-2xl">{c.name}</h3>
              <p className="mt-1 text-[13px] text-fg-3">{c.temperament}</p>
              <div className="mt-5">
                <div className="mb-2 flex justify-between text-[12px] text-fg-4">
                  <span>{t("Since last turn")}</span>
                  <span className="tabular-nums text-fg-3">{c.graded ? t("{p} · {n} graded", { p: pct(c.skill), n: c.graded }) : t("no grades yet")}</span>
                </div>
                <Bar value={c.skill ?? 0} tone={c.id === atRisk || c.starving ? "bg-rose-200/70" : breeding.has(c.id) ? "bg-amber-200/80" : "bg-white/60"} />
              </div>
              <p className="mt-4 text-[12px] tabular-nums text-fg-4">
                {t("lifetime {p} · gen {g}", { p: pct(c.lifetimeSkill), g: c.generation })}
                {c.mutation ? ` · ${t("mutant")}` : ""}
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
            <p className="text-[12.5px] text-fg-3">
              {t(data.creatures.length === 1 ? "{n} creature so far" : "{n} creatures so far", { n: data.creatures.length })}
            </p>
            <h2 className="font-display mt-3 text-5xl sm:text-6xl">{t("The bloodlines")}</h2>
          </div>
          <p className="max-w-sm text-[14px] leading-relaxed text-fg-4">
            {t("Amber threads follow the fitter parent, whose house the child carries. Grey nodes have fallen. Tap anyone to read their DNA.")}
          </p>
        </motion.div>
        <motion.div {...rise(0.15)} className="mt-12 rounded-3xl bg-black/35 p-4 ring-1 ring-white/10 backdrop-blur-sm sm:p-6">
          <Tree
            creatures={data.creatures}
            onOpen={onOpen}
            next={{
              on: dayOf(data.night, Math.max(0, data.nextGenerationInNights - 1)),
              parents: data.preview?.parents ?? [],
            }}
          />
        </motion.div>
      </div>
    </section>
  );
}

const KIND_MARK: Record<ChronicleEntry["kind"], { label: string; tone: string }> = {
  founded: { label: "Founded", tone: "text-fg-4" },
  scored: { label: "Graded", tone: "text-fg-3" },
  death: { label: "Death", tone: "text-danger" },
  birth: { label: "Birth", tone: "text-warn" },
  extinct: { label: "Extinct", tone: "text-danger" },
  arrival: { label: "Arrival", tone: "text-moss" },
  correction: { label: "Correction", tone: "text-fg-4" },
  quiet: { label: "Quiet turn", tone: "text-fg-3" },
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
        <p className="text-[13.5px] leading-relaxed text-fg-4">
          {points.length === 0
            ? pick(
                <>
                  The first point lands with the first turn on <span className="text-fg-2">{nextTurn}</span>; the curve appears on <span className="text-fg-2">{curveOn}</span>.
                </>,
                <>
                  第一个点在 <span className="text-fg-2">{nextTurn}</span> 的第一轮落下；曲线在 <span className="text-fg-2">{curveOn}</span> 出现。
                </>,
              )
            : pick(
                <>
                  One point so far. The curve appears with the next turn on <span className="text-fg-2">{nextTurn}</span>.
                </>,
                <>
                  目前只有一个点。曲线会在 <span className="text-fg-2">{nextTurn}</span> 的下一轮出现。
                </>,
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
          <text x={W - 14} y={y(g) - 4} textAnchor="end" className="fill-fg-4 text-[11px] tabular-nums">
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
        <p className="flex items-center gap-2 text-[12px] tabular-nums text-fg-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" /> {t("Tonight · {a}/{b} answered", { a: answered.length, b: alive })}
        </p>
        {answered.length === 0 ? (
          <p className="mt-3 text-[13.5px] text-fg-4">
            {data.exam ? t("The exam is set. The first answers arrive with the heron's next wake.") : t("The exam is set once enough fresh tokens have been seen tonight.")}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {answered.map(([id, v]) => {
              const c = byId.get(id);
              const total = v.suspicious + v.watch + v.promising || 1;
              return (
                <li key={id} className="flex items-center gap-3 text-[12.5px]">
                  {c && <img src={portrait(c.house)} alt="" className="h-6 w-6 rounded-full" />}
                  <span className="w-20 truncate text-fg-2">{c?.name ?? id}</span>
                  <span className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]" title={t("{s} suspicious, {w} watch, {p} promising", { s: v.suspicious, w: v.watch, p: v.promising })}>
                    <span className="bg-rose-200/70" style={{ width: `${(v.suspicious / total) * 100}%` }} />
                    <span className="bg-white/30" style={{ width: `${(v.watch / total) * 100}%` }} />
                    <span className="bg-emerald-200/70" style={{ width: `${(v.promising / total) * 100}%` }} />
                  </span>
                  <span className="w-16 text-right text-[12px] tabular-nums text-fg-3">
                    {v.suspicious}·{v.watch}·{v.promising}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {answered.length > 0 && (
          <p className="mt-3 text-[11.5px] text-fg-4">
            <span className="text-danger">{t("suspicious")}</span> · {t("watch")} · <span className="text-moss">{t("promising")}</span>
          </p>
        )}
      </motion.div>
      <motion.div {...rise(0.1)} className="rounded-2xl bg-white/[0.02] p-5 ring-1 ring-white/[0.08]">
        <p className="text-[12px] text-fg-3">{t("Coming up")}</p>
        <ol className="mt-3 space-y-3 text-[13.5px] leading-relaxed">
          <li>
            <span className="block text-[12px] tabular-nums text-fg-4">{t("{d} · after 07:00 UTC", { d: dayOf(data.night) })}</span>
            <span className="text-fg-2">{t("Tonight's exam is graded by what actually happened to the tokens.")}</span>
          </li>
          <li>
            <span className="block text-[12px] tabular-nums text-fg-4">{t("{d} · turn {n}", { d: turnDay, n: pad(data.generation + 1) })}</span>
            <span className="text-fg-2">{t("The weakest dies and leaves an epitaph. The two best breed; the child carries one mutation.")}</span>
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
          <p className="text-[12.5px] text-fg-3">{t("Signed on the public log")}</p>
          <h2 className="font-display mt-3 text-5xl sm:text-6xl">{t("The chronicle")}</h2>
        </motion.div>
        <Tonight data={data} />
        <ol className="mt-10 border-l border-white/[0.08]">
          {[...events, ...graded].sort((a, b) => b.at - a.at).map((e, i) => (
            <motion.li key={`${e.at}-${i}`} {...rise(0.03 * i)} className="relative pb-7 pl-6">
              <span className="absolute -left-[3.5px] top-1.5 h-[7px] w-[7px] rounded-full bg-[#030504] ring-1 ring-white/30" />
              <p className="text-[12px] tabular-nums text-fg-4">
                <span className={KIND_MARK[e.kind].tone}>{t(KIND_MARK[e.kind].label)}</span> · {t("{d} · turn {n}", { d: e.night, n: pad(e.generation) })}
              </p>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-fg-2">{e.text}</p>
              {e.ids[0] && e.kind !== "scored" && (
                <button type="button" onClick={() => onOpen(e.ids[0]!)} className="mt-1.5 text-[12.5px] text-fg-4 hover:text-white">
                  {t("open")} →
                </button>
              )}
            </motion.li>
          ))}
        </ol>
      </div>
      <div>
        <motion.div {...rise(0.1)}>
          <p className="text-[12.5px] text-fg-3">{t("Mean balanced accuracy per turn")}</p>
          <h3 className="font-display mt-3 text-3xl">{t("Is it working?")}</h3>
          <p className="mt-3 text-[14px] leading-relaxed text-fg-4">
            {t("If selection does its job, the nursery should be right a little more often after every turn. This is the only chart that matters here.")}
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
          <p className="text-[12.5px] text-fg-4">{t("The rules of the nursery")}</p>
          <ol className="mt-4 space-y-2.5 text-[13.5px] leading-relaxed text-fg-3">
            <li>{t("1. A playbook is fixed for life. Creatures never rewrite their own rules.")}</li>
            <li>{t("2. Every night all of them answer the same exam: half fresh launches, half sturdier tokens, so there are living ones to tell apart.")}</li>
            <li>{t("3. A day later each answer is graded by what actually happened. \"Watch\" counts as a miss.")}</li>
            <li>{t("4. The score is balanced: half for calling the dead, half for calling the living. Calling everything dead earns one half.")}</li>
            <li>{t("5. Every three nights comes a turn: the weakest dies and the two strongest breed. With fewer than three living tokens graded, the turn is quiet and nobody dies.")}</li>
            <li>{t("6. A child inherits a mix of both playbooks and exactly one mutation, aimed at what its parents got wrong.")}</li>
            <li>{t("7. Every third turn a stranger arrives instead of a child: the beaver's playbook, a guest's style, or a wild line.")}</li>
          </ol>
        </motion.div>
      </div>
    </section>
  );
}

function Waiting({ state }: { state: "loading" | "empty" | "offline" }) {
  return (
    <section className="mx-auto max-w-3xl px-5 py-32 text-center">
      <p className="text-[12.5px] text-fg-3">{state === "loading" ? t("Opening the nursery") : state === "empty" ? t("Not yet") : t("Offline")}</p>
      <p className="font-display mt-4 text-3xl text-fg-2">
        {state === "loading"
          ? t("Listening for the heron…")
          : state === "empty"
            ? t("The founders arrive with the next wake of the heron.")
            : t("The nursery node is unreachable right now.")}
      </p>
    </section>
  );
}

export default function EvolutionApp() {
  const { data, state } = useNursery();
  // A link like /evolution#c9 (the leaderboard uses it) opens that creature.
  const [open, setOpen] = useState<string | null>(() => (/^#c\d{1,6}$/.test(location.hash) ? location.hash.slice(1) : null));
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
      <footer className="mx-auto flex max-w-7xl flex-wrap justify-between gap-4 border-t border-white/[0.07] px-5 py-8 text-[12.5px] text-fg-4 sm:px-8">
        <span>ZOOAI AGENCY · {t("The Nursery")}</span>
        <span className="flex gap-6">
          <a href="/docs/thinking" className="hover:text-white">
            {t("how judging works")}
          </a>
          <a href={`${GITHUB_URL}/blob/main/apps/node/src/agents/evolution.ts`} target="_blank" rel="noopener noreferrer" className="hover:text-white">
            {t("the nursery's code")} ↗
          </a>
        </span>
      </footer>
      <AnimatePresence>{open && <Sheet key={open} id={open} onClose={close} onOpen={setOpen} />}</AnimatePresence>
    </div>
  );
}
