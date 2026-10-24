import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, GitCommit } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NODE_URLS } from "../../sim/live";
import { useLiveNumbers } from "../LiveStats";
import { lang, t } from "../../i18n";

/** The roadmap is one file, /roadmap.json, so every change to the plan is a commit anyone can read. */
type Status = "shipped" | "building" | "next" | "vote" | "exploring";
interface Link {
  label: string;
  href: string;
}
interface Zh {
  when?: string;
  label?: string;
  name?: string;
  line?: string;
  title?: string;
  text?: string;
  why?: string;
  reason?: string;
}
interface Chapter {
  id: string;
  label: string;
  name: string;
  line: string;
  zh?: Zh;
}
interface Item {
  id: string;
  chapter: string;
  status: Status;
  date?: string;
  /** Where in its month it lands, when there is no date yet: "Mid Nov". */
  when?: string;
  title: string;
  text: string;
  why?: string;
  proof?: Link[];
  metric?: string;
  zh?: Zh;
}
interface Buried {
  id: string;
  title: string;
  text: string;
  born?: string;
  buried: string;
  reason: string;
  proof?: Link[];
  zh?: Zh;
}
interface Plan {
  updated: string;
  repo: string;
  chapters: Chapter[];
  items: Item[];
  buried: Buried[];
}

const REPO_API = "https://api.github.com/repos/0xNickdev/aiagentzoo";
const HISTORY = "https://github.com/0xNickdev/aiagentzoo/commits/main/apps/web/public/roadmap.json";
const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const zh = () => lang() === "zh";
/** The Chinese copy of a field when the page is in Chinese and the file has one. */
const tx = (o: { zh?: Zh }, k: keyof Zh, en: string | undefined) => (zh() && o.zh?.[k]) || en || "";
const num = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : num(n));

function usePlan(): Plan | null {
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    fetch("/roadmap.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Plan | null) => p && setPlan(p))
      .catch(() => {});
  }, []);
  return plan;
}

interface Commit {
  sha: string;
  message: string;
  at: number;
  url: string;
}
/** The repo's newest commits and the total count, straight from GitHub; null if GitHub does not answer. */
function useCommits(): { total: number | null; recent: Commit[] } | null {
  const [v, setV] = useState<{ total: number | null; recent: Commit[] } | null>(null);
  useEffect(() => {
    const recent = fetch(`${REPO_API}/commits?per_page=6`).then((r) => (r.ok ? r.json() : []));
    // One commit per page: the last page's number is the commit count.
    const total = fetch(`${REPO_API}/commits?per_page=1`).then((r) => {
      const m = /[?&]page=(\d+)>; rel="last"/.exec(r.headers.get("link") ?? "");
      return m ? Number(m[1]) : null;
    });
    Promise.all([recent, total])
      .then(([list, count]) =>
        setV({
          total: count,
          recent: (list as Array<{ sha: string; html_url: string; commit: { message: string; committer: { date: string } } }>).map((c) => ({
            sha: c.sha.slice(0, 7),
            message: c.commit.message.split("\n")[0],
            at: Date.parse(c.commit.committer.date),
            url: c.html_url,
          })),
        }),
      )
      .catch(() => {});
  }, []);
  return v;
}

