import { chainName, chainOf } from "../../chain";
import { t } from "../../i18n";
import { pctFine, short } from "../../format";
import type { XRayReport } from "./types";

/** The lines that decide it, in one row: who launched it, who got in first, who paid, who holds. Each opens its panel. */
export function KeyFacts({ r, go }: { r: XRayReport; go: (id: string) => void }) {
  const c = r.check;
  const f = c.facts;
  const took = r.early.reduce((n, e) => n + e.bought, 0);
  const holds = r.early.reduce((n, e) => n + e.held, 0);
  const fund = r.funding;
  const rec = r.creatorRecord;
  // Older than the stream: the launch was never seen, so its cells say so instead of reading empty data as facts.
  const old = !!r.outsideStream;
  const kept = r.devHistory;
  const cells: Array<{ id: string; k: string; v: string; sub: string; bad: boolean }> = [
    {
      id: "xr-creator",
      k: "The creator",
      v: old ? (kept ? t("{d} of {n} dumped", { d: kept.dumped, n: kept.launches }) : "-") : rec ? t("{d} of {n} dumped", { d: rec.dumped, n: rec.launches48h }) : t("first launch"),
      sub: old ? (kept ? t("launches we kept") : t("no launches we kept")) : f?.creatorSoldPct === null || f?.creatorSoldPct === undefined ? t("never bought their own") : t("sold {p}% of their bag", { p: f.creatorSoldPct }),
      bad: old ? (kept?.dumped ?? 0) >= 2 : (rec?.dumped ?? 0) >= 2 || (f?.creatorSoldPct ?? 0) >= 50,
    },
    {
      id: "xr-five",
      k: "The first 5 seconds",
      v: old ? "-" : r.early.length ? t("{n} wallets", { n: r.early.length }) : t("nobody"),
      sub: old ? t("before our stream") : r.early.length ? t("took {a} · hold {b}", { a: pctFine(took), b: pctFine(holds) }) : t("no one bought before it was visible"),
      bad: took >= 0.25 || (f?.creatorCrew ?? 0) >= 2,
    },
    {
      id: "xr-funder",
      k: "Who paid for the creator",
      v: !fund ? (chainOf(r.mint) === "solana" ? t("tracing…") : t("not on {chain} yet", { chain: chainName(r.mint) })) : !fund.funder ? t("no transfer found") : fund.funderService ? t("{x} launcher", { x: fund.funderService }) : fund.funderLabel ? t("withdrawn from {x}", { x: fund.funderLabel }) : fund.funderIsHot ? t("an exchange") : fund.siblings.length ? t("{n} other creators", { n: fund.siblings.length }) : t("only this creator"),
      sub: fund?.funder && !fund.funderIsHot ? (fund.siblings.length ? t("{d} dumps in 48h", { d: fund.siblingDumped48h }) : t("funded {w}", { w: short(fund.funder) })) : fund?.funderService ? t("pays for every launch") : fund?.funderIsHot ? t("funds everyone, ties no one") : "",
      bad: !!fund?.funder && !fund.funderIsHot && fund.siblingDumped48h >= 3,
    },
    {
      id: "xr-holders",
      k: "Holders now",
      v: !c.holders ? "-" : c.holders.top10Pct === 0 ? t("nobody holds it") : t("top 10 hold {p}%", { p: c.holders.top10Pct }),
      sub: !c.holders ? (chainOf(r.mint) === "solana" ? t("could not be read right now") : t("not read on {chain} yet", { chain: chainName(r.mint) })) : c.holders.top10Pct === 0 ? (c.holders.programPct ? t("{p}% sits in the curve or pool", { p: c.holders.programPct }) : t("everyone sold back to the curve")) : t("largest wallet {p}%", { p: c.holders.topWalletPct }),
      bad: (c.holders?.top10Pct ?? 0) >= 50,
    },
  ];
  return (
    <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06] lg:grid-cols-4">
      {cells.map((x) => (
        <button key={x.id} type="button" onClick={() => go(x.id)} className="group bg-night-surface px-4 py-3.5 text-left transition hover:bg-night-surface">
          <p className="text-[13px] text-fg-3">{t(x.k)}</p>
          <p className={`tabular-nums mt-1 text-[16px] ${x.bad ? "text-[#ff8a7e]" : "text-fg"}`}>{x.v}</p>
          <p className="mt-0.5 truncate text-[13px] font-normal text-fg-3 group-hover:text-fg-3">{x.sub || " "}</p>
        </button>
      ))}
    </div>
  );
}
