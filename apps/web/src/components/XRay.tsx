import { AnimatePresence, motion } from "framer-motion";
import { type FormEvent, useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section } from "./ui";
import { t, tChain } from "../i18n";

type Verdict = "avoid" | "caution" | "pass" | "unknown";

interface Early {
  wallet: string;
  bought: number;
  held: number;
  afterSec: number;
  exitSec: number | null;
  bundle: boolean;
  snipes48h: number;
  crew: boolean;
  ring: boolean;
  serial: boolean;
}

interface Check {
  verdict: Verdict;
  reasons: string[];
  notes: string[];
  facts: {
    ageMin: number;
    buyers: number;
    buys: number;
    sells: number;
    creatorSoldPct: number | null;
    creatorLaunches24h: number;
    creatorDumped48h: number | null;
    creatorMedianDumpMin: number | null;
    bundleWallets: number | null;
    bundleSharePct: number | null;
    graduated: boolean;
    mayhem?: boolean;
    venue?: "pump.fun" | "launchlab" | "dbc";
    earlyWallets: number | null;
    earlyHeldPct: number | null;
    churnPct: number | null;
    bumps: number | null;
    creatorCrew: number | null;
    ringWallets: number | null;
    serialSnipers: number | null;
  } | null;
  holders?: { top10Pct: number; topWalletPct: number; creatorHoldsPct: number | null } | null;
}

interface Funding {
  funder: string | null;
  funderIsHot: boolean;
  siblings: Array<{ wallet: string; launches48h: number; dumped: number }>;
  siblingLaunches48h: number;
  siblingDumped48h: number;
}

interface XRayReport {
  mint: string;
  symbol: string;
  name: string;
  creator: string;
  createdAt: number;
  check: Check;
  early: Early[];
  creatorRecord: { launches48h: number; dumped: number; medianDumpMin: number | null } | null;
  funding: Funding | null;
  bundle: { wallets: Array<{ wallet: string; share: number }>; funding: { groups: Array<{ funder: string; wallets: string[] }>; linked: number; checked: number } | null };
}

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
/** Where the token was launched, as people know the places. */
const VENUE: Record<string, string> = { "pump.fun": "pump.fun", launchlab: "Raydium LaunchLab", dbc: "Meteora" };
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");
const mintIn = (text: string) => text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;

const TONE: Record<Verdict, { label: string; color: string }> = {
  avoid: { label: "AVOID", color: "#ff8a7e" },
  caution: { label: "CAUTION", color: "#f2d39b" },
  pass: { label: "NO RED FLAGS", color: "#9df3b0" },
  unknown: { label: "NOT ON THE STREAM", color: "#e9e4d8" },
};

/** Colour of a wallet on the map: who it is matters more than how much it took. */
const kindOf = (e: Early) => (e.crew ? "crew" : e.ring ? "ring" : e.serial ? "serial" : e.bundle ? "bundle" : "early");
const KIND: Record<string, { color: string; label: string }> = {
  crew: { color: "#ff8a7e", label: "creator's crew" },
  ring: { color: "#f2b56b", label: "sniper ring" },
  serial: { color: "#c9b48a", label: "serial sniper" },
  bundle: { color: "#9fc3ff", label: "launch block" },
  early: { color: "#e9e4d8", label: "first 5 s" },
};

/**
 * The first five seconds as a map: the creator in the middle, every wallet that got in before anyone could see the
 * token around it. Size is what it took, a filled bubble still holds, a hollow one sold out. Crew wallets sit next to
 * the creator, ring members are tied together.
 */
