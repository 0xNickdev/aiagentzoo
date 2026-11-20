import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BOT_URL, EXTENSION_URL, ZOOAGENCY_DEXSCREENER_URL, ZOOAGENCY_SOLSCAN_URL } from "../links";
import { t } from "../i18n";
import { num } from "../format";
import { ago, compact, SITE_XRAY, useNorth, useNow } from "../components/home/live";
import { More, Panel, Tile } from "../components/site/Panel";
import { CaRow, BuyButton, TokenDot } from "../components/site/ZooToken";
import Story from "../components/home/Story";
import { opponentOf, pct, timeLeft, type HumansView, useContestApi, type Weekly } from "../components/contests/data";

/* ---------- what the home reads ---------- */

type FeedVerdict = "pass" | "caution" | "avoid";
interface FeedCoin {
  mint: string;
  symbol: string;
  createdAt: number;
  verdict: FeedVerdict;
}
interface FeedBody {
  stream?: { live: boolean };
  new?: FeedCoin[];
  soon?: FeedCoin[];
  migrated?: FeedCoin[];
}
interface Usage {
  days?: Array<{ day: string; bySource?: Record<string, { xrays: number }> }>;
  last7: { xrays: number; checks: number; users: number; bySource?: Record<string, { xrays: number; checks: number; users: number }> };
}
interface Chain {
  live: boolean;
  seen: { launches: number };
  perMinute?: { launches: number };
}
interface Side {
  n: number;
  dead: number;
  unread?: number;
}
interface CheckRecord {
  window: string;
  checkedAtMin?: number;
  flaggedAvoid: Side;
  notFlagged?: Side;
  avoidBecause?: { dumped: number; serial: number; bundle: number };
}

const VERDICT: Record<FeedVerdict, { label: string; dot: string; text: string }> = {
  pass: { label: "no red flags", dot: "bg-moss", text: "text-moss" },
  caution: { label: "caution", dot: "bg-warn", text: "text-warn" },
  avoid: { label: "avoid", dot: "bg-danger", text: "text-danger" },
};

const clean = (s: string) => s.replace(/^\$+/, "").replace(/[\sㅤᅟᅠ​-‍﻿]+/g, " ").trim();

/** A heading that rises out of its mask and inks in, once, when it scrolls into view. */
function Reveal({ children }: { children: ReactNode }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    const io = new IntersectionObserver(
      ([x]) => {
        if (!x?.isIntersecting) return;
        e.setAttribute("data-in", "");
        io.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(e);
    return () => io.disconnect();
  }, []);
  return (
    <span ref={el} className="rv">
      <span>{children}</span>
    </span>
  );
}

/** How far an element has come up through the viewport, 0..1, for drawing on scroll. */
function useScrollIn<T extends HTMLElement>() {
  const el = useRef<T>(null);
  const [k, setK] = useState(() => (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0));
  useEffect(() => {
    const e = el.current;
    if (!e || k === 1) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const r = e.getBoundingClientRect();
      setK(Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * 0.55))));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    addEventListener("scroll", on, { passive: true });
    read();
    return () => {
      removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, [k]);
  return [el, k] as const;
}

/* ---------- the numbers ---------- */

function Numbers({ usage, chain, record }: { usage: Usage | null; chain: Chain | null; record: CheckRecord | null }) {
  const tiles = [
    usage && { k: t("X-Rays run"), v: compact(usage.last7.xrays), sub: t("last 7 days") },
    usage && { k: t("Quick checks"), v: compact(usage.last7.checks), sub: t("last 7 days") },
    chain && { k: t("Solana launches read"), v: compact(chain.seen.launches), sub: t("since the node started") },
    record?.avoidBecause && { k: t("Dev dumps caught at minute {m}", { m: record.checkedAtMin ?? 5 }), v: compact(record.avoidBecause.dumped), sub: t(record.window), tone: "danger" as const },
  ].filter(Boolean) as Array<{ k: string; v: string; sub?: string; tone?: "danger" }>;
  if (tiles.length < 2) return null;
  return (
    <Panel title={<Reveal>{t("In numbers")}</Reveal>} meta={t("live from the node")} className="lg:col-span-4" bodyClass="grid grid-cols-2">
      {tiles.map((x, i) => (
        <Tile key={x.k} k={x.k} v={x.v} sub={x.sub} tone={x.tone ?? "fg"} className={`border-line ${i % 2 ? "" : "border-r"} ${i < tiles.length - 2 || (tiles.length % 2 === 1 && i < tiles.length - 1) ? "border-b" : ""}`} />
      ))}
    </Panel>
  );
}

