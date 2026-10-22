import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
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

const STATUS: Record<Status, { label: string; chip: string; dot: string }> = {
  shipped: { label: "shipped", chip: "text-amber-100/85 bg-amber-200/[0.08] ring-amber-200/20", dot: "bg-amber-200 shadow-[0_0_18px_4px_rgba(253,230,138,0.45)]" },
  building: { label: "building", chip: "text-emerald-200/90 bg-emerald-300/[0.08] ring-emerald-300/25", dot: "bg-emerald-300 shadow-[0_0_18px_4px_rgba(110,231,183,0.45)]" },
  next: { label: "next", chip: "text-white/70 bg-white/[0.04] ring-white/15", dot: "bg-[#030504] ring-2 ring-white/50" },
  vote: { label: "holders vote", chip: "text-sky-200/90 bg-sky-300/[0.07] ring-sky-300/25", dot: "bg-[#030504] ring-2 ring-sky-300/70 ring-offset-0 [outline:1px_dashed_rgba(125,211,252,0.5)] [outline-offset:3px]" },
  exploring: { label: "exploring", chip: "text-white/45 bg-white/[0.02] ring-white/10", dot: "bg-white/25" },
};

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

function Chip({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={`font-mono inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] uppercase tracking-[0.12em] ring-1 ${s.chip}`}>{t(s.label)}</span>;
}

function ProofLinks({ proof }: { proof?: Link[] }) {
  if (!proof?.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
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
            className="font-mono inline-flex items-center gap-1 rounded-lg bg-white/[0.04] px-2 py-1 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:bg-white/[0.08] hover:text-white"
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

/** A dot on the trail, centred on the line whatever the screen. */
function Dot({ status }: { status: Status }) {
  return (
    <span aria-hidden className="absolute -left-[32px] top-7 flex h-3.5 w-3.5 items-center justify-center md:-left-[40px]">
      {status === "building" && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-300/40" />}
      <span className={`relative h-3.5 w-3.5 rounded-full ${STATUS[status].dot}`} />
    </span>
  );
}

function Card({ item, metric }: { item: Item; metric: string | null }) {
  const [open, setOpen] = useState(false);
  const why = tx(item, "why", item.why);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="relative"
    >
      <Dot status={item.status} />
      <div
        role={why ? "button" : undefined}
        tabIndex={why ? 0 : undefined}
        onClick={() => why && setOpen((o) => !o)}
        onKeyDown={(e) => why && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((o) => !o))}
        className={`liquid-glass rounded-3xl p-6 sm:p-7 ${why ? "cursor-pointer" : ""} ${item.status === "exploring" ? "opacity-75" : ""}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Chip status={item.status} />
          {item.date && <span className="font-mono text-[11px] text-white/35">{fmtDate(item.date)}</span>}
          {metric && <span className="font-mono ml-auto text-[11px] text-amber-100/70">{metric}</span>}
        </div>
        <h3 className="font-display mt-4 text-2xl leading-tight text-white sm:text-[28px]">{tx(item, "title", item.title)}</h3>
        <p className="mt-2 max-w-2xl text-[14.5px] font-light leading-relaxed text-white/65">{tx(item, "text", item.text)}</p>
        <AnimatePresence initial={false}>
          {open && why && (
            <motion.p
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="max-w-2xl overflow-hidden border-l border-white/15 pl-4 text-[13.5px] font-light leading-relaxed text-white/55"
            >
              <span className="mt-4 block">{why}</span>
            </motion.p>
          )}
        </AnimatePresence>
        {why && <p className="font-mono mt-4 text-[10.5px] uppercase tracking-[0.14em] text-white/35">{open ? t("− less") : t("+ why")}</p>}
        <ProofLinks proof={item.proof} />
      </div>
    </motion.article>
  );
}

/** October: too many shipped things for big cards, so a dense wall of small ones, each with its commit. */
function ShippedWall({ items, metrics }: { items: Item[]; metrics: Record<string, string | null> }) {
  // On a phone the wall would be a long scroll: the first six, then all of it on request.
  const [all, setAll] = useState(false);
  return (
    <div className="relative">
      <Dot status="shipped" />
      <div className="grid gap-px overflow-hidden rounded-3xl bg-white/[0.07] ring-1 ring-white/[0.07] sm:grid-cols-2 xl:grid-cols-3">
        {items.map((it, i) => {
          const m = it.metric ? metrics[it.metric] : null;
          return (
            <motion.div
              key={it.id}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: (i % 6) * 0.05 }}
              className={`group flex-col bg-[#050807]/95 p-5 transition-colors hover:bg-[#0a0f0c] ${i < 6 || all ? "flex" : "hidden sm:flex"}`}
            >
              <div className="font-mono flex items-center justify-between text-[10.5px] text-white/35">
                <span>{it.date ? fmtDate(it.date) : ""}</span>
                <span className="text-amber-100/70">●</span>
              </div>
              <h4 className="font-display mt-3 text-[17px] text-white">{tx(it, "title", it.title)}</h4>
              <p className="mt-1.5 flex-1 text-[13px] font-light leading-relaxed text-white/55">{tx(it, "text", it.text)}</p>
              {m && <p className="font-mono mt-3 text-[11px] text-amber-100/70">{m}</p>}
              <ProofLinks proof={it.proof} />
            </motion.div>
          );
        })}
      </div>
      {!all && items.length > 6 && (
        <button type="button" onClick={() => setAll(true)} className="font-mono mt-3 w-full rounded-2xl py-3 text-[11px] uppercase tracking-[0.14em] text-white/55 ring-1 ring-white/10 sm:hidden">
          {t("show all {n}", { n: items.length })}
        </button>
      )}
    </div>
  );
}