interface Chain {
  seen: { launches: number; trades: number; launchlab?: number; dbc?: number };
  perMinute: { trades: number };
}
interface Usage {
  days: Array<{ xrays: number; checks: number }>;
}
function useNorth<T>(path: string): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (!NORTH) return;
    fetch(`${NORTH}${path}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: T | null) => b && setV(b))
      .catch(() => {});
  }, [path]);
  return v;
}

/** The live reading that sits on a shipped card, or null while it is unknown. */
function useMetrics(): Record<string, string | null> {
  const live = useLiveNumbers();
  const chain = useNorth<Chain>("/v1/chain");
  const usage = useNorth<Usage>("/v1/usage");
  const sum = (k: "xrays" | "checks") => (usage ? usage.days.reduce((s, d) => s + d[k], 0) : null);
  const xrays = sum("xrays");
  const checks = sum("checks");
  const rec = live?.stats?.record;
  return {
    logEntries: live ? `${num(live.entries)} ${t("log entries")}` : null,
    briefs: live?.briefs != null ? `${num(live.briefs)} ${t("issues")}` : null,
    beaver: rec?.warnedDead != null ? `${num(rec.warnedDead)} ${t("warned, then died")}` : null,
    guests: live?.guests != null ? `${num(live.guests)} ${t("guests")}` : null,
    trades: chain ? `${compact(chain.seen.trades)} ${t("trades read")}` : null,
    launches: chain ? `${compact(chain.seen.launches + (chain.seen.launchlab ?? 0) + (chain.seen.dbc ?? 0))} ${t("launches read")}` : null,
    tradesPerMin: chain ? `${num(chain.perMinute.trades)} ${t("trades / min now")}` : null,
    xrays: xrays != null ? `${num(xrays)} ${t("x-rays this week")}` : null,
    checks: checks != null ? `${num(checks)} ${t("checks this week")}` : null,
  };
}

function ago(at: number): string {
  const m = Math.max(1, Math.round((Date.now() - at) / 60_000));
  if (m < 60) return `${m}${t("m ago")}`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}${t("h ago")}` : `${Math.round(h / 24)}${t("d ago")}`;
}
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(zh() ? "zh-CN" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const days = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1);


/** Status marks: white hairlines, amber only where something is lit. */
const STATUS: Record<Status, { label: string; mark: string; tone: string }> = {
  shipped: { label: "shipped", mark: "●", tone: "text-warn" },
  building: { label: "building", mark: "◐", tone: "text-warn" },
  next: { label: "next", mark: "○", tone: "text-fg-4" },
  vote: { label: "holders vote", mark: "◇", tone: "text-fg-4" },
  exploring: { label: "exploring", mark: "·", tone: "text-fg-4" },
};

/** Which of the four frames of the trail sits behind each part of the page. */
const SCENES = [
  { src: "/backdrops/roadmap-trail.webp" },
  { src: "/backdrops/roadmap-trail-2.webp" },
  { src: "/backdrops/roadmap-trail-3.webp" },
  { src: "/backdrops/roadmap-clearing.webp", mobile: "/backdrops/roadmap-clearing-mobile.webp" },
];
const CHAPTER_SCENE: Record<string, number> = { "2026-10": 0, "2026-11": 1, "2026-12": 2, later: 2 };
/** How deep in the fog a chapter sits: the further ahead, the softer until you reach for it. */
const CHAPTER_FOG: Record<string, string> = { "2026-12": "fog-1", later: "fog-2" };

/** Seconds into the trail film where each part of the page sits: the walk starts at the top and stops in the clearing. */
const FILM = { dec: 7, fog: 11, clearing: 16.5, end: 19.9 };
const VIDEO_DESKTOP = "/video/trail-1920.mp4";
const VIDEO_MOBILE = "/video/trail-1080.mp4";

/**
 * The camera. One film of the forest path, scrubbed by the scroll: the top of the page is the start of the trail,
 * December is where a sphere catches fire, the months holders pick are in the fog, and the buried ideas are the
 * clearing at the end. The four stills sit underneath and cross-fade by section until the film is ready, and for
 * anyone who asked for less motion they are all there is.
 */
