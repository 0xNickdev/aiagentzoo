import { useEffect, useState } from "react";
import { NODE_URLS } from "../../sim/live";
import { agoCompact, shortOr } from "../../format";

/** The home page reads everything from the north node; a field it cannot read is left out, never a made-up number. */
export const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
export const SITE_XRAY = (mint: string) => `/xray?mint=${mint}`;
export const SITE_WALLET = (w: string) => `/xray?wallet=${w}`;
export const full = (n: number) => Math.round(n).toLocaleString("en-US");

export const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : Math.round(n).toLocaleString("en-US");

const clean = (s?: string) => String(s ?? "").replace(/^\$+/, "").replace(/[\sㅤᅟᅠ​-‍﻿]+/g, " ").trim();
/** A ticker as people write it; a coin with an empty or invisible ticker shows its address instead. */
export const ticker = (s?: string, mint?: string) => (clean(s) ? `$${clean(s)}` : mint ? shortOr(mint) : "$?");
export const initials =(s?: string, mint?: string) => (clean(s) || mint || "?").slice(0, 2).toUpperCase();
export const hue = (m: string) => {
  let h = 0;
  for (const c of m) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
/** pump.fun serves every coin's picture by its address; other launchpads use what the node read from metadata. */
export const picOf = (mint: string, image?: string, venue?: string) =>
  venue === "pump.fun" || (!venue && mint.endsWith("pump")) ? `https://images.pump.fun/coin-image/${mint}?variant=86x86` : image;

export function useNorth<T>(path: string | null, everyMs = 60_000): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (!NORTH || !path) return;
    let live = true;
    const load = () =>
      fetch(`${NORTH}${path}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: T | null) => live && b && setV(b))
        .catch(() => {});
    load();
    const id = window.setInterval(load, everyMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [path, everyMs]);
  return v;
}

/** "12s", "5 min", "2 h": spaced units. */
export const ago = (t: number, now = Date.now()) => agoCompact(t, now, [" min", " h"]);

/** Re-renders now and then, for "12s ago" labels. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
