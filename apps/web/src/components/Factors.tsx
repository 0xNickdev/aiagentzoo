import { t } from "../i18n";
import type { XRayReport } from "./XRay";

/** One counted factor: what it is, the number, what the number means, and whether it is a warning. */
interface Factor {
  k: string;
  v: string;
  d: string;
  bad: boolean;
  good?: boolean;
}

/**
 * Every factor the chain shows about a coin, each as a number: the dev, who paid the dev, who bought in the first
 * seconds and who holds now. The odds say how launches like this one went; this says what this one is made of.
 */
export function factorsOf(r: XRayReport): Factor[] {
  const f = r.check.facts;
  if (!f) return [];
  const early = r.early ?? [];
  const tagged = (tag: string) => early.filter((e) => e.tags?.includes(tag as never)).length;
  const share = (tag: string) => Math.round(early.filter((e) => e.tags?.includes(tag as never)).reduce((n, e) => n + e.bought, 0) * 100);
  const rec = r.creatorRecord;
  const fund = r.funding;
  const hd = r.check.holders;
  const cabals = new Set(early.map((e) => e.cabal).filter((c): c is number => c != null));
  const out: Factor[] = [];

  if (rec) out.push({ k: t("dev dumped, 48h"), v: `${rec.dumped} / ${rec.launches48h}`, d: rec.medianDumpMin !== null ? t("of their launches, median after {m} min", { m: rec.medianDumpMin }) : t("of their launches"), bad: rec.dumped >= 2 });
  else out.push({ k: t("dev dumped, 48h"), v: t("first launch"), d: t("no other launches on our stream"), bad: false });
  if (f.creatorSoldPct !== null && f.creatorSoldPct !== undefined) out.push({ k: t("dev sold"), v: `${f.creatorSoldPct}%`, d: t("of their own bag"), bad: f.creatorSoldPct >= 50 });
  if (hd?.creatorHoldsPct !== null && hd?.creatorHoldsPct !== undefined) out.push({ k: t("dev holds now"), v: `${hd.creatorHoldsPct}%`, d: t("of the supply"), bad: hd.creatorHoldsPct >= 10 });
  if (fund?.funder) {
    const v = fund.funderService ? t("{x} launcher", { x: fund.funderService }) : fund.funderLabel ? fund.funderLabel : fund.funderIsHot ? t("an exchange") : fund.siblings.length ? t("{n} other devs", { n: fund.siblings.length }) : t("only this dev");
    const d = fund.funderService || fund.funderLabel || fund.funderIsHot ? t("pays everyone, ties no one together") : fund.siblings.length ? t("{d} dumps between them in 48h", { d: fund.siblingDumped48h }) : t("paid no other dev we traced");
    out.push({ k: t("who paid the dev"), v, d, bad: !fund.funderIsHot && !fund.funderService && !fund.funderLabel && fund.siblingDumped48h >= 3 });
  }
  if (f.creatorCrew !== null) out.push({ k: t("dev's own wallets"), v: String(f.creatorCrew), d: f.crewHeldPct ? t("still hold {p}%", { p: f.crewHeldPct }) : t("snipe this dev's launches"), bad: f.creatorCrew >= 2 });

  if (f.earlyWallets !== null) out.push({ k: t("first 5 seconds"), v: f.earlyWallets === 1 ? t("1 wallet") : t("{n} wallets", { n: f.earlyWallets }), d: t("still hold {p}%", { p: f.earlyHeldPct ?? 0 }), bad: (f.earlyHeldPct ?? 0) >= 30 });
  out.push({ k: t("known ruggers"), v: String(tagged("rugger")), d: t("wallets that rugged their own launches"), bad: tagged("rugger") >= 1 });
  out.push({ k: t("whales"), v: String(tagged("whale")), d: tagged("whale") ? t("took {p}% of the supply between them", { p: share("whale") }) : t("no first buyer took 2% or more"), bad: share("whale") >= 20 });
  out.push({ k: t("new wallets"), v: String(tagged("new")), d: t("never seen by the zoo before this launch"), bad: false });
  if (tagged("kol") + tagged("kolside")) out.push({ k: t("KOL wallets"), v: String(tagged("kol") + tagged("kolside")), d: tagged("kolside") ? t("{n} of them side wallets", { n: tagged("kolside") }) : t("listed on Kolscan"), bad: false });
  if (tagged("smart")) out.push({ k: t("smart money"), v: String(tagged("smart")), d: t("wallets with a winning record"), bad: false, good: true });
  out.push({ k: t("sniper ring · serial"), v: `${f.ringWallets ?? 0} · ${f.serialSnipers ?? 0}`, d: t("snipe launches to sell"), bad: (f.ringWallets ?? 0) >= 3 });
  if (cabals.size) out.push({ k: t("cabals"), v: String(cabals.size), d: t("wallets the memory ties together"), bad: true });

  if (f.bundlers) out.push({ k: t("bundle"), v: t("{n} wallets", { n: f.bundlers }), d: t("hold {p}% · peak {q}%", { p: f.bundlersHeldPct ?? 0, q: f.bundlersPeakPct ?? 0 }), bad: (f.bundlersHeldPct ?? 0) >= 20 });
  if (hd && hd.top10Pct > 0) out.push({ k: t("top 10 holders"), v: `${hd.top10Pct}%`, d: t("largest wallet {p}%", { p: hd.topWalletPct }), bad: hd.top10Pct >= 50 || hd.topWalletPct >= 20 });
  if (hd?.devLockedPct !== undefined) {
    const others = Math.round(((hd.lockedPct ?? 0) - hd.devLockedPct) * 10) / 10;
    out.push({ k: t("dev locked"), v: hd.devLockedPct ? `${hd.devLockedPct}%` : t("nothing"), d: hd.devLockedPct ? (others > 0 ? t("of the supply, until its date; others locked {p}% more", { p: others }) : t("of the supply, in a locker until its date")) : others > 0 ? t("others locked {p}% of the supply", { p: others }) : t("no lock in Streamflow or Jupiter Lock"), bad: false, good: hd.devLockedPct >= 1 });
  } else if (hd?.lockedPct !== undefined) out.push({ k: t("locked supply"), v: hd.lockedPct ? `${hd.lockedPct}%` : t("none"), d: hd.lockedPct ? t("in a locker until its date: Streamflow, Jupiter Lock or Raydium") : t("no tokens in Streamflow, Jupiter Lock or Raydium's locker"), bad: false, good: hd.lockedPct >= 10 });
  if (hd?.burnedPct !== undefined) out.push({ k: t("burned"), v: hd.burnedPct ? `${hd.burnedPct}%` : t("none"), d: hd.burnedPct ? t("of the billion minted, gone for good") : t("all of the billion minted is still out"), bad: false });
  if (f.churnPct !== null) out.push({ k: t("churn"), v: `${f.churnPct}%`, d: f.bumps ? t("{n} bump bot trades", { n: f.bumps }) : t("volume sold back by the buyers"), bad: f.churnPct >= 30 });
  const tk = r.ticker;
  if (tk) out.push({ k: t("ticker used before"), v: tk.launches ? `${tk.launches}×` : t("first time"), d: tk.launches ? (tk.devs === 1 ? t("in {d} days, all by one dev, {x} dumped", { d: tk.days, x: tk.dumped }) : t("in {d} days by {n} devs, {x} dumped by their dev", { d: tk.days, n: tk.devs, x: tk.dumped })) : t("no other launch with this ticker in {d} days", { d: tk.days }), bad: tk.launches >= 3 && tk.dumped >= 2 });
  const reused = r.socials?.filter((s) => s.launches > 1) ?? [];
  if (reused.length) out.push({ k: t("socials reused"), v: String(Math.max(...reused.map((s) => s.launches))), d: t("launches with the same links, {n} fast dumps", { n: reused.reduce((a, s) => a + s.fastDumps, 0) }), bad: reused.some((s) => s.fastDumps >= 1) });
  return out;
}

