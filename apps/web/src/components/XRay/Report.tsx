import { RightsStats } from "./Rights";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { chainName, chainOf, chart, unitOf, venueOfChain } from "../../chain";
import { Tags } from "../WalletTags";
import MoneyMap from "../MoneyMap";
import FactorsCard from "../Factors";
import { t } from "../../i18n";
import Swap from "../Swap";
import CopyCa from "../CopyCa";
import XRayRadar, { KIND, kindOf, secs } from "../XRayRadar";
import DevHabits from "../DevHabits";
import NetworkMap from "../NetworkMap";
import { pctFine, short } from "../../format";
import type { XRayReport } from "./types";
import { OddsCard, OddsPill } from "./Odds";
import { Addr, ageOf, HoldStrip, KIND_TAGS, NORTH, openWallet, Outcome, Panel, Stat, TONE, VENUE, venueLabel } from "./shared";
import { ShareBar } from "./ShareBar";
import { Dossier } from "./Dossier";
import { Summary } from "./Summary";
import { useMarket } from "./Market";
import { CallsTab, callsLine, useCalls } from "./Calls";
import { TERMINALS, TradeOnEvm } from "./Trade";

export type Tab = "overview" | "calls" | "network" | "dev" | "five" | "map" | "bundles" | "holders" | "wallets";