function Scene() {
  const [active, setActive] = useState(0);
  const [film, setFilm] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const still = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.scene ?? 0));
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    const watch = () => document.querySelectorAll("[data-scene]").forEach((el) => io.observe(el));
    watch();
    // Sections mount after the plan loads: look again once they are there.
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v || still) return;
    let raf = 0;
    let shown = 0;
    const top = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().top + window.scrollY : null;
    };
    // Where the page should be in the film: straight lines between the section marks.
    const target = () => {
      const y = window.scrollY + window.innerHeight * 0.5;
      const end = document.documentElement.scrollHeight;
      const marks: Array<[number | null, number]> = [
        [0, 0],
        [top('[data-scene="1"]'), FILM.dec],
        [top('[data-scene="2"]'), FILM.fog],
        [top("#buried"), FILM.clearing],
        [end, FILM.end],
      ];
      const pts = marks.filter((m): m is [number, number] => m[0] != null).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < pts.length; i++) {
        const [y0, t0] = pts[i - 1];
        const [y1, t1] = pts[i];
        if (y <= y1) return t0 + ((t1 - t0) * Math.max(0, y - y0)) / Math.max(1, y1 - y0);
      }
      return FILM.end;
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (v.readyState < 2 || v.seeking) return;
      const want = target();
      // Ease toward the scroll so a flick of the wheel glides instead of jumping frames.
      shown += (want - shown) * 0.14;
      if (Math.abs(v.currentTime - shown) > 1 / 30) v.currentTime = shown;
    };
    const ready = () => setFilm(true);
    v.addEventListener("loadeddata", ready);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("loadeddata", ready);
    };
  }, [still]);

  const src = typeof window !== "undefined" && window.innerWidth <= 820 ? VIDEO_MOBILE : VIDEO_DESKTOP;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#030504]">
      {SCENES.map((s, i) => (
        <picture key={s.src}>
          {s.mobile && <source media="(max-width: 640px)" srcSet={s.mobile} />}
          <img
            src={s.src}
            alt=""
            loading={i === 0 ? "eager" : "lazy"}
            className="absolute inset-0 h-full w-full scale-105 object-cover transition-opacity duration-[1600ms] ease-out"
            style={{ opacity: !film && active === i ? 1 : 0, objectPosition: "58% 50%" }}
          />
        </picture>
      ))}
      {!still && (
        <video
          ref={video}
          src={src}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000"
          style={{ opacity: film ? 1 : 0, objectPosition: "58% 50%" }}
        />
      )}
      {/* Mist that drifts on its own, thicker deeper in. */}
      <div className="roadmap-fog absolute inset-0 transition-opacity duration-[1600ms]" style={{ opacity: active === 2 ? 0.7 : active === 3 ? 0.35 : 0.25 }} />
      <Fireflies />
      {/* Reading light: dark on the left where the text sits, and at the bottom. */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#030504]/90 via-[#030504]/60 to-[#030504]/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#030504]/80 via-transparent to-[#030504]/40" />
    </div>
  );
}

/** A few dozen points of warm light, placed the same way every time, each on its own slow loop. */
function Fireflies() {
  const flies = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => {
        const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
        return { left: 30 + r(1) * 68, top: 35 + r(2) * 60, delay: r(3) * 9, dur: 6 + r(4) * 7, size: 2 + r(5) * 2.5 };
      }),
    [],
  );
  return (
    <div className="absolute inset-0">
      {flies.map((f, i) => (
        <span
          key={i}
          className="roadmap-firefly absolute rounded-full bg-amber-200"
          style={{ left: `${f.left}%`, top: `${f.top}%`, width: f.size, height: f.size, animationDelay: `${f.delay}s`, animationDuration: `${f.dur}s` }}
        />
      ))}
    </div>
  );
}

/** A hairline with a "+" at each end, the page's only ornament. */
function Rule({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`relative h-px bg-white/[0.12] ${className}`}>
      <span className="tabular-nums absolute -left-[3px] -top-[9px] text-[12.5px] text-fg-4">+</span>
      <span className="tabular-nums absolute -right-[3px] -top-[9px] text-[12.5px] text-fg-4">+</span>
    </div>
  );
}

function Mark({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className={`tabular-nums inline-flex items-center gap-1.5 text-[12px] [&::first-letter]:uppercase ${s.tone}`}>
      <span className={status === "building" ? "animate-pulse" : ""}>{s.mark}</span>
      {t(s.label)}
    </span>
  );
}