export default function FactorsCard({ r }: { r: XRayReport }) {
  const rows = factorsOf(r);
  if (!rows.length) return null;
  const flags = rows.filter((x) => x.bad).length;
  return (
    <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] font-semibold text-fg">{t("Every factor, counted")}</p>
        <span className="tabular-nums text-[12px] text-fg-4">{flags ? t("{n} of {m} look bad", { n: flags, m: rows.length }) : t("none of {m} look bad", { m: rows.length })}</span>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/[0.06] sm:grid-cols-2">
        {rows.map((x) => (
          <div key={x.k} className="flex items-baseline justify-between gap-3 bg-night-surface px-4 py-3">
            <div className="min-w-0">
              <dt className="text-[13px] text-fg-2">{x.k}</dt>
              <p className="mt-0.5 text-[11.5px] leading-snug text-fg-4">{x.d}</p>
            </div>
            <dd className={`tabular-nums shrink-0 text-right text-[17px] font-semibold ${x.bad ? "text-[#ff8a7e]" : x.good ? "text-[#a6e3b4]" : "text-fg"}`}>{x.v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[12px] leading-relaxed text-fg-4">{r.check.odds ? t("Read from the chain for this coin. The odds above say how launches like it went; these are the parts it is made of. Red marks a number we have seen go with rugs.") : t("Read from the chain for this coin. Red marks a number we have seen go with rugs.")}</p>
    </div>
  );
}
