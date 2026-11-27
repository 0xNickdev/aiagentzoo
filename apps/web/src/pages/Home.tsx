import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BOT_URL, EXTENSION_URL, ZOOAGENCY_DEXSCREENER_URL, ZOOAGENCY_SOLSCAN_URL } from "../links";
import { t } from "../i18n";
import { num } from "../format";
import { ago, SITE_XRAY, ticker, useNorth, useNow } from "../components/home/live";
import { CaRow, BuyButton } from "../components/site/ZooToken";
import Story, { Lines } from "../components/home/Story";
import { RecognitionStrip } from "../components/site/Recognition";
import { oddsPct } from "../components/XRay/ui";
import { opponentOf, pct, type HumansView, useContestApi } from "../components/contests/data";

/* ---------- what the home reads ---------- */

type FeedVerdict = "pass" | "caution" | "avoid";
interface FeedCoin {
  mint: string;
  symbol: string;
  createdAt: number;
  verdict: FeedVerdict;
  odds?: { run: number } | null;
}
interface FeedBody {
  stream?: { live: boolean };
  new?: FeedCoin[];
  soon?: FeedCoin[];
  migrated?: FeedCoin[];
}
interface SourceUse {
  xrays: number;
  checks: number;
  users: number;
}
interface Usage {
  last7: { xrays: number; checks: number; users: number; bySource?: Record<string, SourceUse> };
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
}

const VERDICT_WORD: Record<FeedVerdict, string> = { pass: "no red flags", caution: "caution", avoid: "avoid" };

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How far an element has come up through the viewport, 0..1: 0 as its top enters at the bottom, 1 once it reaches `to` of the height. It stays at 1 once there. */
function useScrollIn<T extends HTMLElement>(to = 0.4) {
  const el = useRef<T>(null);
  const [k, setK] = useState(() => (reduced() ? 1 : 0));
  useEffect(() => {
    const e = el.current;
    if (!e || k === 1) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const r = e.getBoundingClientRect();
      setK(Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * (1 - to)))));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    read();
    return () => {
      removeEventListener("scroll", on);
      removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, [k, to]);
  return [el, k] as const;
}

/** A line that rises out of its mask and inks in, once, when it scrolls into view. */
function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
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
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(e);
    return () => io.disconnect();
  }, []);
  return (
    <span ref={el} className={`rv ${className}`}>
      <span>{children}</span>
    </span>
  );
}

/** A heading whose lines rise and ink from grey to white as it comes up the screen. */
function Heading({ lines, className, to = 0.45 }: { lines: string[]; className: string; to?: number }) {
  const [el, k] = useScrollIn<HTMLDivElement>(to);
  return (
    <div ref={el}>
      <Lines lines={lines} r={k} className={className} />
    </div>
  );
}

/** One full-width section: a hairline, the counter that carries on from the story's 01-04, then the idea. */
function Section({ n, of, name, children, id }: { n: number; of: number; name: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="relative scroll-mt-16 border-t border-line">
      <div className="mx-auto max-w-[1440px] px-5 pb-[clamp(88px,13vw,176px)] pt-6 sm:px-[86px]">
        <p className="flex justify-end font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          <span>
            <span className="text-white">{String(n).padStart(2, "0")}</span> / {String(of).padStart(2, "0")} · {t(name)}
          </span>
        </p>
        <div className="mt-[clamp(48px,7vw,104px)]">{children}</div>
      </div>
    </section>
  );
}

const display = "font-semibold leading-[0.98] tracking-[-0.045em]";
const lead = "text-[16px] leading-[1.55] text-fg-3 sm:text-[18px]";

/* ---------- a) the statement ---------- */

function Statement() {
  return (
    <Heading
      to={0.3}
      lines={[t("We don't stop you"), t("from aping."), t("We show you who"), t("you're buying from.")]}
      className={`${display} text-[clamp(38px,6.6vw,104px)]`}
    />
  );
}

/* ---------- b) the proof ---------- */

/** Published 28 Oct 2026: how well each ranks the launches that lived above the ones that died. 0.5 is a coin flip. */

function share(s?: Side) {
  if (!s) return null;
  const read = s.n - (s.unread ?? 0);
  return read > 0 ? { p: s.dead / read, n: read } : null;
}

