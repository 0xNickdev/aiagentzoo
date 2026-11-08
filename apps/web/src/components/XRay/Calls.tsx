import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { pctFine, short } from "../../format";
import { KIND, kindOf } from "../XRayRadar";
import type { XRayReport } from "./types";
import { NORTH, openWallet } from "./shared";
import { usdShort, type Market } from "./Market";

export interface Callout {
  post: number;
  mint: string;
  text: string;
  caller: string;
  followers: number | null;
  twitter: string | null;
  wallet: string | null;
  calledMcUsd: number | null;
  nth: number | null;
  at: number;
  url: string;
  /** The caller's wallet in this coin, from the node's tape: first buy time, sold out since, or not seen buying. */
  walletBoughtAt?: number | null;
  walletSoldOut?: boolean | null;
  walletExitAt?: number | null;
  walletSeen?: boolean;
}
export interface Thesis {
  id: string;
  text: string;
  handle: string;
  name: string;
  avatar: string | null;
  tradeUsd: number | null;
  pnlUsd: number | null;
  isDev: boolean;
  likes: number;
  at: number;
  url: string;
  hype?: boolean;
}
export interface Calls {
  callouts: Callout[];
  theses: Thesis[];
  thesesStatus: "ok" | "off" | "budget" | "error";
}

