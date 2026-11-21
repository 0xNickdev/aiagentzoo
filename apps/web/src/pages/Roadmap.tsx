import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { GITHUB_URL, GitHubIcon } from "../links";
import { lang, pick, t } from "../i18n";
import Timeline, { Corners } from "../components/roadmap/Timeline";
import Now from "../components/roadmap/Now";
import { CUT, EXPLORING, NEXT, PARKED, type Planned, SHIPPED, type Shipped, UPDATED } from "../components/roadmap/data";

const zh = () => lang() === "zh";
const day = (iso: string, year = false) =>
  new Date(iso).toLocaleDateString(zh() ? "zh-CN" : "en-GB", { day: "numeric", month: "short", year: year ? "numeric" : undefined, timeZone: "UTC" });

/** A block that rises in once, when it comes up the screen. */
function Rise({ children, className = "" }: { children: ReactNode; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    const io = new IntersectionObserver(
      ([x]) => {
        if (!x?.isIntersecting) return;
        e.setAttribute("data-in", "true");
        io.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(e);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={el} className={`rm-rise ${className}`}>
      {children}
    </div>
  );
}

/** A section's head: a mono counter on the right, a tag, then the heading with one part in grey. */
function Head({ n, tag, title, grey, lead, id }: { n: number; tag: string; title: string; grey: string; lead?: string; id: string }) {
  return (
    <div id={id} className="scroll-mt-20">
      <p className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        <span className="inline-flex h-[22px] items-center rounded-[4px] border border-line-2 px-2 text-fg-3">{t(tag)}</span>
        <span>
          <span className="text-white">{String(n).padStart(2, "0")}</span> / 04
        </span>
      </p>
      <h2 className="mt-6 max-w-[18ch] text-[clamp(30px,5vw,56px)] font-semibold leading-[1] tracking-[-0.045em] text-white">
        {t(title)} <span className="text-faint">{t(grey)}</span>
      </h2>
      {lead && <p className="mt-5 max-w-[62ch] text-[15px] leading-[1.6] text-fg-3 sm:text-[16px]">{t(lead)}</p>}
    </div>
  );
}

/* ---------- shipped: the ledger ---------- */

type Filter = "all" | "live" | "cut";
/** A chapter longer than this shows its newest rows and a button for the rest. */
const FOLD = 8;
const CHAPTERS: Array<{ id: string; from: string; to: string; label: string; name: string }> = [
  { id: "rebuild", from: "2026-11-15", to: "2026-12-31", label: "15 - 21 Nov", name: "The final and the rebuild" },
  { id: "own", from: "2026-11-01", to: "2026-11-14", label: "1 - 14 Nov", name: "Own ground" },
  { id: "built", from: "2026-10-01", to: "2026-10-31", label: "6 - 31 Oct", name: "Built" },
];

function Row({ s }: { s: Shipped }) {
  const z = zh() ? s.zh : undefined;
  const gone = !!s.cut && /^cut 20 Nov$/.test(s.cut);
  return (
    <li className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 border-t border-line py-3.5 first:border-t-0 sm:grid-cols-[64px_minmax(0,1fr)]">
      <span className="pt-[3px] font-mono text-[11px] uppercase tracking-[0.04em] text-faint">{day(s.date)}</span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-[14.5px] font-medium tracking-[-0.01em] ${gone ? "text-dim line-through decoration-[#4a524e]" : "text-white"}`}>{z?.title ?? s.title}</span>
          {s.milestone && <span className="rounded-[4px] bg-white px-1.5 font-mono text-[10px] uppercase leading-[18px] tracking-[0.08em] text-night">{t("Milestone")}</span>}
          {s.cut && <span className="rounded-[4px] border border-dashed border-[#4a524e] px-1.5 font-mono text-[10px] uppercase leading-[16px] tracking-[0.06em] text-dim">{pick(s.cut, s.cutZh ?? s.cut)}</span>}
        </p>
        <p className="mt-1 text-[13px] leading-[1.55] text-fg-4">{z?.text ?? s.text}</p>
        {s.why && <p className="mt-1.5 border-l border-line-2 pl-2.5 text-[12.5px] leading-[1.55] text-dim">{z?.why ?? s.why}</p>}
        {s.proof.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {s.proof.map((p) => (
              <a key={p.href} href={p.href} target="_blank" rel="noopener noreferrer" className="inline-flex h-[22px] items-center rounded-[4px] border border-line-2 px-1.5 font-mono text-[10.5px] text-fg-3 hover:border-[#4a524e] hover:text-white">
                {p.label}
              </a>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

function Ledger() {
  const [f, setF] = useState<Filter>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const rows = useMemo(() => SHIPPED.filter((s) => (f === "all" ? true : f === "cut" ? !!s.cut : !s.cut)), [f]);
  const counts = { all: SHIPPED.length, live: SHIPPED.filter((s) => !s.cut).length, cut: SHIPPED.filter((s) => !!s.cut).length };
  const tab = (id: Filter, label: string) => (
    <button key={id} type="button" onClick={() => setF(id)} aria-pressed={f === id} className={`inline-flex h-8 items-center gap-2 rounded-[6px] px-3 text-[12.5px] transition-colors ${f === id ? "bg-white font-medium text-night" : "text-fg-3 hover:text-white"}`}>
      {t(label)}
      <span className={`font-mono text-[10.5px] ${f === id ? "text-night" : "text-faint"}`}>{counts[id]}</span>
    </button>
  );
  return (
    <>
      <div className="mt-8 inline-flex gap-0.5 rounded-[8px] border border-line-2 p-0.5" role="group" aria-label={t("Filter")}>
        {tab("all", "All")}
        {tab("live", "Live today")}
        {tab("cut", "Changed by the cut")}
      </div>
      <div className="mt-6 grid gap-10">
        {CHAPTERS.map((c) => {
          const list = rows.filter((s) => s.date >= c.from && s.date <= c.to).sort((a, b) => b.date.localeCompare(a.date));
          if (!list.length) return null;
          const all = list.length;
          const folded = all > FOLD && !open[c.id];
          if (folded) list.length = FOLD;
          const half = Math.ceil(list.length / 2);
          return (
            <section key={c.id} className="grid gap-x-10 gap-y-3 lg:grid-cols-[200px_minmax(0,1fr)]">
              <div className="lg:sticky lg:top-24 lg:self-start">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">{pick(c.label, c.label.replace(/ Nov/, " 日（11 月）").replace(/ Oct/, " 日（10 月）"))}</p>
                <p className="mt-1.5 text-[20px] font-semibold tracking-[-0.03em] text-white">{t(c.name)}</p>
                <p className="mt-1 font-mono text-[11px] text-dim">{t("{n} shipped", { n: all })}</p>
              </div>
              <div className="grid gap-x-8 rounded-[12px] border border-line bg-night-surface px-4 xl:grid-cols-2">
                <ul>{list.slice(0, half).map((s) => <Row key={s.id} s={s} />)}</ul>
                <ul className="border-t border-line xl:border-t-0">{list.slice(half).map((s) => <Row key={s.id} s={s} />)}</ul>
                {all > FOLD && (
                  <button type="button" onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))} aria-expanded={!folded} className="col-span-full -mx-4 flex h-11 items-center justify-center gap-2 border-t border-line text-[12.5px] text-fg-3 hover:text-white">
                    {folded ? t("Show all {n}", { n: all }) : t("Show fewer")}
                    <span className="text-faint">{folded ? "↓" : "↑"}</span>
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/* ---------- next ---------- */

function PlanCard({ p, dashed }: { p: Planned; dashed?: boolean }) {
  return (
    <div className="rm-frame">
      <Corners />
      <div className={`flex h-full flex-col gap-3 rounded-[2px] border bg-night-surface p-5 ${dashed ? "border-dashed border-line-2" : "border-line-2"}`}>
        <p className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">
          <span>{dashed ? t("Exploring") : t("Next")}</span>
          <span className={p.when ? "text-white" : ""}>{p.when ? pick(p.when, p.whenZh ?? p.when) : t("No date")}</span>
        </p>
        <h3 className="text-[19px] font-semibold leading-[1.15] tracking-[-0.03em] text-white">{pick(p.title, p.zh.title)}</h3>
        <p className="text-[13.5px] leading-[1.6] text-fg-4">{pick(p.text, p.zh.text)}</p>
      </div>
    </div>
  );
}

/* ---------- the page ---------- */

export default function Roadmap() {
  const builds = SHIPPED.filter((s) => !s.milestone).length;
  const stat = (v: number | string, k: string) => (
    <div className="min-w-0">
      <p className="text-[clamp(26px,3.2vw,36px)] font-semibold leading-none tracking-[-0.045em] text-white">{v}</p>
      <p className="mt-2 text-[12.5px] text-dim">{t(k)}</p>
    </div>
  );
  return (
    <div className="rm">
      {/* the hero: the claim, the numbers, and the orbit */}
      <section className="mx-auto max-w-[1440px] px-4 pb-[clamp(56px,7vw,104px)] pt-8 sm:px-5 sm:pt-12 lg:px-[86px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          {t("Roadmap")} · {t("updated {d}", { d: day(UPDATED, true) })}
        </p>
        <div className="mt-5 grid gap-x-12 gap-y-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end">
          <h1 className="text-[clamp(38px,5.4vw,72px)] font-semibold leading-[0.97] tracking-[-0.05em] text-white">
            {t("Shipped means a commit.")} <span className="text-faint">{t("Cut means a reason.")}</span>
          </h1>
          <div>
            <p className="max-w-[54ch] text-[15px] leading-[1.6] text-fg-3 sm:text-[16px]">
              {t("Everything we built is in the open, with the commit that shipped it. So is everything we removed, with why. What comes next has a date only when there is one.")}
            </p>
            <div className="mt-6 flex flex-wrap items-end gap-x-9 gap-y-5">
              {stat(builds, "builds shipped")}
              {stat(CUT.length, "cut on purpose")}
              {stat(NEXT.length + EXPLORING.length, "ahead")}
              <a href={`${GITHUB_URL}/commits/main`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-line-2 px-3.5 text-[12.5px] font-medium text-white hover:border-[#4a524e]">
                <GitHubIcon size={14} />
                {t("Every commit")}
              </a>
            </div>
          </div>
        </div>
        <div className="mt-[clamp(32px,4vw,56px)]">
          <Timeline />
        </div>
      </section>

      {/* now: a hatched band with the bento on a sheet of its own */}
      <section className="rm-hatch border-y border-line px-3 py-6 sm:px-5 sm:py-8">
        <div className="mx-auto max-w-[1268px] border border-line bg-night px-4 py-[clamp(36px,5vw,72px)] sm:px-[clamp(20px,4vw,48px)]">
          <Rise>
            <Head id="now" n={1} tag="Now" title="In the works," grey="in public." />
            <div className="mt-[clamp(28px,4vw,52px)]">
              <Now />
            </div>
          </Rise>
        </div>
      </section>

      {/* next */}
      <section className="mx-auto max-w-[1440px] px-4 py-[clamp(64px,9vw,128px)] sm:px-5 lg:px-[86px]">
        <Rise>
          <Head id="next" n={2} tag="Next" title="What comes next." grey="A date only when there is one." />
          <div className="mt-10 grid gap-7 sm:grid-cols-2 xl:grid-cols-3">
            {NEXT.map((p) => (
              <PlanCard key={p.id} p={p} />
            ))}
            {EXPLORING.map((p) => (
              <PlanCard key={p.id} p={p} dashed />
            ))}
          </div>
        </Rise>
      </section>

      {/* shipped */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1440px] px-4 py-[clamp(64px,9vw,128px)] sm:px-5 lg:px-[86px]">
          <Rise>
            <Head id="shipped" n={3} tag="Shipped" title="Everything shipped," grey="newest first." lead="Each line links the commit that shipped it. Work the rebuild later changed keeps its line, with a note." />
          </Rise>
          <Ledger />
        </div>
      </section>

      {/* cut */}
      <section className="rm-hatch border-t border-line px-3 py-6 sm:px-5 sm:py-8">
        <div className="mx-auto max-w-[1268px] border border-line bg-night px-4 py-[clamp(36px,5vw,72px)] sm:px-[clamp(20px,4vw,48px)]">
          <Rise>
            <Head id="cut" n={4} tag="Cut" title="What we cut," grey="and why." lead="A roadmap that only grows is a wish list. These were planned, some were built, and we dropped them on purpose." />
            <div className="mt-10 grid gap-7 md:grid-cols-2 xl:grid-cols-3">
              {CUT.map((c) => {
                const z = zh() ? c.zh : undefined;
                return (
                  <div key={c.id} className="rm-frame">
                    <Corners />
                    <div className="flex h-full flex-col rounded-[2px] border border-line-2 bg-night-surface p-5">
                      <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">
                        {t("Cut")} · {day(c.date)}
                      </p>
                      <h3 className="mt-3 text-[19px] font-semibold leading-[1.15] tracking-[-0.03em] text-dim line-through decoration-[#4a524e]">{z?.title ?? c.title}</h3>
                      <p className="mt-2 text-[13px] leading-[1.55] text-fg-4">{z?.text ?? c.text}</p>
                      <p className="mt-4 border-t border-line pt-3 text-[13.5px] leading-[1.6] text-white">{z?.reason ?? c.reason}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-12 border-t border-line pt-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">{t("Off the plan since the rebuild")}</p>
              <p className="mt-2 max-w-[62ch] text-[13.5px] leading-[1.6] text-fg-4">{t("These were on the 14 November plan and are not on this one. If one comes back, it gets a card above.")}</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {PARKED.map((p) => (
                  <li key={p.en} className="rounded-[5px] border border-dashed border-line-2 px-2.5 py-1 text-[12.5px] text-dim">
                    {pick(p.en, p.zh)}
                  </li>
                ))}
              </ul>
            </div>
          </Rise>
        </div>
      </section>
    </div>
  );
}