function EarlyMap({ r }: { r: XRayReport }) {
  const W = 560;
  const H = 400;
  const cx = W / 2;
  const cy = H / 2;
  const list = r.early.slice(0, 24);
  const inner = list.filter((e) => e.crew);
  const outer = list.filter((e) => !e.crew);
  const place = (arr: Early[], radius: number, offset: number) =>
    arr.map((e, i) => {
      const a = offset + (i / Math.max(1, arr.length)) * Math.PI * 2;
      return { e, x: cx + Math.cos(a) * radius * 1.45, y: cy + Math.sin(a) * radius };
    });
  const nodes = [...place(inner, 78, -Math.PI / 2), ...place(outer, 150, -Math.PI / 3)];
  const size = (e: Early) => 7 + Math.sqrt(Math.max(0, e.bought)) * 105;
  const ring = nodes.filter((n) => n.e.ring);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t("Wallets in the first 5 seconds")}>
      {/* ring members tied to each other, crew tied to the creator */}
      {ring.map((a, i) => ring.slice(i + 1).map((b) => <line key={`${a.e.wallet}${b.e.wallet}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f2b56b" strokeOpacity="0.25" strokeWidth="1" />))}
      {nodes.filter((n) => n.e.crew).map((n) => <line key={`c${n.e.wallet}`} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke="#ff8a7e" strokeOpacity="0.45" strokeWidth="1.2" />)}
      {nodes.map((n) => {
        const k = KIND[kindOf(n.e)]!;
        const held = n.e.bought > 0 ? n.e.held / n.e.bought : 0;
        return (
          <g key={n.e.wallet}>
            <title>{`${n.e.wallet}\n${t(k.label)} · ${t("took")} ${pct(n.e.bought)} · ${t("holds")} ${pct(n.e.held)} · ${t("{n} snipes in 48h", { n: n.e.snipes48h })}`}</title>
            <circle cx={n.x} cy={n.y} r={size(n.e)} fill={k.color} fillOpacity={0.08 + held * 0.55} stroke={k.color} strokeOpacity="0.85" strokeWidth="1" />
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="15" fill="#030504" stroke="white" strokeOpacity="0.8" />
      <text x={cx} y={cy + 4} textAnchor="middle" className="font-mono" fontSize="10" fill="white" fillOpacity="0.85">
        dev
      </text>
      {!list.length && (
        <text x={cx} y={cy + 44} textAnchor="middle" className="font-mono" fontSize="11" fill="white" fillOpacity="0.45">
          {t("nobody bought in the first 5 seconds")}
        </text>
      )}
    </svg>
  );
}

function Stat({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-white/[0.06] py-2 first:border-t-0">
      <span className="text-[12.5px] font-light text-white/55">{t(k)}</span>
      <span className={`font-mono text-[13px] ${bad ? "text-[#ff8a7e]" : "text-white/85"}`}>{v}</span>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="liquid-glass rounded-3xl p-5 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl text-white/90">{t(title)}</h3>
        {note && <span className="font-mono text-[10.5px] text-white/40">{t(note)}</span>}
      </div>
      {children}
    </div>
  );
}

function Report({ r }: { r: XRayReport }) {
  const c = r.check;
  const f = c.facts;
  const tone = TONE[c.verdict];
  const early = r.early;
  const took = early.reduce((n, e) => n + e.bought, 0);
  const holds = early.reduce((n, e) => n + e.held, 0);
  const fund = r.funding;
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-5 pb-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="liquid-glass rounded-3xl p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-white/45">
                ${r.symbol} · {r.name} · {t("{m} min old", { m: f?.ageMin ?? 0 })}
                {` · ${VENUE[f?.venue ?? "pump.fun"]}`}
                {f?.mayhem ? ` · ${t("Mayhem Mode")}` : ""}
              </p>
              <p className="font-display mt-2 text-4xl sm:text-5xl" style={{ color: tone.color }}>
                {t(tone.label)}
              </p>
            </div>
            <a href={!f?.venue || f.venue === "pump.fun" ? `https://pump.fun/coin/${r.mint}` : `https://dexscreener.com/solana/${r.mint}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-white/50 underline decoration-white/20 underline-offset-4 hover:text-white">
              {short(r.mint)} ↗
            </a>
          </div>
          {c.reasons.length > 0 && (
            <ul className="mt-5 space-y-2">
              {c.reasons.map((x) => (
                <li key={x} className="flex gap-3 text-[14px] font-light leading-snug text-white/80">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.color }} />
                  {tChain(x)}
                </li>
              ))}
            </ul>
          )}
          {c.notes.length > 0 && (
            <p className="mt-4 text-[12px] font-light leading-relaxed text-white/45">{c.notes.map(tChain).join(" · ")}</p>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Panel title="The first 5 seconds" note="before anyone could see it">
            <EarlyMap r={r} />
            <div className="font-mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-white/50">
              {Object.entries(KIND).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: v.color }} />
                  {t(v.label)}
                </span>
              ))}
              <span>{t("filled = still holds · hollow = sold out")}</span>
            </div>
          </Panel>
          <div className="space-y-4">
            <Panel title="Insiders">
              <Stat k="wallets in the first 5 seconds" v={String(early.length)} />
              <Stat k="supply they took" v={pct(took)} bad={took >= 0.25} />
              <Stat k="supply they still hold" v={pct(holds)} bad={holds >= 0.25} />
              <Stat k="the creator's own crew" v={String(f?.creatorCrew ?? 0)} bad={(f?.creatorCrew ?? 0) >= 2} />
              <Stat k="in a sniper ring" v={String(f?.ringWallets ?? 0)} bad={(f?.ringWallets ?? 0) >= 3} />
              <Stat k="serial snipers" v={String(f?.serialSnipers ?? 0)} />
            </Panel>
            <Panel title="Volume">
              <Stat k="buyers" v={String(f?.buyers ?? 0)} />
              <Stat k="buys · sells" v={`${f?.buys ?? 0} · ${f?.sells ?? 0}`} />
              <Stat k="churned volume (at least)" v={f?.churnPct === null || f?.churnPct === undefined ? "-" : `${f.churnPct}%`} bad={(f?.churnPct ?? 0) >= 30 && !f?.mayhem} />
              <Stat k="bump bot trades" v={String(f?.bumps ?? 0)} bad={(f?.bumps ?? 0) >= 3 && !f?.mayhem} />
            </Panel>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="The creator" note="last 48 hours">
            <Stat k="launches" v={String(r.creatorRecord?.launches48h ?? 1)} bad={(r.creatorRecord?.launches48h ?? 1) >= 3} />
            <Stat k="dumped" v={String(r.creatorRecord?.dumped ?? 0)} bad={(r.creatorRecord?.dumped ?? 0) >= 2} />
            <Stat k="sold of their own bag" v={f?.creatorSoldPct === null || f?.creatorSoldPct === undefined ? t("never bought") : `${f.creatorSoldPct}%`} bad={(f?.creatorSoldPct ?? 0) >= 50} />
            <Stat k="launch block" v={f?.bundleWallets ? t("{n} wallets · {p}%", { n: f.bundleWallets, p: f.bundleSharePct ?? 0 }) : t("none")} bad={(f?.bundleSharePct ?? 0) >= 15} />
          </Panel>
          <Panel title="Who paid for the creator" note="traced on Solana">
            {!fund && <p className="text-[13px] font-light text-white/50">{t("Not traced yet. It is queued: open this again in a minute.")}</p>}
            {fund && !fund.funder && <p className="text-[13px] font-light text-white/50">{t("No funding transfer in the creator's recent history.")}</p>}
            {fund?.funder && (
              <>
                <Stat k="funded by" v={short(fund.funder)} />
                {fund.funderIsHot ? (
                  <p className="mt-2 text-[12.5px] font-light text-white/50">{t("An exchange or a router: it funds everyone, so it ties no one together.")}</p>
                ) : (
                  <>
                    <Stat k="other creators it funded" v={String(fund.siblings.length)} bad={fund.siblings.length >= 2} />
                    <Stat k="their launches · dumps (48h)" v={`${fund.siblingLaunches48h} · ${fund.siblingDumped48h}`} bad={fund.siblingDumped48h >= 3} />
                  </>
                )}
              </>
            )}
          </Panel>
          <Panel title="Holders now" note="read from Solana">
            {!c.holders && <p className="text-[13px] font-light text-white/50">{t("Holders could not be read right now.")}</p>}
            {c.holders && (
              <>
                <Stat k="largest wallet" v={`${c.holders.topWalletPct}%`} bad={c.holders.topWalletPct >= 20} />
                <Stat k="10 largest wallets" v={`${c.holders.top10Pct}%`} bad={c.holders.top10Pct >= 50} />
                <Stat k="the creator holds" v={c.holders.creatorHoldsPct === null ? "-" : `${c.holders.creatorHoldsPct}%`} />
              </>
            )}
          </Panel>
        </div>

        {early.length > 0 && (
          <div className="liquid-glass overflow-hidden rounded-3xl">
            <div className="font-mono grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_5rem] gap-3 border-b border-white/[0.07] px-5 py-3 text-[10.5px] text-white/40 sm:grid-cols-[minmax(0,1fr)_9rem_5rem_5rem_5rem_6rem_6rem] sm:px-7">
              <span>{t("wallet")}</span>
              <span className="hidden sm:block">{t("who")}</span>
              <span className="text-right">{t("took")}</span>
              <span className="text-right">{t("holds")}</span>
              <span className="hidden text-right sm:block">{t("in at")}</span>
              <span className="text-right">{t("sold out")}</span>
              <span className="hidden text-right sm:block">{t("snipes 48h")}</span>
            </div>
            {early.map((e) => {
              const k = KIND[kindOf(e)]!;
              return (
                <div key={e.wallet} className="font-mono grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_5rem] items-center gap-3 border-t border-white/[0.05] px-5 py-2.5 text-[12px] sm:grid-cols-[minmax(0,1fr)_9rem_5rem_5rem_5rem_6rem_6rem] sm:px-7">
                  <a href={`https://solscan.io/account/${e.wallet}`} target="_blank" rel="noopener noreferrer" className="truncate text-white/80 hover:text-white">
                    {short(e.wallet)}
                  </a>
                  <span className="hidden truncate sm:block" style={{ color: k.color }}>
                    {t(k.label)}
                  </span>
                  <span className="text-right text-white/70">{pct(e.bought)}</span>
                  <span className={`text-right ${e.held >= 0.05 ? "text-[#ff8a7e]" : "text-white/70"}`}>{pct(e.held)}</span>
                  <span className="hidden text-right text-white/55 sm:block">{e.afterSec}s</span>
                  <span className="text-right text-white/55">{e.exitSec === null ? "-" : e.exitSec < 120 ? `${e.exitSec}s` : `${Math.round(e.exitSec / 60)}m`}</span>
                  <span className={`hidden text-right sm:block ${e.snipes48h >= 10 ? "text-[#f2d39b]" : "text-white/55"}`}>{e.snipes48h}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="font-mono text-center text-[11px] text-white/40">
          {t("raw:")} <a href={`${NORTH}/v1/xray/${r.mint}`} className="underline decoration-white/25 underline-offset-4 hover:text-white">/v1/xray/{short(r.mint)}</a> · {t("Not financial advice. Read from public chain data.")}
        </p>
      </div>
    </motion.section>
  );
}

/** One token, seen through: who got in first, who they are across launches, who paid for the creator, what is churn. */
export default function XRay() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<XRayReport | null>(null);

  const run = async (mint: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${NORTH}/v1/xray/${mint}`);
      const body = (await r.json()) as XRayReport & { error?: string };
      if (r.status === 429) throw new Error(t("Ten x-rays a minute on the free tier. Try again in a minute."));
      if (!r.ok) throw new Error(body.error ? t("Not a launch the stream saw in the last two days (pump.fun, LaunchLab, Meteora).") : t("Something went wrong."));
      setReport(body);
      history.replaceState(null, "", `/xray?mint=${mint}`);
    } catch (err) {
      setReport(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const mint = mintIn(new URLSearchParams(location.search).get("mint") ?? "");
    if (mint) {
      setInput(mint);
      void run(mint);
    }
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const mint = mintIn(input);
    if (!mint) return setError(t("Paste a token address or link."));
    void run(mint);
  };

  return (
    <>
      <Section className="!pb-10" backdrop={{ src: "/backdrops/cycle.webp", tint: "160,190,220", glowAt: "50% 35%", opacity: 0.3 }}>
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="font-mono text-[12px] text-white/50">{t("X-Ray · every pump.fun, LaunchLab and Meteora trade, read live from Solana")}</p>
          <h1 className="font-display mt-4 text-5xl leading-[1.02] sm:text-6xl md:text-7xl">
            {t("See who you are")}
            <br />
            <span className="accent">{t("buying from.")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[15px] font-light leading-relaxed text-white/60">
            {t("The wallets that got in during the first five seconds, and who they are across every launch of the last two days: the creator's own crew, sniper rings, serial snipers. Who paid for the creator. How much of the volume is churn.")}
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <form onSubmit={submit} className="liquid-glass mx-auto mt-10 flex max-w-2xl flex-col gap-2 rounded-3xl p-2 sm:flex-row sm:rounded-full">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("token address: pump.fun, LaunchLab, Meteora")}
              spellCheck={false}
              autoComplete="off"
              className="font-mono min-w-0 flex-1 bg-transparent px-5 py-3 text-[14px] text-white outline-none placeholder:text-white/35"
              aria-label={t("Token address")}
            />
            <button type="submit" disabled={busy} className="rounded-full bg-white px-7 py-3 text-[14px] font-medium text-black transition hover:bg-white/90 disabled:opacity-60">
              {busy ? t("Reading the chain…") : t("X-ray it")}
            </button>
          </form>
          {error && <p className="mt-4 text-center text-[13px] text-[#ff9a8f]">{error}</p>}
        </Reveal>
      </Section>
      <AnimatePresence mode="wait">{report && <Report key={report.mint} r={report} />}</AnimatePresence>
    </>
  );
}
