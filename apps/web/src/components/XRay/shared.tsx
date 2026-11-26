import { NODE_URLS } from "../../sim/live";
import { addressIn } from "../../chain";
import type { WalletTag } from "../WalletTags";
import { t } from "../../i18n";
import { WalletLink } from "../WalletProfile";
import { launchOutcome } from "../../outcome";
import { short } from "../../format";
import type { Verdict, XRayReport } from "./types";

export const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";

/**
 * A caution split the way the bot says it: the coin's story first, then what is worse than usual, and last in short
 * what most caution coins with buyers carry (a dev who sold, a sniper ring, a sold launch bundle), so it does not bury
 * what is this coin's own. Mirrors splitReasons in the node's telegram.ts.
 */
const COMMON: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^the creator (?:has )?sold (\d+)% of their own bag$/, (m) => t("dev sold {p}%", { p: m[1]! })],
  [/^\d+ wallets bought (\d+)% of the supply in the launch block and have sold (\d+)% of it$/, (m) => t("launch bundle of {a}%, {b}% of it sold", { a: m[1]!, b: m[2]! })],
  [/^(\d+) of the first-second wallets have sniped launches together before: one operator$/, (m) => t("sniper ring {n}", { n: m[1]! })],
  [/^(\d+) serial snipers got in first/, (m) => t("serial snipers {n}", { n: m[1]! })],
  [/^at least (\d+)% of the trading is wallets selling back/, (m) => t("at least {p}% churn", { p: m[1]! })],
];
const FIRST = [/keep sniping this creator's other launches/, /^the wallet that funded this creator/, /^this creator dumped/];
const STORY = /^the dev who launched it dumps their launches and already sold|^this dev sells early, yet/;
export function splitReasons(reasons: string[]): { story: string[]; worse: string[]; common: string[] } {
  const story: string[] = [];
  const worse: string[] = [];
  const common: string[] = [];
  for (const r of reasons) {
    if (STORY.test(r)) {
      story.push(r);
      continue;
    }
    const hit = COMMON.map(([re, say]) => [r.match(re), say] as const).find(([m]) => m);
    if (hit) common.push(hit[1](hit[0]!));
    else worse.push(r);
  }
  const rank = (r: string) => {
    const i = FIRST.findIndex((re) => re.test(r));
    return i < 0 ? FIRST.length : i;
  };
  return { story, worse: worse.sort((a, b) => rank(a) - rank(b)), common };
}

/** A cap in dollars at the SOL price the node sent, as the bot says it; in SOL when there is no price. */
export const capOf = (sol: number, solUsd: number | null | undefined) => {
  if (!solUsd) return `${sol.toLocaleString("en-US")} SOL`;
  const v = sol * solUsd;
  return v >= 999_500 ? `$${(v / 1e6).toFixed(1)}M` : v >= 9_950 ? `$${Math.round(v / 1e3)}K` : `$${(v / 1e3).toFixed(1)}K`;
};
/** Where the token was launched, as people know the places. */
export const VENUE: Record<string, string> = { "pump.fun": "pump.fun", launchlab: "Raydium LaunchLab", dbc: "Meteora", raydium: "Raydium", cpmm: "Raydium CPMM", stonk: "StonkFun", fourmeme: "four.meme", flap: "Flap", clanker: "Clanker" };
/** The launchpad and, when it names one, the platform on it: "StonkFun", "Flap · tax 9%", "Clanker · Bankr". */
export const venueLabel = (f: { venue?: string; platform?: string } | null | undefined) => {
  const v = f?.venue ?? "pump.fun";
  const p = f?.platform;
  if (p && VENUE[p]) return VENUE[p];
  return p ? `${VENUE[v] ?? v} · ${p}` : (VENUE[v] ?? v);
};
/** How old the token is: from the stream's facts, or from its launch time when it is older than the stream. */
export const ageOf = (r: XRayReport) => {
  const m = r.check.facts?.ageMin ?? Math.max(0, Math.round((Date.now() - r.createdAt) / 60_000));
  return m < 120 ? t("{m} min old", { m }) : m < 2_880 ? t("{h} h old", { h: Math.round(m / 60) }) : t("{d} days old", { d: Math.round(m / 1_440) });
};
export const mintIn = addressIn;

/** The verdict as one word, the way the dashboard and the share card both say it. */
export const VWORD: Record<string, { w: string; long?: boolean }> = {
  avoid: { w: "Avoid" },
  caution: { w: "Caution" },
  pass: { w: "No red flags", long: true },
  unknown: { w: "Not on the stream", long: true },
};

export const TONE: Record<Verdict, { label: string; color: string }> = {
  avoid: { label: "AVOID", color: "#ff5a4f" },
  caution: { label: "CAUTION", color: "#e8a23a" },
  pass: { label: "NO RED FLAGS", color: "#f4f5f4" },
  unknown: { label: "NOT ON THE STREAM", color: "#e6e9e7" },
};

export function Stat({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line py-2 first:border-t-0">
      <span className="text-[13px] font-normal text-fg-4">{t(k)}</span>
      <span className={`tabular-nums text-[13px] ${bad ? "text-[#ff5a4f]" : "text-fg-2"}`}>{v}</span>
    </div>
  );
}

export function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-line bg-night-surface p-3.5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-medium text-white">{t(title)}</h3>
        {note && <span className="tabular-nums text-[13px] text-fg-4">{t(note)}</span>}
      </div>
      {children}
    </div>
  );
}

