import { type FormEvent, useMemo, useRef, useState } from "react";
import { BOT_URL, EXTENSION_URL, ZOOAGENCY_DEXSCREENER_URL, ZOOAGENCY_SOLSCAN_URL } from "../links";
import { navigate } from "../router";
import { t } from "../i18n";
import { num } from "../format";
import { ago, compact, SITE_XRAY, useNorth, useNow } from "../components/home/live";
import { More, Panel, Tile } from "../components/site/Panel";
import { CaRow, BuyButton, TokenDot } from "../components/site/ZooToken";
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

/* ---------- first screen: the search ---------- */

function Search() {
  const [mint, setMint] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const go = (e: FormEvent) => {
    e.preventDefault();
    const m = mint.trim();
    if (!m) return input.current?.focus();
    navigate(SITE_XRAY(encodeURIComponent(m)));
  };
  return (
    <form onSubmit={go} className="flex flex-col gap-2 sm:flex-row" role="search">
      <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-[9px] border border-[#ffffff14] bg-night px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] focus-within:border-[#3f5a48]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="shrink-0 text-faint">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={input}
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          placeholder={t("Paste a Solana token address")}
          aria-label={t("Token address")}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-[13.5px] tracking-[-0.01em] text-white placeholder:text-faint focus:outline-none"
        />
      </label>
      <button type="submit" className="btn-moss h-12 shrink-0 rounded-[9px] px-5 text-[14px] font-medium">
        {t("X-Ray it")}
      </button>
    </form>
  );
}

function Hero({ usage, chain, record, feed }: { usage: Usage | null; chain: Chain | null; record: CheckRecord | null; feed: FeedCoin[] }) {
  const sample = feed[0];
  const tiles = [
    usage && { k: t("X-Rays run, last 7 days"), v: compact(usage.last7.xrays) },
    usage && { k: t("Quick checks, last 7 days"), v: compact(usage.last7.checks) },
    chain && { k: t("Solana launches read"), v: compact(chain.seen.launches) },
    record?.avoidBecause && { k: t("Dev dumps flagged at minute {m}", { m: record.checkedAtMin ?? 5 }), v: compact(record.avoidBecause.dumped), sub: t(record.window), tone: "danger" as const },
  ].filter(Boolean) as Array<{ k: string; v: string; sub?: string; tone?: "danger" }>;
  return (
    <Panel
      title={t("X-Ray")}
      meta={t("free · Solana · read straight from the chain")}
      className="lg:col-span-8"
      bodyClass="flex flex-col"
    >
      <div className="p-5 sm:p-6">
        <h1 className="max-w-[18ch] text-[36px] font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-[48px]">{t("See who you're buying from.")}</h1>
        <p className="mb-5 mt-3 max-w-[60ch] text-[14.5px] leading-[1.5] text-fg-2">
          {t("Paste a token. Get the dev's record, the wallets in the first seconds, who paid for them and the odds the first five minutes give.")}
        </p>
        <Search />
        {sample && (
          <p className="mt-2.5 text-[12px] text-faint">
            {t("Or try the newest launch:")}{" "}
            <a href={SITE_XRAY(sample.mint)} className="text-dim underline decoration-line-2 underline-offset-4 hover:text-white">
              ${clean(sample.symbol) || sample.mint.slice(0, 6)}
            </a>
          </p>
        )}
      </div>
      {tiles.length > 0 && (
        <div className={`mt-auto grid grid-cols-2 border-t border-line ${tiles.length > 2 ? "sm:grid-cols-4" : ""}`}>
          {tiles.map((x, i) => (
            <Tile key={x.k} k={x.k} v={x.v} sub={x.sub} tone={x.tone ?? "fg"} className={`${i % 2 ? "" : "border-r"} ${i < tiles.length - 2 ? "border-b sm:border-b-0" : ""} border-line sm:border-r sm:last:border-r-0`} />
          ))}
        </div>
      )}
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
  return (
    <Panel title={t("Track record")} meta={t("odds vs verdict · AUC")} className="lg:col-span-4" bodyClass="flex flex-col p-3.5">
      <p className="text-[12.5px] leading-[1.45] text-dim">{t("How well each ranks the coins that lived above the ones that died. 0.5 is a coin flip, 1 is perfect.")}</p>
      <div className="mt-4 grid gap-3.5">
        {AUC.map((a) => (
          <div key={a.k}>
            <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
              <span className="text-fg-2">{t(a.k)}</span>
              <span className={`text-[22px] font-medium leading-none tracking-[-0.03em] ${a.text}`}>{a.v.toFixed(2)}</span>
            </div>
            {/* Scale 0.5 to 1: the bar's length is how far past a coin flip it ranks. */}
            <div className="relative h-2 rounded-sm bg-night-raised">
              <div className={`absolute inset-y-0 left-0 rounded-sm ${a.tone}`} style={{ width: `${((a.v - 0.5) / 0.5) * 100}%` }} />
            </div>
          </div>
        ))}
        <div className="flex justify-between text-[10.5px] text-faint">
          <span>{t("0.5 coin flip")}</span>
          <span>0.75</span>
          <span>{t("1.0 perfect")}</span>
        </div>
      </div>
      {deadShare !== null && record && (
        <div className="mt-auto border-t border-line pt-3.5">
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
          {t("Live feed")}
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

function Extension({ usage }: { usage: Usage | null }) {
  const ext = usage?.last7.bySource?.extension;
  const days = (usage?.days ?? []).map((d) => ({ day: d.day, n: d.bySource?.extension?.xrays ?? 0 }));
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <Panel title={t("Chrome extension")} meta={t("free")} className="lg:col-span-4" bodyClass="flex flex-col p-3.5">
      <p className="text-[13px] leading-[1.5] text-fg-2">{t("The X-Ray on the page you trade on: pump.fun, Axiom, GMGN, BullX, Photon, DexScreener and X. The dev and the first-second wallets, without leaving the chart.")}</p>
      {ext && (
        <div className="mt-3.5 grid grid-cols-2 border-y border-line">
          <Tile k={t("X-Rays from it, 7 days")} v={num(ext.xrays)} className="border-r border-line !min-h-[78px] !px-0 !pr-3.5" />
          <Tile k={t("traders using it, 7 days")} v={num(ext.users)} className="!min-h-[78px]" />
        </div>
      )}
      {days.length > 1 && (
        <div className="mt-3" aria-label={t("X-Rays from the extension by day")}>
          <div className="flex h-12 items-end gap-1.5 border-b border-line">
            {days.map((d) => (
              <div key={d.day} title={`${d.day}: ${num(d.n)}`} className="flex-1 rounded-t-[2px] bg-moss/70" style={{ height: `${Math.max(2, (d.n / max) * 100)}%` }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-faint">
            <span>{days[0]!.day.slice(5)}</span>
            <span>{t("by day, UTC")}</span>
            <span>{days[days.length - 1]!.day.slice(5)}</span>
          </div>
        </div>
      )}
      <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="btn-moss mt-3.5 flex h-9 items-center justify-center rounded-[8px] text-[13px] font-medium lg:mt-auto">
        {t("Add to Chrome")}
      </a>
    </Panel>
  );
}

const BOT_LINES: Array<[string, string]> = [
  ["/xray <token>", "who bought in the first 5 seconds, and who they are"],
  ["/dev <wallet>", "a creator's last 48 h: launches, dumps, how fast"],
  ["/watch <token>", "alerts on dumps, drained pools, graduation, big buys"],
  ["/clean", "fresh launches that passed the basic checks"],
  ["/link <code>", "holders get the alerts 10 minutes first"],
];

function Bot() {
  return (
    <Panel title={t("Telegram bot")} meta="@zooaiagency_bot" className="lg:col-span-4" bodyClass="flex flex-col p-3.5">
      <ul className="border-t border-line">
        {BOT_LINES.map(([cmd, what]) => (
          <li key={cmd} className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 border-b border-line py-2 text-[12.5px]">
            <code className="font-mono text-[12px] text-white">{cmd}</code>
            <span className="text-fg-2">{t(what)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-[1.45] text-dim">{t("In groups only /xray and /dev, with short answers.")}</p>
      <a href={BOT_URL} target="_blank" rel="noopener noreferrer" className="mt-3.5 flex h-9 items-center justify-center rounded-[8px] border border-line-2 bg-night-raised text-[13px] font-medium text-white hover:border-[#3a4640] lg:mt-auto">
        {t("Open the bot")}
      </a>
    </Panel>
  );
}

const PLANS = [
  { k: "Day", p: 3, per: "per day" },
  { k: "Week", p: 12, per: "per week" },
  { k: "Month", p: 35, per: "per month" },
] as const;

function Pro() {
  const [i, setI] = useState(1);
  const plan = PLANS[i]!;
  return (
    <Panel title={t("Pro")} tag={t("deep check")} meta={t("paid in SOL")} className="lg:col-span-4" bodyClass="flex flex-col p-3.5">
      <div className="grid grid-cols-3 rounded-[9px] border border-line bg-night p-[3px]" role="radiogroup" aria-label={t("Pro period")}>
        {PLANS.map((x, j) => (
          <button
            key={x.k}
            type="button"
            role="radio"
            aria-checked={i === j}
            onClick={() => setI(j)}
            className={`rounded-[6px] py-[5px] text-[12px] transition-colors ${i === j ? "bg-night-raised text-white shadow-[inset_0_0_0_1px_#232c27]" : "text-dim hover:text-fg-2"}`}
          >
            {t(x.k)}
          </button>
        ))}
      </div>
      <div className="mt-3.5 flex items-baseline gap-1.5">
        <span className="text-[36px] font-medium leading-none tracking-[-0.04em] text-white">${plan.p}</span>
        <span className="text-[12px] text-dim">{t(plan.per)}</span>
        <span className="ml-auto text-[12px] text-moss">{t("holders ${h}", { h: Number.isInteger(plan.p / 2) ? plan.p / 2 : (plan.p / 2).toFixed(2) })}</span>
      </div>
      <ul className="my-3 border-t border-line">
        {["Funding trace, 4 hops back", "Where the SOL went", "Every early wallet's history", "1 free deep check a week, opens soon"].map((f) => (
          <li key={f} className="flex gap-2 border-b border-line py-1.5 text-[12px] text-fg-2">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-moss" />
            {t(f)}
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-faint">
        <span className="font-medium text-dim">{t("500k $ZOOAGENCY")}</span> {t("holders pay half.")}
      </p>
      <a href="/xray" className="mt-3 flex h-9 items-center justify-center rounded-[8px] border border-line-2 bg-night-raised text-[13px] font-medium text-white hover:border-[#3a4640] lg:mt-auto">
        {t("Free deep check opens soon")}
      </a>
    </Panel>
  );
}

function Contests() {
  const humans = useContestApi<HumansView>("/v1/humans", 120_000).data;
  const weekly = useContestApi<Weekly>("/v1/agent-of-the-week", 120_000).data;
  const now = useNow(60_000);
  if (!humans && !weekly) return null;
  const model = opponentOf(humans);
  const human = humans?.standings[0];
  const agents = weekly?.week.standings.slice(0, 3) ?? [];
  const ends = weekly?.week.endsAt ?? humans?.week.endsAt;
  return (
    <Panel
      title={t("Contests")}
      meta={ends ? t("this week ends in {t}", { t: timeLeft(ends, now) }) : undefined}
      action={<More href="/contests">{t("All standings →")}</More>}
      className="lg:col-span-8"
      bodyClass="grid sm:grid-cols-2"
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

function Token() {
  return (
    <Panel title={<span className="flex items-center gap-2"><TokenDot />$ZOOAGENCY</span>} meta={t("on ClawPump")} className="lg:col-span-4" bodyClass="flex flex-col p-3.5">
      <ul className="border-t border-line">
        {["Pro at half price", "The weekly human contest", "Bot alerts 10 minutes first"].map((f) => (
          <li key={f} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[12.5px]">
            <span className="text-fg-2">{t(f)}</span>
            <span className="text-faint">{t("hold 500k")}</span>
          </li>
        ))}
      </ul>
      <CaRow id="home-ca" className="mt-3.5" />
      <BuyButton className="mt-2 w-full !h-9 !text-[13px]" />
      <div className="mt-3 flex gap-4 text-[12px]">
        <More href={ZOOAGENCY_DEXSCREENER_URL}>DexScreener ↗</More>
        <More href={ZOOAGENCY_SOLSCAN_URL}>Solscan ↗</More>
      </div>
    </Panel>
  );
}

/** The home: one screen that checks a coin, shows the tape and the record, then what else there is. Every number is read live; a part that cannot be read is left out. */
export default function Home() {
  const feedBody = useNorth<FeedBody>("/v1/chain/feed", 15_000);
  const usage = useNorth<Usage>("/v1/usage", 120_000);
  const chain = useNorth<Chain>("/v1/chain", 60_000);
  const record = useNorth<CheckRecord>("/v1/check/record", 120_000);
  const coins = useMemo(() => {
    const all = [...(feedBody?.new ?? []), ...(feedBody?.soon ?? []), ...(feedBody?.migrated ?? [])];
    const seen = new Set<string>();
    return all
      .filter((c) => c.mint && !seen.has(c.mint) && seen.add(c.mint))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30);
  }, [feedBody]);

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 px-4 pb-8 pt-4 sm:px-5 lg:grid-cols-12">
      <Hero usage={usage} chain={chain} record={record} feed={coins} />
      <Record record={record} />
      <LiveStrip coins={coins} live={!!feedBody?.stream?.live} />
      <Extension usage={usage} />
      <Bot />
      <Pro />
      <Contests />
      <Token />
    </div>
  );
}
