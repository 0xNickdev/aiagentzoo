import { t } from "./i18n";

/**
 * Small formatters shared across the site and the Telegram app. Several near-copies used to live in the components;
 * where their output differed, the difference is kept here as its own named variant or as a parameter.
 */

/** An address cut to its first and last four characters: `AbCd…WxYz`. */
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
/** Same as `short`, but a missing or empty address gives "". */
export const shortOr = (a?: string) => (a ? short(a) : "");
/** Cut to `n` characters a side, and only when the string is long enough to be worth cutting. */
export const shortFit = (a: string, n = 4) => (a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

/** A whole number with US thousands separators: 12,345. */
export const num = (n: number) => n.toLocaleString("en-US");
/** `num`, or "-" when there is no number. */
export const numOrDash = (n: number | null | undefined) => (n === null || n === undefined ? "-" : num(n));
/** 1.2M, 34k, 999. */
export const compactK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
/** A share as a percent, with one decimal under 10%: 34%, 4.2%, 0%. */
export const pctFine = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");

/** Untranslated age: "12s", "5m", "2h". `units` are the minute and hour suffixes. */
export const agoCompact = (at: number, now = Date.now(), units: readonly [string, string] = ["m", "h"]) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}${units[0]}` : `${Math.round(s / 3600)}${units[1]}`;
};

/** "now", then "{m} min ago" with no upper unit. */
export const minAgo = (at: number) => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return m < 1 ? t("now") : t("{m} min ago", { m });
};

/** "just now", "{n} min ago", "{n} h ago", and with `withDays` "{n} d ago" from a day on. */
export const agoText = (at: number, withDays = false) => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return m < 1
    ? t("just now")
    : m < 60
      ? t("{n} min ago", { n: m })
      : !withDays || m < 1440
        ? t("{n} h ago", { n: Math.round(m / 60) })
        : t("{n} d ago", { n: Math.round(m / 1440) });
};

/** "{m} min ago", "{h}h ago", "{d}d ago": no "just now", no space before h and d. */
export const agoTight = (at: number) => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return m < 60 ? t("{m} min ago", { m }) : m < 1440 ? t("{h}h ago", { h: Math.round(m / 60) }) : t("{d}d ago", { d: Math.round(m / 1440) });
};