/** Callouts and theses for a coin, from the node. Null until it answers; an old node without the route answers nothing. */
export function useCalls(mint: string): Calls | null {
  const [c, setC] = useState<Calls | null>(null);
  useEffect(() => {
    setC(null);
    let gone = false;
    fetch(`${NORTH}/v1/calls/${mint}`, { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((x: Calls | null) => !gone && setC(x ?? { callouts: [], theses: [], thesesStatus: "error" }))
      .catch(() => !gone && setC({ callouts: [], theses: [], thesesStatus: "error" }));
    return () => {
      gone = true;
    };
  }, [mint]);
  return c;
}

/** Who a caller's wallet is in this coin, read from the chain: the dev, a first-seconds wallet, a bundler, or none of them. */
export function insideOf(r: XRayReport, wallet: string | null): { label: string; bad: boolean } | null {
  if (!wallet) return null;
  if (wallet === r.creator) return { label: t("the dev's own wallet"), bad: true };
  const e = r.early.find((x) => x.wallet === wallet);
  if (e) {
    const k = KIND[kindOf(e)];
    return { label: e.held > 0.0005 ? t("{k} · took {p}, holds {h}", { k: t(k.label), p: pctFine(e.bought), h: pctFine(e.held) }) : t("{k} · took {p}, sold out", { k: t(k.label), p: pctFine(e.bought) }), bad: kindOf(e) !== "early" || e.held < 0.0005 };
  }
  if (r.bundle?.wallets?.some((w) => w.wallet === wallet)) return { label: t("bought in a bundle"), bad: true };
  return null;
}

const span = (ms: number) => {
  const m = Math.round(Math.abs(ms) / 60_000);
  return m < 90 ? t("{m} min", { m }) : t("{h} h", { h: (m / 60).toFixed(1) });
};

/** What the caller's own wallet did around the call: bought before calling it is the thing to know. */
export function timingOf(c: Callout): { label: string; bad: boolean } | null {
  if (!c.wallet || !c.walletSeen) return null;
  if (c.walletBoughtAt == null) return { label: c.walletSoldOut ? t("their wallet bought it and sold out") : t("their wallet holds it"), bad: !!c.walletSoldOut };
  const d = c.at - c.walletBoughtAt;
  // The channel gives the call time to the minute: within a minute either way is "as they called it".
  const outFirst = c.walletExitAt != null && c.at - c.walletExitAt > 90_000;
  const sold = outFirst ? t(", sold out {s} before calling it", { s: span(c.at - c.walletExitAt!) }) : c.walletSoldOut ? t(", sold out since") : "";
  if (Math.abs(d) <= 90_000) return { label: t("their wallet bought it as they called it{x}", { x: sold }), bad: !!c.walletSoldOut };
  return d > 0
    ? { label: t("their wallet bought {s} before calling it{x}", { s: span(d), x: sold }), bad: true }
    : { label: t("their wallet bought {s} after calling it{x}", { s: span(-d), x: sold }), bad: !!c.walletSoldOut };
}

/** The line for the overview: how many call it, and how many of them were already inside. */
export function callsLine(r: XRayReport, c: Calls | null): { text: string; bad: boolean } | null {
  if (!c) return null;
  const n = c.callouts.length + c.theses.length;
  if (!n) return null;
  const inside = c.callouts.filter((x) => insideOf(r, x.wallet)?.bad || timingOf(x)?.bad).length + c.theses.filter((x) => x.isDev).length;
  const parts = [c.callouts.length ? t("{n} pump.fun callouts", { n: c.callouts.length }) : "", c.theses.length ? t("{n} FOMO theses", { n: c.theses.length }) : ""].filter(Boolean).join(" · ");
  return { text: inside ? t("{p} · {n} by wallets already in it", { p: parts, n: inside }) : parts, bad: inside > 0 };
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return m < 60 ? t("{m} min ago", { m }) : m < 48 * 60 ? t("{h} h ago", { h: Math.round(m / 60) }) : t("{d} d ago", { d: Math.round(m / 1440) });
};

/** "Who's calling it": each call next to what the chain says about the caller. */
export function CallsTab({ r, calls, market }: { r: XRayReport; calls: Calls | null; market: Market | null }) {
  const [hypeOpen, setHypeOpen] = useState(false);
  const card = "bg-night-surface border border-white/[0.08] rounded-2xl p-5 sm:p-6";
  if (!calls)
    return (
      <div className={card}>
        <p className="text-[13px] text-fg-3">{t("Reading who is calling it…")}</p>
      </div>
    );
  const none = !calls.callouts.length && !calls.theses.length;
  // The dev's own thesis first, then what the biggest positions wrote; hype is counted, not quoted.
  const dev = calls.theses.filter((x) => x.isDev);
  const said = calls.theses.filter((x) => !x.isDev && !x.hype).sort((a, b) => (b.tradeUsd ?? 0) - (a.tradeUsd ?? 0));
  const hype = calls.theses.filter((x) => !x.isDev && x.hype);
  const theses = [...dev, ...said, ...(hypeOpen ? hype : [])];
  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl text-fg">{t("Who's calling it")}</h3>
          <span className="text-[13px] text-fg-4">{t("each caller set against the chain")}</span>
        </div>
        <p className="text-[13px] leading-relaxed text-fg-3">
          {none
            ? t("No pump.fun callouts or FOMO theses on this coin yet.")
            : t("A call is a person asking you to buy. Next to each one: whether their wallet was already in this coin, and where the market cap was when they called.")}
        </p>
      </div>

      {calls.callouts.length > 0 && (
        <div className={card}>
          <p className="text-[15px] font-semibold text-fg">{t("pump.fun callouts")}</p>
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {calls.callouts.map((c) => {
              const inside = insideOf(r, c.wallet);
              const when = timingOf(c);
              const x = c.calledMcUsd && market?.mcapUsd ? market.mcapUsd / c.calledMcUsd : null;
              return (
                <li key={c.post} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-[13.5px] text-fg">
                      {c.caller || t("a caller")}
                      <span className="tabular-nums ml-2 text-[13px] text-fg-4">
                        {c.followers !== null ? t("{n} followers", { n: c.followers.toLocaleString("en-US") }) : ""}
                        {c.twitter ? ` · ${c.twitter}` : ""}
                      </span>
                    </span>
                    <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="tabular-nums text-[13px] text-fg-4 hover:text-white">
                      {ago(c.at)} ↗
                    </a>
                  </div>
                  {c.text && <p className="mt-1.5 text-[13.5px] leading-snug text-fg-2">“{c.text}”</p>}
                  <div className="tabular-nums mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    {c.calledMcUsd !== null && (
                      <span className="text-fg-3">
                        {t("called at {m}", { m: usdShort(c.calledMcUsd) })}
                        {x !== null && <span className={x >= 1 ? "text-[#a6e3b4]" : "text-[#ff8a7e]"}>{` · ${t("now {x}×", { x: x >= 10 ? Math.round(x) : x.toFixed(2) })}`}</span>}
                      </span>
                    )}
                    {c.wallet && (
                      <button type="button" onClick={() => openWallet(c.wallet!)} className="text-fg-4 underline decoration-white/20 underline-offset-4 hover:text-white">
                        {short(c.wallet)}
                      </button>
                    )}
                    {when && <span className={when.bad ? "text-[#ff8a7e]" : "text-fg-3"}>{when.label}</span>}
                    <span className={inside?.bad ? "text-[#ff8a7e]" : "text-fg-4"}>{inside ? inside.label : t("not in the first seconds or the bundles")}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {calls.theses.length > 0 && (
        <div className={card}>
          <p className="text-[15px] font-semibold text-fg">{t("FOMO theses")}</p>
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {theses.map((x) => (
              <li key={x.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <a href={x.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[13.5px] text-fg hover:underline">
                    {x.name || x.handle}
                    {x.handle && <span className="ml-2 text-[13px] text-fg-4">@{x.handle}</span>}
                  </a>
                  <span className="tabular-nums text-[13px] text-fg-4">{x.at ? ago(x.at) : ""}{x.likes ? ` · ${t("{n} likes", { n: x.likes })}` : ""}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-snug text-fg-2">{x.text}</p>
                <div className="tabular-nums mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  {x.isDev && <span className="text-[#ff8a7e]">{t("the dev of this coin")}</span>}
                  {x.tradeUsd !== null && x.tradeUsd >= 1 && <span className="text-fg-3">{t("in for {u}", { u: usdShort(x.tradeUsd) })}</span>}
                  {x.pnlUsd !== null && Math.abs(x.pnlUsd) >= 1 && <span className={x.pnlUsd > 0 ? "text-[#a6e3b4]" : "text-[#ff8a7e]"}>{`${x.pnlUsd > 0 ? "+" : "−"}${usdShort(Math.abs(x.pnlUsd))} ${t("on it")}`}</span>}
                </div>
              </li>
            ))}
          </ul>
          {hype.length > 0 && (
            <button type="button" onClick={() => setHypeOpen(!hypeOpen)} className="tabular-nums mt-2 text-[13px] text-fg-3 hover:text-white">
              {hypeOpen ? t("hide the hype") : t("+ {n} hype posts (lfg, send it, cap targets)", { n: hype.length })}
            </button>
          )}
        </div>
      )}
      {calls.thesesStatus === "budget" && <p className="px-1 text-[13px] text-fg-4">{t("FOMO theses are resting for today: the daily read budget is used up.")}</p>}
      <p className="px-1 text-[13px] leading-relaxed text-fg-4">{t("Callouts are pump.fun's own, relayed by t.me/pumpfun_lp with the caller's wallet as pump.fun shows it. Theses are what traders wrote on fomo.family when they bought, via fomoapi.io. A call is someone's opinion; the chain shows only what their wallet did.")}</p>
    </div>
  );
}
