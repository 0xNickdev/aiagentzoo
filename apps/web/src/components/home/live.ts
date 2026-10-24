import { useEffect, useRef, useState } from "react";
import { NODE_URLS } from "../../sim/live";

/** The home page reads everything from the north node; a field it cannot read shows "-", never a made-up number. */
export const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
export const SITE_XRAY = (mint: string) => `/xray?mint=${mint}`;
export const SITE_WALLET = (w: string) => `/xray?wallet=${w}`;

export const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : Math.round(n).toLocaleString("en-US");
export const full = (n: number) => Math.round(n).toLocaleString("en-US");
export const short = (a?: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");

const clean = (s?: string) => String(s ?? "").replace(/^\$+/, "").replace(/[\sㅤᅟᅠ​-‍﻿]+/g, " ").trim();
/** A ticker as people write it; a coin with an empty or invisible ticker shows its address instead. */
export const ticker = (s?: string, mint?: string) => (clean(s) ? `$${clean(s)}` : mint ? short(mint) : "$?");
export const initials = (s?: string, mint?: string) => (clean(s) || mint || "?").slice(0, 2).toUpperCase();
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

/**
 * A number that counts up on a spring the first time it shows (Magic UI's NumberTicker: stiffness 100, damping 60),
 * then keeps moving at `perMinute` between polls and settles on each real count.
 */
export function useTicker(base: number | null, perMinute = 0): number | null {
  const [shown, setShown] = useState<number | null>(null);
  const s = useRef({ x: 0, v: 0, base: 0, perMinute: 0, at: 0, on: false });
  useEffect(() => {
    if (base == null) return;
    Object.assign(s.current, { base, perMinute, at: performance.now(), on: true });
  }, [base, perMinute]);
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const sp = s.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (sp.on) {
        const target = sp.base + ((now - sp.at) / 60_000) * sp.perMinute;
        if (reduce) sp.x = target;
        else
          for (let i = 0; i < 4; i++) {
            sp.v += (100 * (target - sp.x) - 60 * sp.v) * (dt / 4);
            sp.x += sp.v * (dt / 4);
          }
        if (Math.abs(target - sp.x) < 0.5 && Math.abs(sp.v) < 1) sp.x = target;
        setShown(Math.max(0, sp.x));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return shown;
}

export const ago = (t: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
};

/** Re-renders every second, for "12s ago" labels. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export interface Moment {
  seq: number;
  at: number;
  kind: string;
  mint: string;
  symbol: string;
  text: string;
  creator?: string;
  image?: string;
  venue?: string;
}

export interface FeedRow {
  mint: string;
  symbol: string;
  creator?: string;
  at: number;
  image?: string;
  venue?: string;
  dump?: { pct: number; after: string };
  serial?: number;
  drained?: number;
}

/** One row per coin: a dev's dump, serial launch and drained pool fold into the same line, newest first. */
export function feedRows(moments: Moment[]): FeedRow[] {
  const byMint = new Map<string, FeedRow>();
  for (const m of moments) {
    let e = byMint.get(m.mint);
    if (!e) byMint.set(m.mint, (e = { mint: m.mint, symbol: m.symbol, creator: m.creator, at: m.at, image: m.image, venue: m.venue }));
    e.at = Math.max(e.at, m.at);
    if (m.image && !e.image) e.image = m.image;
    let x: RegExpMatchArray | null;
    if (m.kind === "dump" && (x = m.text.match(/sold (\d+)% after (.+)$/))) e.dump ??= { pct: Number(x[1]), after: x[2]!.replace(" min", "m").replace(" h", "h") };
    if (m.kind === "serial" && (x = m.text.match(/(\d+)(st|nd|rd|th) launch/))) e.serial = Math.max(e.serial ?? 0, Number(x[1]));
    if (m.kind === "drained" && (x = m.text.match(/drained to ([\d.]+) SOL/))) e.drained = Number(x[1]);
  }
  return [...byMint.values()].filter((e) => e.dump || e.drained != null || (e.serial ?? 0) >= 10).sort((a, b) => b.at - a.at);
}