function ProofLinks({ proof, className = "mt-4" }: { proof?: Link[]; className?: string }) {
  if (!proof?.length) return null;
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-1.5 ${className}`}>
      {proof.map((p) => {
        const sha = /^[0-9a-f]{7}$/.test(p.label) || p.label.includes(" ");
        const external = p.href.startsWith("http");
        return (
          <a
            key={p.href}
            href={p.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            onClick={(e) => e.stopPropagation()}
            className="tabular-nums inline-flex items-center gap-1 border-b border-white/15 pb-px text-[12.5px] text-fg-4 transition hover:border-white/60 hover:text-white"
          >
            {sha ? <GitCommit size={11} className="opacity-60" /> : null}
            {p.label}
            {external && <ArrowUpRight size={10} className="opacity-50" />}
          </a>
        );
      })}
    </div>
  );
}

/** One item ahead: a hairline row, the reason behind it one tap away. */
function Row({ item, metric }: { item: Item; metric: string | null }) {
  const [open, setOpen] = useState(false);
  const why = tx(item, "why", item.why);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="roadmap-row group"
    >
      <Rule />
      <div
        role={why ? "button" : undefined}
        tabIndex={why ? 0 : undefined}
        aria-expanded={why ? open : undefined}
        onClick={() => why && setOpen((o) => !o)}
        onKeyDown={(e) => why && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((o) => !o))}
        className={`grid gap-3 py-7 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-8 ${why ? "cursor-pointer" : ""}`}
      >
        <div className="flex items-center justify-between gap-3 sm:block">
          <Mark status={item.status} />
          {item.date ? (
            <p className="tabular-nums text-[12.5px] text-fg-4 sm:mt-2">{fmtDate(item.date)}</p>
          ) : (
            item.when && <p className="tabular-nums text-[12.5px] text-fg-3 sm:mt-2">{tx(item, "when", item.when)}</p>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h3 className="font-display text-[26px] leading-tight text-white sm:text-[32px]">{tx(item, "title", item.title)}</h3>
            {metric && <span className="tabular-nums text-[13px] text-warn">{metric}</span>}
          </div>
          <p className="mt-2 max-w-2xl text-[14.5px] font-normal leading-relaxed text-fg-3">{tx(item, "text", item.text)}</p>
          <AnimatePresence initial={false}>
            {open && why && (
              <motion.p
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.35 }}
                className="max-w-2xl overflow-hidden text-[13.5px] font-normal leading-relaxed text-fg-3"
              >
                <span className="mt-4 block border-l border-amber-100/30 pl-4">{why}</span>
              </motion.p>
            )}
          </AnimatePresence>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            {why && <span className="tabular-nums text-[12px] [&::first-letter]:uppercase text-fg-4 group-hover:text-fg-4">{open ? t("− less") : t("+ why")}</span>}
            <ProofLinks proof={item.proof} className="" />
          </div>
        </div>
      </div>
    </motion.article>
  );
}

/** October in one screen: every shipped thing a cell; point at one and its commit and number open beside. */
function ShippedMatrix({ items, metrics }: { items: Item[]; metrics: Record<string, string | null> }) {
  const [sel, setSel] = useState(items[items.length - 1]?.id ?? "");
  const cur = items.find((i) => i.id === sel) ?? items[0];
  const m = cur?.metric ? metrics[cur.metric] : null;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div>
        <Rule />
        <div className="grid grid-cols-2 sm:grid-cols-3">
          {items.map((it) => {
            const on = it.id === cur?.id;
            return (
              <button
                key={it.id}
                type="button"
                onMouseEnter={() => setSel(it.id)}
                onFocus={() => setSel(it.id)}
                onClick={() => setSel(it.id)}
                className={`relative border-b border-white/[0.08] px-3 py-3.5 text-left transition-colors ${on ? "bg-amber-100/[0.06]" : "hover:bg-white/[0.03]"}`}
              >
                <span className="tabular-nums flex items-center gap-1.5 text-[11.5px] text-fg-4">
                  <span className={on ? "text-warn" : "text-warn"}>●</span>
                  {it.date ? fmtDate(it.date) : ""}
                </span>
                <span className={`mt-1 block truncate text-[13.5px] ${on ? "text-white" : "text-fg-3"}`}>{tx(it, "title", it.title)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {cur && (
        <AnimatePresence mode="wait">
          <motion.div key={cur.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="lg:pt-6">
            <Mark status="shipped" />
            <p className="tabular-nums mt-2 text-[12.5px] text-fg-4">{cur.date ? fmtDate(cur.date) : ""}</p>
            <h3 className="font-display mt-4 text-[34px] leading-tight text-white">{tx(cur, "title", cur.title)}</h3>
            <p className="mt-3 text-[15px] font-normal leading-relaxed text-fg-3">{tx(cur, "text", cur.text)}</p>
            {m && <p className="tabular-nums mt-5 text-[13px] text-warn">{m}</p>}
            <ProofLinks proof={cur.proof} className="mt-6" />
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

type Filter = "all" | Status;
const FILTERS: Filter[] = ["all", "shipped", "building", "next", "vote", "exploring"];

function Trail({ plan, metrics }: { plan: Plan; metrics: Record<string, string | null> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: plan.items.length };
    for (const i of plan.items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [plan]);
  const shown = (i: Item) => filter === "all" || i.status === filter;

  return (
    <section id="trail" className="relative">
      <div className="sticky top-[61px] z-30 border-b border-white/[0.08] bg-[#030504]/55 px-5 py-3 backdrop-blur-xl sm:top-[69px] sm:px-8">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto [scrollbar-width:none]">
          {FILTERS.filter((f) => counts[f]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`tabular-nums relative shrink-0 px-3 py-1.5 text-[12px] [&::first-letter]:uppercase transition ${filter === f ? "text-white" : "text-fg-3 hover:text-fg-2"}`}
            >
              {filter === f && <motion.span layoutId="roadmap-filter" className="absolute inset-x-2 -bottom-[13px] h-px bg-amber-200" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
              {t(f === "all" ? "everything" : STATUS[f].label)} <span className="opacity-50">{counts[f]}</span>
            </button>
          ))}
          <a href="#buried" className="tabular-nums shrink-0 px-3 py-1.5 text-[12px] [&::first-letter]:uppercase text-fg-4 transition hover:text-fg-2">
            {t("buried")} <span className="opacity-50">{plan.buried.length}</span>
          </a>
        </div>
      </div>

      {plan.chapters.map((ch, n) => {
        const items = plan.items.filter((i) => i.chapter === ch.id && shown(i));
        if (!items.length) return null;
        const wall = ch.id === "2026-10";
        const line = tx(ch, "line", ch.line);
        return (
          <motion.div
            layout
            key={ch.id}
            data-scene={CHAPTER_SCENE[ch.id] ?? 0}
            className={`relative flex min-h-[100svh] items-center px-5 py-24 sm:px-8 ${CHAPTER_FOG[ch.id] ?? ""}`}
          >
            <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-16">
              <div className="lg:sticky lg:top-40 lg:self-start">
                <p className="tabular-nums text-[12.5px] uppercase tracking-[0.2em] text-fg-4">
                  {String(n + 1).padStart(2, "0")} / {String(plan.chapters.length).padStart(2, "0")} · {tx(ch, "label", ch.label)}
                </p>
                <h2 className="font-display mt-3 text-5xl leading-none text-white sm:text-6xl">{tx(ch, "name", ch.name)}</h2>
                {line && <p className="mt-5 max-w-xs text-[14px] font-normal leading-relaxed text-fg-4">{line}</p>}
              </div>
              <div className="roadmap-chapter-body">
                {wall ? (
                  <ShippedMatrix items={items} metrics={metrics} />
                ) : (
                  <>
                    <AnimatePresence mode="popLayout">
                      {items.map((it) => (
                        <Row key={it.id} item={it} metric={it.metric ? metrics[it.metric] : null} />
                      ))}
                    </AnimatePresence>
                    <Rule />
                  </>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </section>
  );
}

function Vote({ plan }: { plan: Plan }) {
  const options = plan.items.filter((i) => i.status === "vote");
  const rules = [
    ["One wallet, one signed vote", "Every vote is a wallet signature, published, so anyone can count again."],
    ["Bought for the vote does not pay", "Balance is read when the vote opens and when it closes. The smaller one counts."],
    ["A bundle is one voter", "Wallets our own bundle detector ties together count as one. So do pools, the team and the dev."],
    ["The result on chain", "At the close, a hash of every vote and every balance goes into one Solana transaction."],
  ];
  return (
    <section id="vote" data-scene={2} className="relative flex min-h-[100svh] items-center px-5 py-24 sm:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <p className="tabular-nums text-[12.5px] uppercase tracking-[0.2em] text-fg-3">{t("Holders' vote · end of November")}</p>
        <h2 className="font-display mt-3 max-w-4xl text-5xl leading-[1.02] text-white sm:text-7xl">
          {t("Two builds.")} <span className="accent">{t("You set the order.")}</span>
        </h2>
        <p className="mt-5 max-w-xl text-[15px] font-normal leading-relaxed text-fg-4">
          {t("December's two builds both ship by the end of the year. Holders of $ZOOAGENCY pick which comes first, and the trail above moves to match.")}
        </p>
        <div className="mt-14 grid gap-x-10 md:grid-cols-2">
          {options.map((o, i) => (
            <div key={o.id} className="pb-8">
              <Rule />
              <div className="flex items-baseline justify-between pt-6">
                <span className="tabular-nums text-[12.5px] text-fg-4">{String.fromCharCode(65 + i)}</span>
                <span className="tabular-nums text-[12.5px] text-fg-4">? / 2</span>
              </div>
              <h3 className="font-display mt-6 text-[28px] leading-tight text-white">{tx(o, "title", o.title)}</h3>
              <p className="mt-2 text-[13.5px] font-normal leading-relaxed text-fg-4">{tx(o, "text", o.text)}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
          {rules.map(([h, d], i) => (
            <div key={h} className="pb-6">
              <Rule />
              <p className="tabular-nums pt-5 text-[12.5px] text-fg-4">{String(i + 1).padStart(2, "0")}</p>
              <h4 className="mt-3 text-[15px] text-white">{t(h)}</h4>
              <p className="mt-1.5 text-[13px] font-normal leading-relaxed text-fg-3">{t(d)}</p>
            </div>
          ))}
        </div>
        <a
          href="https://t.me/zooaiagency_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[14px] font-medium text-black transition hover:bg-white/90"
        >
          {t("Get pinged when it opens")} <ArrowUpRight size={15} />
        </a>
      </div>
    </section>
  );
}

function Graveyard({ plan }: { plan: Plan }) {
  return (
    <section id="buried" data-scene={3} className="relative flex min-h-[100svh] items-end px-5 pb-24 pt-40 sm:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <p className="tabular-nums text-[12.5px] uppercase tracking-[0.2em] text-fg-3">{t("The clearing")}</p>
        <h2 className="font-display mt-3 max-w-3xl text-5xl leading-[1.02] text-white sm:text-7xl">
          {t("What we buried,")} <span className="accent">{t("and why.")}</span>
        </h2>
        <p className="mt-5 max-w-xl text-[15px] font-normal leading-relaxed text-fg-4">
          {t("A roadmap that only grows is a wish list. These were planned, some were built, and we dropped them on purpose.")}
        </p>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plan.buried.map((b, i) => (
            <motion.article
              key={b.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: i * 0.12, ease: "easeOut" }}
              className="relative flex flex-col rounded-t-[999px] border border-b-0 border-white/[0.14] bg-[#030504]/55 px-6 pb-7 pt-16 text-center backdrop-blur-md"
            >
              <p className="tabular-nums text-[12px] tracking-[0.4em] text-fg-4">R.I.P.</p>
              <h3 className="font-display mt-4 text-[22px] leading-tight text-fg">{tx(b, "title", b.title)}</h3>
              <p className="tabular-nums mt-3 text-[12px] text-fg-4">
                {b.born ? `${fmtDate(b.born)} - ${fmtDate(b.buried)} · ${t("lived")} ${days(b.born, b.buried)}${t("d")}` : `${t("never built")} · ${fmtDate(b.buried)}`}
              </p>
              <p className="mt-4 text-[13px] font-normal leading-relaxed text-fg-3">{tx(b, "text", b.text)}</p>
              <div className="mx-auto my-5 h-px w-10 bg-white/20" />
              <p className="flex-1 text-[14px] leading-relaxed text-fg-2">“{tx(b, "reason", b.reason)}”</p>
              <div className="flex justify-center">
                <ProofLinks proof={b.proof} className="mt-5" />
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Today({ commits }: { commits: { total: number | null; recent: Commit[] } | null }) {
  if (!commits?.recent.length) return null;
  return (
    <section data-scene={3} className="relative px-5 pb-28 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-baseline justify-between gap-3 pb-5">
          <h2 className="font-display text-2xl text-white sm:text-3xl">{t("The trail, today")}</h2>
          <a href={HISTORY} target="_blank" rel="noopener noreferrer" className="tabular-nums text-[12.5px] text-fg-3 hover:text-white">
            {t("this page is a file · its history")} ↗
          </a>
        </div>
        <Rule />
        <ol>
          {commits.recent.map((c) => (
            <li key={c.sha} className="border-b border-white/[0.08]">
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="group flex items-baseline gap-4 py-3.5">
                <span className="tabular-nums shrink-0 text-[12px] text-warn">{c.sha}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-normal text-fg-4 group-hover:text-white">{c.message}</span>
                <span className="tabular-nums shrink-0 text-[12.5px] text-fg-4">{ago(c.at)}</span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Hero({ plan, commits }: { plan: Plan | null; commits: { total: number | null; recent: Commit[] } | null }) {
  const shipped = plan?.items.filter((i) => i.status === "shipped").length;
  const ahead = plan?.items.filter((i) => i.status !== "shipped").length;
  const last = commits?.recent[0]?.at;
  const stats: Array<[string | number | null | undefined, string]> = [
    [commits?.total, t("commits since Oct 6")],
    [shipped, t("shipped")],
    [ahead, t("ahead")],
    [plan?.buried.length, t("buried")],
  ];
  return (
    <section data-scene={0} className="relative flex min-h-[100svh] items-end px-5 pb-16 pt-32 sm:px-8 sm:pb-20">
      <div className="mx-auto w-full max-w-7xl">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }} className="tabular-nums text-[12.5px] uppercase tracking-[0.22em] text-fg-4">
          {t("Roadmap · Oct - Dec 2026")}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          className="font-display mt-4 max-w-4xl text-[56px] leading-[0.95] text-white sm:text-8xl md:text-[112px]"
        >
          {t("The trail.")} <span className="accent">{t("Walked, and ahead.")}</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.3 }} className="mt-7 max-w-lg text-[15.5px] font-normal leading-relaxed text-fg-3">
          {t("Everything we shipped, with the commit that proves it. Everything next, and the part holders decide. Everything we buried, and why.")}
        </motion.p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.55 }} className="mt-12 max-w-4xl">
          <Rule />
          <div className="grid grid-cols-2 sm:grid-cols-4">
            {stats.map(([v, k]) => (
              <div key={k} className="py-5 pr-4">
                <p className="tabular-nums text-[28px] leading-none text-white sm:text-[34px]">{v == null ? "-" : num(Number(v))}</p>
                <p className="tabular-nums mt-2 text-[12px] [&::first-letter]:uppercase text-fg-4">{k}</p>
              </div>
            ))}
          </div>
          <Rule />
          <div className="tabular-nums flex flex-wrap items-center gap-x-8 gap-y-2 pt-4 text-[12px] text-fg-4">
            {last && (
              <span>
                <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-200 align-middle" />
                {t("last one")} {ago(last)}
              </span>
            )}
            <span>
              <span className="text-fg-4">{t("free")}</span> {t("see who you're buying from")}
            </span>
            <span>
              <span className="text-warn">{t("holders")}</span> {t("see it first, and decide what we build next")}
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default function RoadmapPage() {
  const plan = usePlan();
  const commits = useCommits();
  const metrics = useMetrics();
  return (
    <>
      <Scene />
      <Hero plan={plan} commits={commits} />
      {plan ? (
        <>
          <Trail plan={plan} metrics={metrics} />
          <Vote plan={plan} />
          <Graveyard plan={plan} />
          <Today commits={commits} />
        </>
      ) : (
        <div className="tabular-nums mx-auto max-w-7xl px-5 py-24 text-[12px] text-fg-4 sm:px-8">{t("Loading the trail...")}</div>
      )}
    </>
  );
}
