import { addressIn } from "../../chain";
import { lang, t } from "../../i18n";
import type { Ask, Verdict } from "./types";

export const TONE: Record<Verdict, { label: string; color: string; text: string }> = {
  suspicious: { label: "Suspicious", color: "#ff8a7e", text: "text-[#ff8a7e]" },
  watch: { label: "Watch", color: "#e6e9e7", text: "text-fg-2" },
  promising: { label: "Promising", color: "#a6e3b4", text: "text-[#a6e3b4]" },
};

export const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;
export const pctOf = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${Math.round(n * 100)}%`);

/** Any token address inside whatever was pasted: a bare mint, a pump.fun, four.meme or DexScreener link. */
export const mintIn = addressIn;

/** The evidence the beaver saw, as short lines. */
export function evidence(a: Ask): Array<[string, string, boolean]> {
  const out: Array<[string, string, boolean]> = [];
  const c = a.facts.chain;
  const m = a.facts.market;
  if (c?.creatorSold !== null && c?.creatorSold !== undefined) out.push(["creator sold", pctOf(c.creatorSold), c.creatorSold >= 0.5]);
  const r = a.facts.creator;
  if (r) out.push(["creator dumped (48h)", t("{a} of {b}", { a: r.dumped, b: r.launches48h }), r.launches48h >= 3 && r.dumped >= Math.ceil(r.launches48h / 2)]);
  if (c) out.push(["creator's launches today", String(c.creatorLaunches24h), c.creatorLaunches24h >= 5]);
  const h = a.facts.holders;
  if (h) {
    out.push(["top 10 wallets hold", pctOf(h.top10Share), h.top10Share >= 0.5]);
    if (h.creatorShare !== null) out.push(["dev still holds", pctOf(h.creatorShare), h.creatorShare >= 0.1]);
  }
  const b = a.facts.bundle;
  if (b) out.push(["bundle at launch", `${t("{n} wallets", { n: b.wallets })} · ${pctOf(b.share)}${b.linked >= 2 ? ` · ${t("{n} same funder", { n: b.linked })}` : ""}`, b.wallets >= 3 || b.linked >= 2]);
  else if (c?.top5Share !== null && c?.top5Share !== undefined) out.push(["top 5 buyers' share", pctOf(c.top5Share), c.top5Share >= 0.6]);
  if (c && !r) out.push(["buyers · repeat", `${c.buyers}${c.buyersMore ? "+" : ""} · ${c.repeatBuyers}`, false]);
  if (m) {
    out.push(["liquidity", usd(m.liquidityUsd), (m.liquidityUsd ?? 0) < 1000]);
    out.push(["volume 24h", usd(m.volume24hUsd), false]);
    out.push(["buys · sells 24h", `${m.buys24h} · ${m.sells24h}`, m.sells24h > m.buys24h * 3]);
    out.push(["change 24h", m.priceChange24h === null ? "-" : `${m.priceChange24h > 0 ? "+" : ""}${Math.round(m.priceChange24h)}%`, (m.priceChange24h ?? 0) <= -80]);
  }
  out.push(["socials", t(a.facts.hasSocials === null ? "unknown" : a.facts.hasSocials ? "yes" : "none"), a.facts.hasSocials === false]);
  // Nine cells fill the grid when the chain is there; without it, graduation fills the gap.
  if (!c) out.push(["graduated", t(a.facts.graduated ? "yes" : "no"), false]);
  return out;
}

/** The beaver's reason in the reader's language, when a Chinese one was written. */
export const whyOf = (a: Ask) => (lang() === "zh" && a.whyZh ? a.whyZh : a.why);
export const gradeDue = (a: Ask) => new Date(a.at + 24 * 3_600_000);
export const when = (d: Date) => d.toLocaleString(lang() === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export function graded(a: Ask): string {
  if (!a.graded) return a.already ? t("already dead when asked · not scored") : t("re-checked against reality {when}", { when: when(gradeDue(a)) });
  const o = t(a.graded.outcome === "unknown" ? "outcome unclear" : a.graded.outcome === "dead" ? "it died" : "it lived");
  return a.graded.hit === null ? `${o} · ${t("not scored")}` : `${o} · ${t(a.graded.hit ? "the beaver was right" : "the beaver was wrong")}`;
}