function Proof({ record }: { record: CheckRecord | null }) {
  const flagged = share(record?.flaggedAvoid);
  const other = share(record?.notFlagged);
  const [bars, k] = useScrollIn<HTMLDivElement>(0.35);
  const m = record?.checkedAtMin ?? 5;
  return (
    <>
      {flagged && record && (
        <div className="grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-end">
          <p className={`${display} text-[clamp(96px,17vw,248px)] leading-[0.85] text-white`}>
            <Reveal>{(flagged.p * 100).toFixed(1)}%</Reveal>
          </p>
          <div className="max-w-[440px] pb-[0.6vw]">
            <p className="text-[20px] font-medium leading-[1.35] tracking-[-0.02em] text-white sm:text-[24px]">
              {t("of the coins we flagged avoid at minute {m} were dead a day or two later.", { m })}
            </p>
            {other && (
              <p className={`mt-5 ${lead}`}>
                {t("Coins we did not flag: {p}% dead. Most launches die either way, so the flag tells you what is happening, the odds tell you what might live.", { p: (other.p * 100).toFixed(1) })}
              </p>
            )}
            <p className="mt-6 border-t border-line pt-3 text-[13px] text-faint">
              {t("{a} flagged · {b} not flagged · launched 24 to 48 hours ago", { a: num(flagged.n), b: other ? num(other.n) : "-" })}
            </p>
          </div>
        </div>
      )}

      <div className={flagged ? "mt-[clamp(96px,12vw,168px)] border-t border-line pt-[clamp(48px,6vw,88px)]" : ""}>
        <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            <p className={`${display} whitespace-nowrap text-[clamp(64px,10vw,150px)] leading-[0.9] text-white`}>
              <Reveal>0.89</Reveal>
            </p>
            <div ref={bars} className="mt-14 max-w-[760px]">
              {/* One scale, 0.5 (a coin flip) to 1.0 (never wrong). The line draws on scroll; the number never moves. */}
              <div className="relative h-px bg-line-2">
                <div className="absolute left-0 top-[-0.5px] h-[2px] bg-white" style={{ width: `${((0.89 - 0.5) / 0.5) * 100 * k}%` }} />
                <div className="absolute top-[-7px] h-[15px] w-px bg-white" style={{ left: `${((0.89 - 0.5) / 0.5) * 100}%`, opacity: k > 0.98 ? 1 : 0.25 }} />
                <span className="absolute top-[-30px] -translate-x-1/2 whitespace-nowrap text-[13px] text-white" style={{ left: `${((0.89 - 0.5) / 0.5) * 100}%` }}>
                  {t("ZOO odds model")}
                </span>
              </div>
              <div className="mt-3 flex justify-between font-mono text-[11px] text-faint">
                <span>{t("0.5 coin flip")}</span>
                <span>0.75</span>
                <span>{t("1.0 perfect")}</span>
              </div>
            </div>
          </div>
          <div className="max-w-[440px] lg:pt-4">
            <p className="text-[20px] font-medium leading-[1.35] tracking-[-0.02em] text-white sm:text-[24px]">
              {t("Our odds model picks which coins survive.")}
            </p>
            <p className={`mt-5 ${lead}`}>
              {t("Take one coin that lived and one that died. 89 times out of 100 the model rates the survivor higher. Guessing gets you 50.")}
            </p>
            <p className="mt-6 border-t border-line pt-3 text-[13px] text-faint">{t("Area under the curve, published 28 Oct 2026")}</p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- c) live ---------- */

function Live({ coins, live }: { coins: FeedCoin[]; live: boolean }) {
  const now = useNow(5_000);
  const rows = coins.slice(0, 8);
  const hasOdds = rows.some((c) => c.odds && Number.isFinite(c.odds.run));
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Heading lines={[t("Launching now.")]} className={`${display} text-[clamp(44px,6.6vw,104px)]`} />
        <p className="flex items-center gap-2.5 pb-2 text-[14px] text-fg-3">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "live-dot bg-white" : "bg-[#6b736f]"}`} />
          {live ? t("fresh pump.fun launches, read as they happen") : t("the latest pump.fun launches")}
        </p>
      </div>
      <ul className="mt-12 border-t border-line">
        {rows.map((c) => {
          const bad = c.verdict === "avoid";
          return (
            <li key={c.mint}>
              <a
                href={SITE_XRAY(c.mint)}
                className={`group grid items-baseline gap-x-6 border-b border-line py-[18px] transition-colors hover:bg-white/[0.02] sm:py-6 ${hasOdds ? "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_96px]" : "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_96px]"}`}
              >
                <span className="min-w-0 truncate text-[22px] font-medium tracking-[-0.03em] text-white sm:text-[30px]">{ticker(c.symbol, c.mint)}</span>
                <span className={`hidden text-[15px] sm:block ${bad ? "text-danger" : "text-fg-3"}`}>{t(VERDICT_WORD[c.verdict] ?? c.verdict)}</span>
                {hasOdds && (
                  <span className="hidden text-right font-mono text-[15px] tabular-nums text-fg-2 sm:block">
                    {c.odds && Number.isFinite(c.odds.run) ? t("{p}% alive", { p: oddsPct(c.odds.run) }) : ""}
                  </span>
                )}
                <span className="text-right font-mono text-[13px] tabular-nums text-faint sm:text-[14px]">
                  <span className={`mr-3 font-sans sm:hidden ${bad ? "text-danger" : "text-fg-3"}`}>{t(VERDICT_WORD[c.verdict] ?? c.verdict)}</span>
                  {ago(c.createdAt, now)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <a href="/feed" className="group mt-8 inline-flex items-center gap-2 text-[16px] font-medium text-white">
        {t("Open the feed")}
        <Arrow />
      </a>
    </>
  );
}

const Arrow = ({ big }: { big?: boolean }) => (
  <svg width={big ? 36 : 16} height={big ? 36 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={big ? 1.25 : 1.75} aria-hidden className="shrink-0 transition-transform duration-300 group-hover:translate-x-1.5">
    <path d="M4 12h16M14 6l6 6-6 6" />
  </svg>
);

/* ---------- d) where it works ---------- */

function Where({ usage }: { usage: Usage | null }) {
  const src = usage?.last7.bySource;
  const ext = src?.extension;
  const api = src?.api;
  const rows = [
    {
      name: "Chrome extension",
      href: EXTENSION_URL,
      line: ext && ext.users > 0 ? t("{x} X-Rays by {u} traders in the last 7 days, right on the page they trade from.", { x: num(ext.xrays), u: num(ext.users) }) : t("The verdict right on the page you trade from."),
    },
    {
      name: "Telegram bot",
      href: BOT_URL,
      line: t("Paste a contract in chat, get the dev's record back."),
    },
    {
      name: "API & x402",
      href: "/docs",
      line: api && api.checks > 0 ? t("{c} checks over the API in the last 7 days. Pay per call in USDC with x402, no key.", { c: num(api.checks) }) : t("Pay per call in USDC with x402, no key."),
      also: { href: "/x402", label: "x402" },
    },
  ];
  return (
    <>
      <Heading lines={[t("Wherever you trade.")]} className={`${display} text-[clamp(44px,6.6vw,104px)]`} />
      <ul className="mt-12 border-t border-line">
        {rows.map((r) => {
          const ext = r.href.startsWith("http");
          return (
            <li key={r.name} className="border-b border-line">
              <a
                href={r.href}
                target={ext ? "_blank" : undefined}
                rel={ext ? "noopener noreferrer" : undefined}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 gap-y-2 py-7 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <span className="text-[32px] font-semibold leading-none tracking-[-0.04em] text-white sm:text-[56px]">{t(r.name)}</span>
                <span className="col-start-1 row-start-2 max-w-[44ch] text-[15px] leading-[1.5] text-fg-3 sm:text-[17px] lg:col-start-2 lg:row-start-1">{r.line}</span>
                <span className="col-start-2 row-span-2 row-start-1 text-fg-2 group-hover:text-white lg:col-start-3 lg:row-span-1">
                  <Arrow big />
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ---------- e) contests ---------- */

function Contests({ humans }: { humans: HumansView }) {
  const human = humans.standings[0];
  const model = opponentOf(humans);
  return (
    <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-end">
      <Heading lines={[t("Humans vs the odds model,"), t("every night.")]} className={`${display} text-[clamp(40px,5.6vw,88px)]`} />
      <div className="max-w-[440px]">
        {(human || model) && (
          <dl className={`grid border-t border-line ${human && model ? "grid-cols-2" : "grid-cols-1"}`}>
            {human && (
              <div className="border-b border-line py-4 pr-4">
                <dt className="text-[13px] text-dim">{t("best human this week")}</dt>
                <dd className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.04em] text-white">{pct(human.score)}</dd>
              </div>
            )}
            {model && (
              <div className="border-b border-line py-4 pr-4">
                <dt className="text-[13px] text-dim">{t("odds model")}</dt>
                <dd className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.04em] text-fg-4">{model.graded ? pct(model.score) : "-"}</dd>
              </div>
            )}
          </dl>
        )}
        <p className={`mt-5 ${lead}`}>{t("Call tonight's coins: rug, watch or alive. Tomorrow the market grades you and the model on one scale.")}</p>
        <a href="/contests#humans" className="btn-primary mt-7 inline-flex h-11 items-center rounded-[8px] px-5 text-[14px] font-medium">
          {t("Play tonight's exam")}
        </a>
      </div>
    </div>
  );
}

/* ---------- f) the token ---------- */

function Token() {
  return (
    <>
      <p className={`${display} text-[clamp(52px,11.5vw,176px)] leading-[0.88] text-white`}>
        <Reveal>$ZOOAGENCY</Reveal>
      </p>
      <div className="mt-10 grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <p className="max-w-[30ch] text-[22px] font-medium leading-[1.3] tracking-[-0.02em] text-white sm:text-[28px]">
          {t("Hold 500k: the weekly human contest and bot alerts 10 minutes first. Pro: soon.")}
        </p>
        <div className="min-w-0 max-w-[480px]">
          <CaRow id="home-ca" className="!h-11 !rounded-[8px] !pl-3.5 !pr-1.5" />
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
            <BuyButton className="!h-11 !rounded-[8px] !px-5 !text-[14px]" />
            <a href={ZOOAGENCY_DEXSCREENER_URL} target="_blank" rel="noopener noreferrer" className="text-[14px] text-fg-3 hover:text-white">
              DexScreener ↗
            </a>
            <a href={ZOOAGENCY_SOLSCAN_URL} target="_blank" rel="noopener noreferrer" className="text-[14px] text-fg-3 hover:text-white">
              Solscan ↗
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

/** The home: the hero and the scroll story of one real token on one pinned stage, then one idea per screen. Every number is read live; a part that cannot be read is left out. */
export default function Home() {
  const feedBody = useNorth<FeedBody>("/v1/chain/feed", 15_000);
  const usage = useNorth<Usage>("/v1/usage", 120_000);
  const chain = useNorth<Chain>("/v1/chain", 30_000);
  const record = useNorth<CheckRecord>("/v1/check/record", 120_000);
  const humans = useContestApi<HumansView>("/v1/humans", 120_000).data;
  const coins = useMemo(() => {
    const all = [...(feedBody?.new ?? []), ...(feedBody?.soon ?? []), ...(feedBody?.migrated ?? [])];
    const seen = new Set<string>();
    return all
      .filter((c) => c.mint && !seen.has(c.mint) && seen.add(c.mint))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30);
  }, [feedBody]);

  const parts = [
    { name: "The point", el: <Statement /> },
    { name: "The proof", el: <Proof record={record} /> },
    coins.length ? { name: "Live", el: <Live coins={coins} live={!!feedBody?.stream?.live} /> } : null,
    { name: "Where", el: <Where usage={usage} /> },
    humans ? { name: "Contests", el: <Contests humans={humans} /> } : null,
    { name: "The token", el: <Token /> },
  ].filter(Boolean) as Array<{ name: string; el: ReactNode }>;
  const of = 4 + parts.length;

  return (
    <>
      <Story chain={chain} sample={coins[0]} />
      <div className="mx-auto mt-10 w-full max-w-[1200px] px-4 sm:px-6">
        <RecognitionStrip />
      </div>
      <div className="mt-[clamp(48px,8vw,120px)]">
        {parts.map((p, i) => (
          <Section key={p.name} n={5 + i} of={of} name={p.name}>
            {p.el}
          </Section>
        ))}
      </div>
    </>
  );
}