type Filter = "all" | Status;
const FILTERS: Filter[] = ["all", "shipped", "building", "next", "vote", "exploring"];

function Trail({ plan, metrics }: { plan: Plan; metrics: Record<string, string | null> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 70%"] });
  const grow = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: plan.items.length };
    for (const i of plan.items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [plan]);
  const shown = (i: Item) => filter === "all" || i.status === filter;

  return (
    <section id="trail" className="relative px-5 pb-10 sm:px-8">
      <div className="sticky top-[61px] z-30 -mx-5 mb-12 border-b border-white/[0.06] bg-[#030504]/80 px-5 py-3 backdrop-blur-xl sm:top-[69px] sm:-mx-8 sm:px-8">
        <div className="mx-auto flex max-w-7xl gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {FILTERS.filter((f) => counts[f]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`font-mono relative shrink-0 rounded-full px-3.5 py-1.5 text-[11px] uppercase tracking-[0.12em] transition ${filter === f ? "text-black" : "text-white/55 hover:text-white"}`}
            >
              {filter === f && <motion.span layoutId="roadmap-filter" className="absolute inset-0 rounded-full bg-white" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
              <span className="relative">
                {t(f === "all" ? "everything" : STATUS[f].label)} <span className="opacity-50">{counts[f]}</span>
              </span>
            </button>
          ))}
          <a href="#buried" className="font-mono shrink-0 rounded-full px-3.5 py-1.5 text-[11px] uppercase tracking-[0.12em] text-white/40 transition hover:text-white">
            {t("buried")} <span className="opacity-50">{plan.buried.length}</span>
          </a>
        </div>
      </div>

      <div ref={ref} className="relative mx-auto max-w-7xl">
        {/* The trail: a faint line for the whole way, a lit one for how far you have scrolled. */}
        <div aria-hidden className="absolute bottom-0 left-[14px] top-0 w-[2px] bg-white/[0.07] md:left-[250px]" />
        <motion.div
          aria-hidden
          style={{ scaleY: grow }}
          className="absolute bottom-0 left-[14px] top-0 w-[2px] origin-top bg-gradient-to-b from-amber-200 via-emerald-200/80 to-sky-200/30 shadow-[0_0_14px_rgba(253,230,138,0.5)] md:left-[250px]"
        />
        {plan.chapters.map((ch) => {
          const items = plan.items.filter((i) => i.chapter === ch.id && shown(i));
          if (!items.length) return null;
          const wall = ch.id === "2026-10";
          return (
            <motion.div layout key={ch.id} className="relative grid gap-6 pb-20 pl-10 md:grid-cols-[220px_minmax(0,1fr)] md:gap-16 md:pl-0">
              <div className="md:sticky md:top-40 md:self-start md:pr-4 md:text-right">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">{tx(ch, "label", ch.label)}</p>
                <h2 className="font-display mt-2 text-3xl text-white md:text-4xl">{tx(ch, "name", ch.name)}</h2>
                {tx(ch, "line", ch.line) && <p className="mt-3 text-[13.5px] font-light leading-relaxed text-white/50">{tx(ch, "line", ch.line)}</p>}
              </div>
              <div className="grid gap-5">
                {wall ? (
                  <ShippedWall items={items} metrics={metrics} />
                ) : (
                  <AnimatePresence mode="popLayout">
                    {items.map((it) => (
                      <Card key={it.id} item={it} metric={it.metric ? metrics[it.metric] : null} />
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
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
    <section id="vote" className="relative px-5 py-24 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-sky-200/70">{t("Holders' vote · opens in November")}</p>
        <h2 className="font-display mt-3 max-w-4xl text-4xl leading-[1.05] text-white sm:text-6xl">
          {t("Three builds.")} <span className="accent">{t("You set the order.")}</span>
        </h2>
        <p className="mt-5 max-w-xl text-[15px] font-light leading-relaxed text-white/60">
          {t("January, February and March are not decided by us. Holders of $ZOOAGENCY pick which comes first, and the trail above moves to match.")}
        </p>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {options.map((o, i) => (
            <motion.div
              key={o.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: i * 0.1 }}
              className="liquid-glass relative rounded-3xl p-7"
            >
              <span className="font-mono absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-full text-[13px] text-sky-200/80 ring-1 ring-dashed ring-sky-300/40 [outline:1px_dashed_rgba(125,211,252,0.35)] [outline-offset:4px]">?</span>
              <p className="font-mono text-[11px] text-white/35">{String.fromCharCode(65 + i)}</p>
              <h3 className="font-display mt-8 text-2xl text-white">{tx(o, "title", o.title)}</h3>
              <p className="mt-2 text-[13.5px] font-light leading-relaxed text-white/55">{tx(o, "text", o.text)}</p>
            </motion.div>
          ))}
        </div>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl bg-white/[0.07] sm:grid-cols-2 lg:grid-cols-4">
          {rules.map(([h, d], i) => (
            <div key={h} className="bg-[#050807]/95 p-6">
              <p className="font-mono text-[11px] text-white/30">{String(i + 1).padStart(2, "0")}</p>
              <h4 className="mt-5 text-[15.5px] text-white">{t(h)}</h4>
              <p className="mt-2 text-[13px] font-light leading-relaxed text-white/50">{t(d)}</p>
            </div>
          ))}
        </div>
        <a
          href="https://t.me/zooaiagency_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[14px] font-medium text-black transition hover:bg-white/90"
        >
          {t("Get pinged when it opens")} <ArrowUpRight size={15} />
        </a>
      </div>
    </section>
  );
}

function Graveyard({ plan }: { plan: Plan }) {
  return (
    <section id="buried" className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32">
      <div
        aria-hidden
        className="absolute inset-0 bg-[url('/backdrops/strip-nightfall.webp')] bg-cover bg-center opacity-[0.22]"
        style={{ maskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)" }}
      />
      <div className="relative mx-auto max-w-7xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">{t("The clearing")}</p>
        <h2 className="font-display mt-3 max-w-3xl text-4xl leading-[1.05] text-white sm:text-6xl">
          {t("What we buried,")} <span className="accent">{t("and why.")}</span>
        </h2>
        <p className="mt-5 max-w-xl text-[15px] font-light leading-relaxed text-white/60">
          {t("A roadmap that only grows is a wish list. These were planned, some were built, and we dropped them on purpose.")}
        </p>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plan.buried.map((b, i) => (
            <motion.article
              key={b.id}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: i * 0.12, ease: "easeOut" }}
              whileHover={{ y: -6, rotate: i % 2 ? 0.6 : -0.6 }}
              className="relative flex flex-col rounded-b-2xl rounded-t-[999px] bg-gradient-to-b from-white/[0.07] via-white/[0.025] to-emerald-950/30 px-6 pb-6 pt-16 text-center ring-1 ring-white/10"
            >
              <p className="font-mono text-[10.5px] tracking-[0.4em] text-white/35">R.I.P.</p>
              <h3 className="font-display mt-4 text-[22px] leading-tight text-white/90">{tx(b, "title", b.title)}</h3>
              <p className="font-mono mt-3 text-[10.5px] text-white/35">
                {b.born ? `${fmtDate(b.born)} - ${fmtDate(b.buried)} · ${t("lived")} ${days(b.born, b.buried)}${t("d")}` : `${t("never built")} · ${fmtDate(b.buried)}`}
              </p>
              <p className="mt-4 text-[13px] font-light leading-relaxed text-white/45">{tx(b, "text", b.text)}</p>
              <div className="mx-auto my-5 h-px w-12 bg-white/15" />
              <p className="flex-1 text-[14px] leading-relaxed text-white/75">“{tx(b, "reason", b.reason)}”</p>
              <div className="flex justify-center">
                <ProofLinks proof={b.proof} />
              </div>
              <div aria-hidden className="pointer-events-none absolute inset-x-4 -bottom-2 h-6 rounded-full bg-emerald-900/40 blur-xl" />
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
    <section className="relative px-5 pb-28 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="liquid-glass rounded-3xl p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl text-white sm:text-3xl">{t("The trail, today")}</h2>
            <a href={HISTORY} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-white/45 hover:text-white">
              {t("this page is a file · its history")} ↗
            </a>
          </div>
          <ol className="mt-6 divide-y divide-white/[0.06]">
            {commits.recent.map((c) => (
              <li key={c.sha}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="group flex items-baseline gap-4 py-3">
                  <span className="font-mono shrink-0 text-[12px] text-amber-100/70">{c.sha}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-light text-white/65 group-hover:text-white">{c.message}</span>
                  <span className="font-mono shrink-0 text-[11px] text-white/35">{ago(c.at)}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Hero({ plan, commits }: { plan: Plan | null; commits: { total: number | null; recent: Commit[] } | null }) {
  const shipped = plan?.items.filter((i) => i.status === "shipped").length;
  const ahead = plan?.items.filter((i) => i.status !== "shipped").length;
  const last = commits?.recent[0]?.at;
  return (
    <section className="relative flex min-h-[88vh] items-end overflow-hidden px-5 pb-16 pt-32 sm:px-8 sm:pb-24">
      <video
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover opacity-60"
        src="/video/roadmap-1912.mp4"
        poster="/video/roadmap-poster.webp"
        autoPlay
        muted
        loop
        playsInline
      />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#030504] via-[#030504]/55 to-[#030504]/30" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#030504]/80 via-transparent to-transparent" />
      <div className="relative mx-auto w-full max-w-7xl">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }} className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
          {t("Roadmap · Oct 2026 - Apr 2027")}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, ease: "easeOut" }}
          className="font-display mt-4 max-w-4xl text-[52px] leading-[0.95] text-white sm:text-7xl md:text-[96px]"
        >
          {t("The trail.")} <span className="accent">{t("Walked, and ahead.")}</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.25 }} className="mt-6 max-w-xl text-[15.5px] font-light leading-relaxed text-white/65">
          {t("Everything we shipped, with the commit that proves it. Everything next, and the part holders decide. Everything we buried, and why.")}
        </motion.p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.5 }} className="font-mono mt-10 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-white/50">
          {commits?.total != null && (
            <span>
              <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 align-middle" />
              {num(commits.total)} {t("commits since Oct 6")}
            </span>
          )}
          {last && (
            <span>
              {t("last one")} {ago(last)}
            </span>
          )}
          {shipped != null && (
            <span>
              <span className="text-amber-100/80">{shipped}</span> {t("shipped")}
            </span>
          )}
          {ahead != null && (
            <span>
              <span className="text-white/80">{ahead}</span> {t("ahead")}
            </span>
          )}
          {plan && (
            <span>
              {plan.buried.length} {t("buried")}
            </span>
          )}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.7 }}
          className="liquid-glass mt-10 inline-flex flex-col gap-1 rounded-2xl px-5 py-4 sm:flex-row sm:gap-6"
        >
          <p className="text-[13.5px] text-white/80">
            <span className="font-mono mr-2 text-[10.5px] uppercase tracking-[0.14em] text-white/40">{t("free")}</span>
            {t("see who you're buying from")}
          </p>
          <p className="text-[13.5px] text-white/80">
            <span className="font-mono mr-2 text-[10.5px] uppercase tracking-[0.14em] text-amber-100/60">{t("holders")}</span>
            {t("see it first, and decide what we build next")}
          </p>
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
      <Hero plan={plan} commits={commits} />
      {plan ? (
        <>
          <Trail plan={plan} metrics={metrics} />
          <Vote plan={plan} />
          <Graveyard plan={plan} />
          <Today commits={commits} />
        </>
      ) : (
        <div className="font-mono mx-auto max-w-7xl px-5 py-24 text-[12px] text-white/40 sm:px-8">{t("Loading the trail...")}</div>
      )}
    </>
  );
}
