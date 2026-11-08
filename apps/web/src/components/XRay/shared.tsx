import { NODE_URLS } from "../../sim/live";
import { addressIn } from "../../chain";
import type { WalletTag } from "../WalletTags";
import { t } from "../../i18n";
import { WalletLink } from "../WalletProfile";
import { launchOutcome } from "../../outcome";
import { short } from "../../format";
import type { Verdict, XRayReport } from "./types";

export const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
/** Where the token was launched, as people know the places. */
export const VENUE: Record<string, string> = { "pump.fun": "pump.fun", launchlab: "Raydium LaunchLab", dbc: "Meteora", stonk: "StonkFun", fourmeme: "four.meme", flap: "Flap", clanker: "Clanker" };
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

export const TONE: Record<Verdict, { label: string; color: string }> = {
  avoid: { label: "AVOID", color: "#ff8a7e" },
  caution: { label: "CAUTION", color: "#ffc27a" },
  pass: { label: "NO RED FLAGS", color: "#a6e3b4" },
  unknown: { label: "NOT ON THE STREAM", color: "#e6e9e7" },
};

export function Stat({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-white/[0.08] py-2 first:border-t-0">
      <span className="text-[13px] font-normal text-fg-4">{t(k)}</span>
      <span className={`tabular-nums text-[13px] ${bad ? "text-[#ff8a7e]" : "text-fg-2"}`}>{v}</span>
    </div>
  );
}

export function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-5 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl text-fg">{t(title)}</h3>
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
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`tabular-nums underline decoration-white/15 underline-offset-4 hover:text-white hover:decoration-white/50 ${className}`}>
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
      <span className={o.dumped ? "text-[#ff8a7e]" : "text-fg-3"}>{o.head}</span>
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
    <div className="mt-3 border-t border-white/[0.08] pt-3">
      <p className="tabular-nums text-[12px] [&::first-letter]:uppercase text-fg-4">{t("who holds it")}</p>
      <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2">
        {cells.map((x) => (
          <div key={x.k} className="min-w-0">
            <p className={`tabular-nums text-[15px] leading-none ${x.bad ? "text-[#ff8a7e]" : "text-fg"}`}>{x.v}%</p>
            <p className="mt-1 truncate text-[12px] font-normal text-fg-4">{x.k}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