/** Opens a wallet's own page inside the X-Ray. */
export const openWallet = (w: string) => window.dispatchEvent(new CustomEvent("zoo-wallet", { detail: w }));

/** A wallet: its page in the X-Ray, and a small link out to Solscan. A token address passes its own href. */
export function Addr({ a, href, className = "" }: { a: string; href?: string; className?: string }) {
  if (href)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`tabular-nums underline decoration-line-2 underline-offset-4 hover:text-white hover:decoration-dim ${className}`}>
        {short(a)} ↗
      </a>
    );
  return <WalletLink a={a} onWallet={openWallet} className={className} />;
}

/** A dev's launch, right-aligned: how fast they sold (red when they did), then what they took and who was left holding. */
export function Outcome({ x }: { x: Parameters<typeof launchOutcome>[0] }) {
  const o = launchOutcome(x);
  return (
    <span className="tabular-nums shrink-0 text-right text-[13px] leading-snug">
      <span className={o.dumped ? "text-[#ff5a4f]" : "text-fg-3"}>{o.head}</span>
      {o.tail && <span className="block text-[12.5px] text-fg-4">{o.tail}</span>}
    </span>
  );
}

/** Tags the "who" column already says; the row shows only what it does not. */
export const KIND_TAGS = new Set<WalletTag>(["crew", "ring", "serial", "bundle"]);

/**
 * Who holds it, at a glance under the verdict on every tab: the ten largest wallets, the largest one, the dev, the
 * bundlers, the first-five-seconds wallets and the dev's crew, and what sits in the curve or pool. Red past the line
 * where that share alone can decide the price.
 */
export function HoldStrip({ c }: { c: XRayReport["check"] }) {
  const f = c.facts;
  const h = c.holders;
  const cells: Array<{ k: string; v: number; bad: boolean }> = [];
  if (h && h.top10Pct > 0) {
    cells.push({ k: t("top 10"), v: h.top10Pct, bad: h.top10Pct >= 50 });
    cells.push({ k: t("largest"), v: h.topWalletPct, bad: h.topWalletPct >= 20 });
  }
  if (h?.creatorHoldsPct !== null && h?.creatorHoldsPct !== undefined) cells.push({ k: t("dev"), v: h.creatorHoldsPct, bad: h.creatorHoldsPct >= 5 });
  if (f?.bundlers) cells.push({ k: t("bundlers"), v: f.bundlersHeldPct ?? 0, bad: (f.bundlersHeldPct ?? 0) >= 20 });
  if (f?.earlyWallets) cells.push({ k: t("first 5 s"), v: f.earlyHeldPct ?? 0, bad: (f.earlyHeldPct ?? 0) >= 30 });
  if (f?.crewHeldPct) cells.push({ k: t("dev's crew"), v: f.crewHeldPct, bad: f.crewHeldPct >= 5 });
  if (h?.programPct) cells.push({ k: t("curve / pool"), v: h.programPct, bad: false });
  if (!cells.length) return null;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="tabular-nums text-[12px] [&::first-letter]:uppercase text-fg-4">{t("who holds it")}</p>
      <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2">
        {cells.map((x) => (
          <div key={x.k} className="min-w-0">
            <p className={`tabular-nums text-[15px] leading-none ${x.bad ? "text-[#ff5a4f]" : "text-fg"}`}>{x.v}%</p>
            <p className="mt-1 truncate text-[12px] font-normal text-fg-4">{x.k}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
