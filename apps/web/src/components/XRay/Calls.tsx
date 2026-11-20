import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { pctFine } from "../../format";
import { KIND, kindOf } from "../XRayRadar";
import type { XRayReport } from "./types";
import { NORTH } from "./shared";


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
  /** What became of this caller's earlier calls a day later, once five of them have run their day. */
  record?: { settled: number; dead: number; alive: number; medianX: number | null } | null;
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
  thesesStatus: "ok" | "off" | "budget" | "error" | "idle";
}

/** Callouts and theses for a coin, from the node. Null until it answers; an old node without the route answers nothing. */
export function useCalls(mint: string | null, full = true): Calls | null {
  const [c, setC] = useState<Calls | null>(null);
  useEffect(() => setC(null), [mint]);
  useEffect(() => {
    if (!mint) return;
    let gone = false;
    // The summary asks for what the node already holds; FOMO theses are read (and paid for) when the calls tab opens.
    fetch(`${NORTH}/v1/calls/${mint}${full ? "" : "?theses=cached"}`, { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((x: Calls | null) => !gone && setC(x ?? { callouts: [], theses: [], thesesStatus: "error" }))
      .catch(() => !gone && setC({ callouts: [], theses: [], thesesStatus: "error" }));
    return () => {
      gone = true;
    };
  }, [mint, full]);
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