/** A report laid out like a terminal: the verdict and a menu of what decides it on the left, one section at a time on the right. */
export function Report({ r, onPick }: { r: XRayReport; onPick: (mint: string) => void }) {
  const c = r.check;
  const f = c.facts;
  const chain = chainOf(r.mint);
  const bsc = chain !== "solana";
  const where = chainName(r.mint);
  // The launchpad by name: the token's own venue when the stream saw it, else the one the zoo reads on that chain.
  const venue = f?.venue && f.venue !== "pump.fun" ? (VENUE[f.venue] ?? venueOfChain(r.mint)) : venueOfChain(r.mint);
  const tone = TONE[c.verdict];
  const early = r.early;
  const took = early.reduce((n, e) => n + e.bought, 0);
  const holds = early.reduce((n, e) => n + e.held, 0);
  const fund = r.funding;
  const rec = r.creatorRecord;
  // ?tab=network opens a tab straight away, so a link can point at the map
  const askedTab = () => {
    const q = new URLSearchParams(window.location.search).get("tab");
    return (["overview", "calls", "network", "dev", "five", "map", "bundles", "holders", "wallets"] as Tab[]).includes(q as Tab) ? (q as Tab) : "overview";
  };
  const [tab, setTab] = useState<Tab>(askedTab);
  const market = useMarket(r.mint);
  const calls = useCalls(r.mint);
  const callLine = callsLine(r, calls);
  const [sel, setSelState] = useState<string | null>(null);
  // Where the wallet was picked: on the map its dossier opens beside the map, in the list it opens under its row.
  const [from, setFrom] = useState<"map" | "list">("map");
  useEffect(() => {
    setSelState(null);
    setTab(askedTab());
  }, [r.mint]);
  const selected = early.find((e) => e.wallet === sel) ?? null;
  const open = (x: Tab) => {
    setTab(x);
    if (window.innerWidth < 1024) document.getElementById("xr-main")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const setSel = (w: string | null) => {
    setFrom("list");
    setSelState(w);
  };
  const choose = (w: string | null) => {
    setFrom("map");
    setSelState(w);
  };
  const pool = f?.graduated ? (f.poolSol !== undefined && f.poolSol !== null ? t("graduated · pool {s} {u}", { s: f.poolSol < 1 ? f.poolSol.toFixed(2) : Math.round(f.poolSol), u: unitOf(r.mint) }) : t("graduated")) : null;
  const devBad = (rec?.dumped ?? 0) >= 2 || (f?.creatorSoldPct ?? 0) >= 50 || (!!fund?.funder && !fund.funderIsHot && fund.siblingDumped48h >= 3);
  const fiveBad = took >= 0.25 || (f?.creatorCrew ?? 0) >= 2 || (f?.ringWallets ?? 0) >= 3 || (f?.bundleSharePct ?? 0) >= 15;
  const bundleBad = (((f?.bundlers ?? 0) >= 10 && (f?.bundlersPeakPct ?? 0) >= 30) || (f?.churnPct ?? 0) >= 30) && !f?.mayhem;
  const holdBad = (c.holders?.top10Pct ?? 0) >= 50 || (c.holders?.topWalletPct ?? 0) >= 20;
  const old = !!r.outsideStream;
  const MENU: Array<{ id: Tab; k: string; sub: string; bad?: boolean }> = [
    { id: "overview", k: "Overview", sub: c.reasons.length ? t("{n} reasons", { n: c.reasons.length }) : old ? t("only holders read") : t("no red flags") },
    { id: "calls", k: "Who's calling it", sub: !calls ? t("reading…") : callLine ? callLine.text : t("no calls seen"), bad: callLine?.bad },
    { id: "network", k: "Network", sub: t("who is behind it, on one map") },
    { id: "dev", k: "The dev", sub: old ? (r.devHistory ? t("{d} of {n} dumped", { d: r.devHistory.dumped, n: r.devHistory.launches }) : t("before our stream")) : rec ? t("{d} of {n} dumped", { d: rec.dumped, n: rec.launches48h }) : t("first launch"), bad: devBad },
    { id: "five", k: "First 5 seconds", sub: old ? t("before our stream") : early.length ? t("{n} wallets · took {p}", { n: early.length, p: pctFine(took) }) : t("nobody"), bad: fiveBad },
    ...(early.length ? [{ id: "map" as Tab, k: "Money map", sub: t("who paid, who sold") }] : []),
    { id: "bundles", k: "Bundles & volume", sub: old ? t("before our stream") : f?.bundlers ? t("{n} bundle wallets", { n: f.bundlers }) : t("{n} buyers", { n: f?.buyers ?? 0 }), bad: bundleBad },
    { id: "holders", k: "Holders", sub: !c.holders ? "-" : c.holders.top10Pct === 0 ? t("nobody holds it") : t("top 10 hold {p}%", { p: c.holders.top10Pct }), bad: holdBad },
    ...(early.length ? [{ id: "wallets" as Tab, k: "All wallets", sub: t("{n} in the first 5 s", { n: early.length }) }] : []),
  ];
  const Title = ({ k, note }: { k: string; note?: string }) => (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
      <h3 className="font-display text-2xl text-fg">{t(k)}</h3>
      {note && <span className="tabular-nums text-[12px] text-fg-4">{t(note)}</span>}
    </div>
  );
  const tiles = f && !old ? [
    { k: (f.poolBuys ?? 0) > 0 ? t("buyers on the curve") : t("buyers"), v: String(f.buyers), d: t("{b} buys · {s} sells", { b: f.buys.toLocaleString("en-US"), s: f.sells.toLocaleString("en-US") }), tone: "" },
    { k: t("dev sold"), v: f.creatorSoldPct === null || f.creatorSoldPct === undefined ? "-" : `${f.creatorSoldPct}%`, d: t("of their own bag"), tone: (f.creatorSoldPct ?? 0) >= 50 ? "bad" : (f.creatorSoldPct ?? 0) === 0 && f.buyers >= 10 ? "ok" : "" },
    { k: t("bundlers hold"), v: `${f.bundlersHeldPct ?? 0}%`, d: t("peak {p}% · {n} wallets", { p: f.bundlersPeakPct ?? 0, n: f.bundlers ?? 0 }), tone: bundleBad && (f.bundlers ?? 0) >= 10 ? "bad" : "" },
    { k: t("churn"), v: `${f.churnPct ?? 0}%`, d: t("sold back what they bought"), tone: (f.churnPct ?? 0) >= 30 ? "bad" : "" },
  ] : [];
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-3 pb-10 sm:px-8">
      <div className="xr-term relative mx-auto max-w-7xl overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0c100e] shadow-[0_30px_80px_rgba(0,0,0,0.6)]" style={{ boxShadow: `0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 ${tone.color}40` }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-[12%] top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${tone.color}, transparent)` }} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-36" style={{ background: `linear-gradient(180deg, ${tone.color}12, transparent)` }} />

        {/* the tab of the terminal: what it is, the verdict, the stream, where to trade it */}
        <div className="relative flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-white/[0.07] px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
            <b className="text-[17px] font-semibold tracking-[-0.01em] text-fg">${r.symbol.replace(/^\$/, "")}</b>
            <span className="tabular-nums truncate text-[12.5px] text-fg-3">
              {r.name}{r.name ? " · " : ""}{ageOf(r)} · {venueLabel(f)}{pool ? ` → ${pool}` : ""}{f?.mayhem ? ` · ${t("Mayhem Mode")}` : ""}
            </span>
          </div>
          <CopyCa mint={r.mint} />
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] font-semibold tracking-[0.02em]" style={{ color: tone.color, borderColor: `${tone.color}4d`, background: `${tone.color}1f` }}>
            <i className="h-[7px] w-[7px] rounded-full" style={{ background: tone.color, boxShadow: `0 0 10px ${tone.color}` }} />
            {t(tone.label)}
          </span>
          {c.odds && <OddsPill o={c.odds} verdict={c.verdict} />}
          <span className="tabular-nums ml-auto hidden items-center gap-2 text-[12px] text-fg-3 md:inline-flex">
            <i className={`h-[7px] w-[7px] rounded-full ${c.stream?.live ? "bg-[#a6e3b4] shadow-[0_0_10px_#a6e3b4]" : "bg-white/30"}`} />
            {c.stream?.live ? t("stream live · read {s} s ago", { s: c.stream.lastEventSecAgo }) : t("stream paused")}
          </span>
          <div className="flex w-full justify-between gap-1.5 rounded-xl border border-white/[0.07] bg-black/25 p-1 md:w-auto md:justify-start">
            {TERMINALS(r.mint).map((x) => (
              <a key={x.k} href={x.href} target="_blank" rel="noopener noreferrer" title={x.k} aria-label={x.k} className="block rounded-lg p-0.5 transition hover:-translate-y-0.5 hover:bg-white/[0.06]">
                <img src={x.icon} alt="" width={30} height={30} className="h-[30px] w-[30px] rounded-lg opacity-90" loading="lazy" />
              </a>
            ))}
          </div>
        </div>

        <Summary r={r} market={market} calls={calls} open={open} />

        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_300px] [&>*]:min-w-0">
          {/* read: the tabs */}
          <aside className="order-2 flex gap-1 overflow-x-auto border-b border-white/[0.07] px-2.5 py-2 lg:order-none lg:flex-col lg:gap-0.5 lg:border-b-0 lg:border-r lg:px-2.5 lg:py-3.5">
            <p className="hidden px-2.5 pb-2 pt-1.5 text-[11px] uppercase tracking-[0.14em] text-fg-4 lg:block">{t("read")}</p>
            {MENU.map((m) => (
              <button key={m.id} type="button" onClick={() => open(m.id)} className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition lg:w-full lg:py-2 ${tab === m.id ? "bg-white/[0.07] text-white" : "hover:bg-white/[0.04]"}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.bad ? "bg-[#ff8a7e] shadow-[0_0_8px_#ff8a7e]" : "bg-white/25"}`} />
                <span className="min-w-0">
                  <span className={`block whitespace-nowrap text-[13px] ${tab === m.id ? "text-white" : "text-fg-3"}`}>{t(m.k)}</span>
                  <span className={`tabular-nums hidden truncate text-[11.5px] lg:block ${m.bad ? "text-[#ff8a7e]/85" : "text-fg-4"}`}>{m.sub}</span>
                </span>
              </button>
            ))}
            <div className="mt-auto hidden space-y-1.5 border-t border-white/[0.07] px-2.5 pt-3 text-[12px] lg:block">
              <p className="tabular-nums flex justify-between text-fg-3">
                {t("dev")} <Addr a={r.creator} />
              </p>
              <p className="tabular-nums flex justify-between text-fg-3">
                {t("token")}
                <a href={!f?.venue || f.venue === "pump.fun" ? `https://pump.fun/coin/${r.mint}` : f.venue === "fourmeme" ? `https://four.meme/token/${r.mint}` : f.venue === "flap" ? `https://flap.sh/bnb/${r.mint}` : f.venue === "clanker" ? `https://www.clanker.world/clanker/${r.mint}` : chart(r.mint)} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                  {short(r.mint)} ↗
                </a>
              </p>
              <p className="tabular-nums flex justify-between text-fg-3">
                {t("raw")}
                <a href={`${NORTH}/v1/xray/${r.mint}`} className="font-mono text-[11.5px] underline decoration-white/20 underline-offset-4 hover:text-white">/v1/xray/{short(r.mint)}</a>
              </p>
            </div>
          </aside>

        <div id="xr-main" className="order-3 min-w-0 scroll-mt-24 space-y-4 px-3.5 py-4 sm:px-4 lg:order-none">
          {tiles.length > 0 && (
            <div className="mb-3.5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.07] md:grid-cols-4">
              {tiles.map((x) => (
                <div key={x.k} className="bg-[#0f1412] px-4 py-3.5">
                  <p className="text-[11.5px] text-fg-3">{x.k}</p>
                  <p className={`tabular-nums mt-0.5 text-[22px] font-semibold tracking-[-0.02em] ${x.tone === "bad" ? "text-[#ff8a7e]" : x.tone === "ok" ? "text-[#a6e3b4]" : "text-fg"}`}>{x.v}</p>
                  <p className="tabular-nums mt-0.5 text-[11.5px] text-fg-4">{x.d}</p>
                </div>
              ))}
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="space-y-4">
              {tab === "overview" && (
                <>
                  {c.odds && <OddsCard o={c.odds} verdict={c.verdict} />}
                  <FactorsCard r={r} />
                </>
              )}

              {tab === "dev" && (
                <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
                  <div id="xr-creator" className="[&>*]:h-full">
                    <Panel title="The creator" note={r.outsideStream ? "before our stream" : "last 48 hours"}>
              {r.outsideStream ? (
                <>
                  <p className="text-[13px] font-normal leading-relaxed text-fg-3">{t("This coin launched before our stream, so we did not see the dev launch it or sell. What we have is the dev's record in the launches we kept.")}</p>
                  {r.devHistory ? (
                    <>
                      <Stat k="launches we kept" v={String(r.devHistory.launches)} bad={r.devHistory.launches >= 3} />
                      <Stat k="dumped" v={String(r.devHistory.dumped)} bad={r.devHistory.dumped >= 2} />
                    </>
                  ) : (
                    <p className="mt-3 text-[13px] font-normal text-fg-4">{t("None of this dev's launches are in our record.")}</p>
                  )}
                </>
              ) : (
                <>
              <Stat k="launches" v={String(r.creatorRecord?.launches48h ?? 1)} bad={(r.creatorRecord?.launches48h ?? 1) >= 3} />
              <Stat k="dumped" v={String(r.creatorRecord?.dumped ?? 0)} bad={(r.creatorRecord?.dumped ?? 0) >= 2} />
              <Stat k="sold of their own bag" v={f?.creatorSoldPct === null || f?.creatorSoldPct === undefined ? t("never bought") : `${f.creatorSoldPct}%`} bad={(f?.creatorSoldPct ?? 0) >= 50} />
                </>
              )}
              {!!f?.bundleWallets && <Stat k="launch block" v={t("{n} wallets · {p}%", { n: f.bundleWallets, p: f.bundleSharePct ?? 0 })} bad={(f.bundleSharePct ?? 0) >= 15} />}
              {r.socials?.map((s) => (
                <div key={s.social.url} className="flex items-baseline justify-between gap-3 border-t border-white/[0.08] py-2">
                  <a href={s.social.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[12.5px] font-normal text-fg-3 hover:text-white">
                    {s.social.label} ↗
                  </a>
                  <span className={`tabular-nums shrink-0 text-[12px] ${s.fastDumps >= 2 ? "text-[#ff8a7e]" : "text-fg-4"}`}>{t("{n} other launches · {d} fast dumps", { n: s.launches, d: s.fastDumps })}</span>
                </div>
              ))}
              {!!r.mentions?.length && (
                <div className="border-t border-white/[0.08] pt-2">
                  <p className="text-[12px] text-fg-4">{t("seen on X")}</p>
                  {r.mentions.slice(0, 6).map((m) => (
                    <div key={m.url} className="flex items-baseline justify-between gap-3 py-1">
                      <a href={m.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[12.5px] font-normal text-fg-3 hover:text-white">
                        @{m.handle} ↗
                      </a>
                      <span className="tabular-nums shrink-0 text-[12px] text-fg-4">{m.postAt >= r.createdAt ? t("{m} min after launch", { m: Math.round((m.postAt - r.createdAt) / 60_000) }) : t("before launch")}</span>
                    </div>
                  ))}
                </div>
              )}
              <DevHabits h={r.creatorRecord} />
              {(r.creatorRecord?.recent?.filter((x) => x.mint !== r.mint).length ?? 0) > 0 && (
                <div className="mt-3 border-t border-white/[0.08] pt-3">
                  <p className="tabular-nums text-[11.5px] [&::first-letter]:uppercase text-fg-4">{t("their other launches · tap to x-ray")}</p>
                  <div className="mt-1.5">
                    {r.creatorRecord!.recent!.filter((x) => x.mint !== r.mint).slice(0, 6).map((x) => (
                      <button key={x.mint} type="button" onClick={() => onPick(x.mint)} className="flex w-full items-baseline justify-between gap-3 rounded-lg px-1 py-1.5 text-left text-[12.5px] transition hover:bg-white/[0.04]">
                        <span className="truncate text-fg-2">${x.symbol.replace(/^\$/, "")}</span>
                        <Outcome x={x} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
                  </div>
                  <div id="xr-funder" className="[&>*]:h-full">
                    <Panel title="Who paid for the creator" note={bsc ? where : "traced on Solana"}>
              {!fund && <p className="text-[13px] font-normal text-fg-3">{bsc ? t("Not traced on {chain}: the zoo reads {venue}'s launches and trades there, not wallet transfers yet.", { chain: where, venue }) : t("Not traced yet. It is queued: open this again in a minute.")}</p>}
              {fund && !fund.funder && <p className="text-[13px] font-normal text-fg-3">{t("No funding transfer in the creator's recent history.")}</p>}
              {fund?.funder && (
                <>
                  <div className="flex items-baseline justify-between gap-3 py-2">
                    <span className="text-[12.5px] font-normal text-fg-4">{t("funded by")}</span>
                    <Addr a={fund.funder} className="text-[13px] text-fg-2" />
                  </div>
                  {fund.funderIsHot ? (
                    <p className="mt-1 text-[12.5px] font-normal text-fg-3">
                      {fund.funderService
                        ? t("{x}'s launcher: it pays for the creator wallet of every token launched through {x}, so the other creators it funded are other {x} launches, not a ring.", { x: fund.funderService })
                        : fund.funderLabel
                          ? t("A withdrawal from {x}: the dev's SOL came out of an exchange account. It names the exchange, not the person, and ties no one together.", { x: fund.funderLabel })
                          : t("An exchange or a router: it funds everyone, so it ties no one together.")}
                    </p>
                  ) : (
                    <>
                      <Stat k="other creators it funded" v={String(fund.siblings.length)} bad={fund.siblings.length >= 2} />
                      <Stat k="their launches · dumps (48h)" v={`${fund.siblingLaunches48h} · ${fund.siblingDumped48h}`} bad={fund.siblingDumped48h >= 3} />
                      {fund.siblings.length > 0 && (
                        <div className="mt-2 border-t border-white/[0.08] pt-2">
                          {fund.siblings.slice(0, 6).map((s) => (
                            <div key={s.wallet} className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
                              <Addr a={s.wallet} className="text-fg-3" />
                              <span className={`tabular-nums ${s.dumped >= 1 ? "text-[#ff8a7e]" : "text-fg-3"}`}>{t("{l} launched · {d} dumped", { l: s.launches48h, d: s.dumped })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </Panel>
                  </div>
                </div>
              )}

              {tab === "five" && (
                early.length > 0 ? (
          <div id="xr-five" className="bg-night-surface border border-white/[0.08] grid gap-6 rounded-2xl p-5 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="font-display text-xl text-fg">{t("The first 5 seconds")}</h3>
                <span className="tabular-nums text-[12px] text-fg-4">{t("before anyone could see it")}</span>
              </div>
              <XRayRadar early={early} selected={sel} onSelect={choose} />
            </div>
            <div className="border-white/[0.08] lg:border-l lg:pl-6">
              <AnimatePresence mode="wait">
                {selected && from === "map" ? (
                  <Dossier key={selected.wallet} e={selected} creator={r.creator} onPick={onPick} onClose={() => setSel(null)} />
                ) : (
                  <motion.div key="sum" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <h3 className="font-display text-xl text-fg">{t("Insiders")}</h3>
                    <div className="mt-3">
                      <Stat k="wallets in the first 5 seconds" v={String(early.length)} />
                      <Stat k="supply they took" v={pctFine(took)} bad={took >= 0.25} />
                      <Stat k="supply they still hold" v={pctFine(holds)} bad={holds >= 0.25} />
                      <Stat k="the creator's own crew" v={String(f?.creatorCrew ?? 0)} bad={(f?.creatorCrew ?? 0) >= 2} />
                      <Stat k="in a sniper ring" v={String(f?.ringWallets ?? 0)} bad={(f?.ringWallets ?? 0) >= 3} />
                      <Stat k="serial snipers" v={String(f?.serialSnipers ?? 0)} />
                    </div>
                    <p className="tabular-nums mt-5 text-[12.5px] text-[#ffc27a]/75">{t("Tap any wallet on the map or in the list to see who it is.")}</p>
                                      </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          <div id="xr-five" className="bg-night-surface border border-white/[0.08] flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-5">
            <div>
              <h3 className="font-display text-xl text-fg">{t("The first 5 seconds")}</h3>
              <p className="mt-1 text-[13px] font-normal text-fg-4">{t("Nobody bought before the token was visible: no snipers, no crew in the first seconds.")}</p>
            </div>
            <p className="tabular-nums text-[12px] text-fg-4">{t("{b} buyers · {x} buys · {y} sells", { b: f?.buyers ?? 0, x: f?.buys ?? 0, y: f?.sells ?? 0 })}</p>
            {!!f?.bundlers && (
              <p className={`tabular-nums w-full text-[12px] ${(f.bundlersPeakPct ?? 0) >= 30 && !f.mayhem ? "text-[#ff8a7e]" : "text-fg-4"}`}>
                {t("later bought in bundles: {n} wallets, held up to {p}% together, {h}% now", { n: f.bundlers, p: f.bundlersPeakPct ?? 0, h: f.bundlersHeldPct ?? 0 })}
              </p>
            )}
          </div>
        )
              )}

              {tab === "calls" && <CallsTab r={r} calls={calls} market={market} />}

              {tab === "map" && <MoneyMap r={r} />}

              {tab === "network" && (
                <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-4 sm:p-6">
                  <Title k="Network" note="the dev, his wallets, who paid, his launches" />
                  <NetworkMap r={r} onPick={onPick} onWallet={openWallet} />
                </div>
              )}

              {tab === "bundles" && (
                <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-6 sm:p-8">
                  <Title k="Bundles & volume" note="4+ wallets buying in one block, any time" />
                  <div>
                      <Stat k="buyers" v={String(f?.buyers ?? 0)} />
                      <Stat k="buys · sells" v={`${f?.buys ?? 0} · ${f?.sells ?? 0}`} />
                      <Stat k="churned volume (at least)" v={f?.churnPct === null || f?.churnPct === undefined ? "-" : `${f.churnPct}%`} bad={(f?.churnPct ?? 0) >= 30 && !f?.mayhem} />
                      <Stat k="bump bot trades" v={String(f?.bumps ?? 0)} bad={(f?.bumps ?? 0) >= 3 && !f?.mayhem} />
                      <Stat k="bought in bundles (4+ wallets in one block)" v={`${f?.bundlers ? t("{n} wallets", { n: f.bundlers }) : "0"}${f?.bundlesSince ? ` · ${t("counted since {d}", { d: new Date(f.bundlesSince).toISOString().slice(5, 16).replace("T", " ") + " UTC" })}` : ""}`} bad={(f?.bundlers ?? 0) >= 10 && (f?.bundlersPeakPct ?? 0) >= 30 && !f?.mayhem} />
                      {!!f?.bundlers && <Stat k="bundlers hold now · at most" v={`${f.bundlersHeldPct ?? 0}% · ${f.bundlersPeakPct ?? 0}%`} bad={(f.bundlersPeakPct ?? 0) >= 30 && !f.mayhem} />}
                      {!!f?.bundledSol && <Stat k={`${unitOf(r.mint)} through bundles`} v={f.bundledSol.toLocaleString("en-US", { maximumFractionDigits: 1 })} />}
                    </div>
                  {!!f?.bundleWallets && <Stat k="launch block" v={t("{n} wallets · {p}%", { n: f.bundleWallets, p: f.bundleSharePct ?? 0 })} bad={(f.bundleSharePct ?? 0) >= 15} />}
                  <p className="mt-4 text-[12.5px] font-normal leading-relaxed text-fg-3">{t("A crowd of buyers that is really a few hands buying in packs looks like demand and is not. Churn is wallets selling back what they just bought: volume, not holders.")}</p>
                </div>
              )}

              {tab === "holders" && (
                <div id="xr-holders">
                  <Panel title="Holders now" note={bsc ? where : "read from Solana"}>
              {!c.holders && <p className="text-[13px] font-normal text-fg-3">{bsc ? t("Holders are not read on {chain}: what the first wallets and the bundlers still hold comes from {venue}'s own trades above.", { chain: where, venue }) : t("Holders could not be read right now.")}</p>}
              {c.holders && c.holders.top10Pct === 0 && <p className="text-[13px] font-normal text-fg-3">{t("Nobody holds it outside the curve: everyone sold back.")}{c.holders.programPct ? ` ${t("{p}% sits in the curve or pool", { p: c.holders.programPct })}.` : ""}</p>}
              {c.holders && c.holders.top10Pct > 0 && !!c.holders.programPct && <Stat k="in the curve or pool" v={`${c.holders.programPct}%`} />}
              {c.holders && c.holders.top10Pct > 0 && (
                <>
                  <Stat k="largest wallet" v={`${c.holders.topWalletPct}%`} bad={c.holders.topWalletPct >= 20} />
                  <Stat k="10 largest wallets" v={`${c.holders.top10Pct}%`} bad={c.holders.top10Pct >= 50} />
                  <Stat k="the creator holds" v={c.holders.creatorHoldsPct === null ? "-" : `${c.holders.creatorHoldsPct}%`} />
                </>
              )}
            </Panel>
                  {c.rights && (
                    <div className="mt-4">
                      <Panel title="Token rights" note={c.rights.program === "token-2022" ? "Token-2022 · read from the mint" : "read from the mint"}>
                        <RightsStats r={c.rights} />
                      </Panel>
                    </div>
                  )}
                </div>
              )}

              {tab === "wallets" && (
                
          <div className="bg-night-surface border border-white/[0.08] overflow-hidden rounded-2xl">
            <div className="tabular-nums grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] gap-3 border-b border-white/[0.08] px-5 py-3 text-[12px] text-fg-4 sm:grid-cols-[minmax(0,1fr)_7.5rem_4rem_4rem_4rem_4.5rem_4.5rem] sm:px-7">
              <span>{t("wallet")}</span>
              <span className="hidden sm:block">{t("who")}</span>
              <span className="text-right">{t("took")}</span>
              <span className="text-right">{t("holds")}</span>
              <span className="hidden text-right sm:block">{t("in at")}</span>
              <span className="text-right">{t("sold out")}</span>
              <span className="hidden text-right sm:block">{t("snipes 48h")}</span>
            </div>
            {early.map((e) => {
              const k = KIND[kindOf(e)];
              const on = sel === e.wallet;
              return (
                <div key={e.wallet}>
                <button
                  id={`xr-row-${e.wallet}`}
                  type="button"
                  onClick={() => setSel(on ? null : e.wallet)}
                  className={`tabular-nums grid w-full outline-none focus-visible:bg-white/[0.05] grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] items-center gap-3 border-t border-white/[0.08] px-5 py-2.5 text-left text-[12px] transition sm:grid-cols-[minmax(0,1fr)_7.5rem_4rem_4rem_4rem_4.5rem_4.5rem] sm:px-7 ${on ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}
                >
                  <span className="flex items-center gap-2 truncate text-fg-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: k.color }} />
                    {short(e.wallet)}
                    <Tags tags={e.tags?.filter((x) => !KIND_TAGS.has(x))} className="ml-1 hidden sm:inline-flex" />
                    {e.cabal && (
                      <a href={`/cabals?id=${e.cabal}`} onClick={(ev) => ev.stopPropagation()} className="hidden rounded-full px-1.5 py-px text-[10.5px] text-[#ffc27a] ring-1 ring-[#ffc27a]/30 sm:inline" title={t("part of a cabal the memory ties together")}>
                        #{e.cabal}
                      </a>
                    )}
                  </span>
                  <span className="hidden truncate sm:block" style={{ color: k.color }}>
                    {t(k.label)}
                  </span>
                  <span className="text-right text-fg-3">{pctFine(e.bought)}</span>
                  <span className={`text-right ${e.held >= 0.05 ? "text-[#ff8a7e]" : "text-fg-3"}`}>{pctFine(e.held)}</span>
                  <span className="hidden text-right text-fg-4 sm:block">{e.afterSec}s</span>
                  <span className="text-right text-fg-4">{secs(e.exitSec)}</span>
                  <span className={`hidden text-right sm:block ${e.snipes48h >= 10 ? "text-[#ffc27a]" : "text-fg-4"}`}>{e.snipes48h}</span>
                </button>
                {on && from === "list" && (
                  <div className="border-t border-white/[0.08] bg-black/25 px-5 py-5 sm:px-7">
                    <Dossier e={e} creator={r.creator} onPick={onPick} onClose={() => setSel(null)} />
                  </div>
                )}
                </div>
              );
            })}
          </div>
        
              )}
            </motion.div>
          </AnimatePresence>
          <ShareBar r={r} />
          </div>

          {/* trade: the swap, who holds it */}
          <aside className="order-1 border-b border-white/[0.07] px-4 py-4 lg:order-none lg:border-b-0 lg:border-l lg:border-t-0 [&>*:first-child]:mt-0 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">
            {bsc ? <TradeOnEvm mint={r.mint} flap={f?.venue === "flap"} /> : <Swap mint={r.mint} symbol={r.symbol} />}
            <div className="hidden lg:block">
              <HoldStrip c={c} />
            </div>
          </aside>
        </div>

        {/* the status line */}
        <div className="tabular-nums relative flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/[0.07] px-4 py-2.5 text-[11.5px] leading-relaxed text-fg-4 sm:px-5">
          <span className="min-w-0 flex-1 basis-[60%]">{bsc ? (r.outsideStream ? t("How we know: this coin launched on {venue} before our two-day window, so what happened at launch is not on record; the dev's record is what the stream kept of their earlier launches.", { venue }) : t("How we know: every {venue} launch, buy and sell read from {chain} as it happens, kept 48 hours on the live tape and 90 days in the long memory. The dev's record and the first-seconds wallets come from that stream; who holds it now is read at x-ray time; who paid for the dev is traced when a key for {chain} is set.", { venue, chain: where })) : r.outsideStream ? t("How we know: who holds it now is read from Solana at check time; the dev's record is what the stream kept of their earlier launches. What happened when this coin launched was before our two-day window.") : r.fromHistory ? t("How we know: this coin was read from Solana as it launched and kept in the long memory, where a launch stays 90 days; this is its record as it stood when last written. Who holds it now is read at check time; who paid for the dev is traced from the dev wallet's own transfers.") : t("How we know: every pump.fun, LaunchLab and Meteora transaction read from Solana as it happens, kept 48 hours on the live tape and 90 days in the long memory. The dev's record and the first-seconds wallets come from that stream; who paid for the dev is traced from the dev wallet's own transfers.")}</span>
          <span className="font-mono text-fg-3">{NORTH.replace(/^https?:\/\//, "")}/v1/xray/{short(r.mint)}</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-[#a6e3b4]" />{t("3 nodes · one operator")} · {t("Not financial advice.")}</span>
        </div>
      </div>
    </motion.section>
  );
}