/* ---------- first screen: the track record ---------- */

/** Published 28 Oct 2026: how well each ranks the launches that lived above the ones that died. 0.5 is a coin flip. */
const AUC = [
  { k: "Odds model", v: 0.89, tone: "bg-moss", text: "text-moss" },
  { k: "Verdict alone", v: 0.59, tone: "bg-dim", text: "text-fg-2" },
];

function Record({ record }: { record: CheckRecord | null }) {
  const read = record ? record.flaggedAvoid.n - (record.flaggedAvoid.unread ?? 0) : 0;
  const deadShare = record && read ? record.flaggedAvoid.dead / read : null;
  const [bars, k] = useScrollIn<HTMLDivElement>();
  return (
    <Panel title={<Reveal>{t("Track record")}</Reveal>} meta={t("odds vs verdict · AUC, published 28 Oct")} className="lg:col-span-8" bodyClass={`grid grid-cols-1 ${deadShare !== null ? "md:grid-cols-2" : ""}`}>
      <div className="p-3.5">
      <p className="text-[12.5px] leading-[1.45] text-dim">{t("How well each ranks the coins that lived above the ones that died. 0.5 is a coin flip, 1 is perfect.")}</p>
      <div ref={bars} className="mt-4 grid gap-3.5">
        {AUC.map((a) => (
          <div key={a.k}>
            <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
              <span className="text-fg-2">{t(a.k)}</span>
              <span className={`text-[22px] font-medium leading-none tracking-[-0.03em] ${a.text}`}>{(0.5 + (a.v - 0.5) * k).toFixed(2)}</span>
            </div>
            {/* Scale 0.5 to 1: the bar's length is how far past a coin flip it ranks. */}
            <div className="relative h-2 rounded-sm bg-night-raised">
              <div className={`absolute inset-y-0 left-0 rounded-sm ${a.tone}`} style={{ width: `${((a.v - 0.5) / 0.5) * 100 * k}%` }} />
            </div>
          </div>
        ))}
        <div className="flex justify-between text-[10.5px] text-faint">
          <span>{t("0.5 coin flip")}</span>
          <span>0.75</span>
          <span>{t("1.0 perfect")}</span>
        </div>
      </div>
      </div>
      {deadShare !== null && record && (
        <div className="border-t border-line p-3.5 md:border-l md:border-t-0">
          <p className="text-[12.5px] text-fg-2">{t("Dead since, by the verdict at minute {m}", { m: record.checkedAtMin ?? 5 })}</p>
          {[
            { k: "flagged avoid", side: record.flaggedAvoid, bar: "bg-danger", text: "text-danger" },
            ...(record.notFlagged ? [{ k: "not flagged", side: record.notFlagged, bar: "bg-dim", text: "text-fg-2" }] : []),
          ].map((x) => {
            const n = x.side.n - (x.side.unread ?? 0);
            const share = n ? x.side.dead / n : 0;
            return (
              <div key={x.k} className="mt-2.5">
                <div className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="text-dim">
                    {t(x.k)} <span className="text-faint">· {num(n)}</span>
                  </span>
                  <span className={`text-[16px] font-medium leading-none ${x.text}`}>{(share * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-sm bg-night-raised">
                  <div className={`h-full ${x.bar}`} style={{ width: `${share * 100}%` }} />
                </div>
              </div>
            );
          })}
          <p className="mt-2 text-[11.5px] text-faint">{t("{w}. Most launches die either way: the odds are what rank them.", { w: t(record.window) })}</p>
        </div>
      )}
    </Panel>
  );
}

/* ---------- the live strip ---------- */

function LiveStrip({ coins, live }: { coins: FeedCoin[]; live: boolean }) {
  const now = useNow(5_000);
  if (!coins.length) return null;
  // Twice over, so the loop has no seam; about three seconds a coin.
  const loop = [...coins, ...coins];
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "live-dot bg-moss" : "bg-warn"}`} />
          <Reveal>{t("Live feed")}</Reveal>
        </span>
      }
      meta={t("{n} fresh pump.fun launches · avoid already taken out", { n: coins.length })}
      action={<More href="/feed">{t("Open the feed →")}</More>}
      className="lg:col-span-12"
      bodyClass="p-0"
    >
      <div className="marquee overflow-hidden py-2.5">
        <ul className="marquee-track flex w-max" style={{ ["--marquee-s" as string]: `${coins.length * 3}s` }}>
          {loop.map((c, i) => {
            const v = VERDICT[c.verdict] ?? VERDICT.caution;
            return (
              <li key={`${c.mint}-${i}`} aria-hidden={i >= coins.length || undefined}>
                <a
                  href={SITE_XRAY(c.mint)}
                  tabIndex={i >= coins.length ? -1 : undefined}
                  className="mx-1 flex h-8 items-center gap-2 rounded-[7px] border border-line bg-night px-2.5 text-[12.5px] hover:border-line-2"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
                  <span className="max-w-[14ch] truncate font-medium text-white">${clean(c.symbol) || c.mint.slice(0, 4)}</span>
                  <span className={v.text}>{t(v.label)}</span>
                  <span className="text-faint">{ago(c.createdAt, now)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

/* ---------- below the fold ---------- */

function Contests({ humans, weekly }: { humans: HumansView | null; weekly: Weekly | null }) {
  const now = useNow(60_000);
  if (!humans && !weekly) return null;
  const model = opponentOf(humans);
  const human = humans?.standings[0];
  const agents = weekly?.week.standings.slice(0, 3) ?? [];
  const ends = weekly?.week.endsAt ?? humans?.week.endsAt;
  return (
    <Panel
      title={<Reveal>{t("Contests")}</Reveal>}
      meta={ends ? t("this week ends in {t}", { t: timeLeft(ends, now) }) : undefined}
      action={<More href="/contests">{t("All standings →")}</More>}
      className="lg:col-span-8"
      bodyClass="grid grid-cols-1 sm:grid-cols-2"
    >
      {humans && (
        <div className="border-b border-line p-3.5 sm:border-b-0 sm:border-r">
          <p className="text-[13px] font-medium text-white">{t("Humans vs the odds model")}</p>
          <p className="mt-1 text-[12px] text-dim">{t("Call tonight's coins: rug, watch or alive. Tomorrow the market grades you and the model on one scale.")}</p>
          <div className="mt-3 grid grid-cols-2 border-y border-line">
            <Tile k={t("odds model")} v={model ? pct(model.score) : "-"} sub={model ? t("{n} graded", { n: model.graded }) : t("grades after tonight")} className="border-r border-line !px-0 !pr-3.5" />
            <Tile k={t("best human")} v={human ? pct(human.score) : "-"} sub={human ? human.id : t("nobody yet, be first")} tone={human && model && human.score > model.score ? "moss" : "fg"} />
          </div>
          <a href="/contests#humans" className="mt-3 inline-flex h-8 items-center rounded-[7px] border border-line-2 bg-night-raised px-3 text-[12.5px] font-medium text-white hover:border-[#3a4640]">
            {t("Play tonight's exam")}
          </a>
        </div>
      )}
      {weekly && (
        <div className="p-3.5">
          <p className="text-[13px] font-medium text-white">{t("Agent of the week")}</p>
          <p className="mt-1 text-[12px] text-dim">{t("Bring your agent. The best honest record of the week wins.")}</p>
          <ol className="mt-3 border-t border-line">
            {agents.map((r, i) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-[12.5px]">
                <span className="min-w-0 truncate text-white">
                  <span className="mr-2.5 text-faint">{String(i + 1).padStart(2, "0")}</span>
                  {r.name}
                </span>
                <span className="shrink-0 text-fg-2">
                  {pct(r.score)} <span className="text-faint">· {r.graded}</span>
                </span>
              </li>
            ))}
            {!agents.length && <li className="border-b border-line py-2 text-[12.5px] text-dim">{t("No graded calls yet this week.")}</li>}
          </ol>
          <a href="/contests#agents" className="mt-3 inline-flex h-8 items-center rounded-[7px] border border-line-2 bg-night-raised px-3 text-[12.5px] font-medium text-white hover:border-[#3a4640]">
            {t("Enter your agent")}
          </a>
        </div>
      )}
    </Panel>
  );
}

function Token({ wide }: { wide: boolean }) {
  return (
    <Panel title={<span className="flex items-center gap-2"><TokenDot /><Reveal>$ZOOAGENCY</Reveal></span>} meta={t("on ClawPump")} className={wide ? "lg:col-span-12" : "lg:col-span-4"} bodyClass={wide ? "grid grid-cols-1 gap-x-6 p-3.5 md:grid-cols-2" : "flex flex-col p-3.5"}>
      <ul className="border-t border-line">
        {["Pro at half price", "The weekly human contest", "Bot alerts 10 minutes first"].map((f) => (
          <li key={f} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[12.5px]">
            <span className="text-fg-2">{t(f)}</span>
            <span className="text-faint">{t("hold 500k")}</span>
          </li>
        ))}
      </ul>
      <div className={wide ? "mt-3.5 md:mt-0" : ""}>
        <CaRow id="home-ca" className={wide ? "" : "mt-3.5"} />
        <BuyButton className="mt-2 w-full !h-9 !text-[13px]" />
        <div className="mt-3 flex gap-4 text-[12px]">
          <More href={ZOOAGENCY_DEXSCREENER_URL}>DexScreener ↗</More>
          <More href={ZOOAGENCY_SOLSCAN_URL}>Solscan ↗</More>
        </div>
      </div>
    </Panel>
  );
}

/** The home: the hero and the scroll story of one real token on one pinned stage, then the tape, the numbers, the record and the rest. Every number is read live; a part that cannot be read is left out. */
export default function Home() {
  const feedBody = useNorth<FeedBody>("/v1/chain/feed", 15_000);
  const usage = useNorth<Usage>("/v1/usage", 120_000);
  const chain = useNorth<Chain>("/v1/chain", 30_000);
  const record = useNorth<CheckRecord>("/v1/check/record", 120_000);
  const humans = useContestApi<HumansView>("/v1/humans", 120_000).data;
  const weekly = useContestApi<Weekly>("/v1/agent-of-the-week", 120_000).data;
  const coins = useMemo(() => {
    const all = [...(feedBody?.new ?? []), ...(feedBody?.soon ?? []), ...(feedBody?.migrated ?? [])];
    const seen = new Set<string>();
    return all
      .filter((c) => c.mint && !seen.has(c.mint) && seen.add(c.mint))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30);
  }, [feedBody]);

  return (
    <>
      <Story chain={chain} sample={coins[0]} />
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 px-4 pb-8 pt-4 sm:px-5 lg:grid-cols-12">
        <LiveStrip coins={coins} live={!!feedBody?.stream?.live} />
        <Record record={record} />
        <Numbers usage={usage} chain={chain} record={record} />
        <Contests humans={humans} weekly={weekly} />
        <Token wide={!humans && !weekly} />
      </div>
    </>
  );
}
