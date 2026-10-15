import { type ReactNode, useEffect, useState } from "react";
import { ZH } from "./zh";

/**
 * The site in English and Simplified Chinese. Strings are keyed by their English text: `t("Ask the beaver")`.
 * A string without a translation stays English, so nothing breaks while a page is half done. Switching language
 * remounts the app, so `t()` works anywhere without hooks.
 */
export type Lang = "en" | "zh";

const KEY = "zoo:lang";
const listeners = new Set<(l: Lang) => void>();

function initial(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "zh" || q === "en") return q;
    const saved = window.localStorage.getItem(KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* storage blocked: fall through to the browser's language */
  }
  return typeof navigator !== "undefined" && /^zh\b/i.test(navigator.language) ? "zh" : "en";
}

let current: Lang = typeof window === "undefined" ? "en" : initial();
const apply = (l: Lang) => {
  if (typeof document !== "undefined") document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
};
apply(current);

export const lang = () => current;

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  apply(l);
  try {
    window.localStorage.setItem(KEY, l);
  } catch {
    /* the choice lasts this visit */
  }
  // A shared link keeps the language it was opened in.
  const url = new URL(window.location.href);
  if (l === "zh") url.searchParams.set("lang", "zh");
  else url.searchParams.delete("lang");
  window.history.replaceState(window.history.state, "", url);
  for (const fn of listeners) fn(l);
}

/** Translates an English string; `{name}` placeholders are filled from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  const s = current === "zh" ? (ZH[en] ?? en) : en;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Picks between two texts when a sentence is built differently in each language. */
export const pick = <T,>(en: T, zh: T): T => (current === "zh" ? zh : en);

/** Remounts its children when the language changes. */
export function LangRoot({ children }: { children: (l: Lang) => ReactNode }) {
  const [l, setL] = useState<Lang>(current);
  useEffect(() => {
    listeners.add(setL);
    return () => void listeners.delete(setL);
  }, []);
  return <>{children(l)}</>;
}

/** EN / 中文 switch. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const l = current;
  const btn = (to: Lang, label: string) => (
    <button
      type="button"
      onClick={() => setLang(to)}
      aria-pressed={l === to}
      className={`rounded-full px-2.5 py-1 transition-colors ${l === to ? "bg-white text-black" : "text-white/60 hover:text-white"}`}
    >
      {label}
    </button>
  );
  return (
    <div className={`liquid-glass flex items-center gap-0.5 rounded-full p-0.5 text-[12px] ${className}`} role="group" aria-label="Language">
      {btn("en", "EN")}
      {btn("zh", "中文")}
    </div>
  );
}

/**
 * The chain's own phrases, written by the nodes in English: "creator sold 92% after 3 min", "pool drained to 0.9 SOL
 * after graduation", the judges' rule flags. Known patterns are translated; anything else passes through.
 */
const CHAIN: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^creator sold (\d+)% after (\d+) min$/, (m) => `开发者 ${m[2]} 分钟后卖出 ${m[1]}%`],
  [/^pool drained to ([\d.]+) SOL after graduation$/, (m) => `毕业后池子被抽到只剩 ${m[1]} SOL`],
  [/^wallet's (\d+)(?:st|nd|rd|th) launch today$/, (m) => `该钱包今天第 ${m[1]} 次发币`],
  [/^\+([\d.]+) SOL buy after graduation$/, (m) => `毕业后 +${m[1]} SOL 大单买入`],
  [/^\+([\d.]+) SOL buy$/, (m) => `+${m[1]} SOL 大单买入`],
  [/^graduated$/, () => "已毕业"],
  [/^new launch$/, () => "新币上线"],
  [/^creator sold (\d+)% of their bag$/, (m) => `开发者卖出了 ${m[1]}% 的筹码`],
  [/^creator launched (\d+) tokens today$/, (m) => `开发者今天发了 ${m[1]} 个币`],
  [/^bundled: (\d+) wallets took (\d+)% of supply in the launch block$/, (m) => `捆绑：开盘区块 ${m[1]} 个钱包吃走 ${m[2]}% 的供应`],
  [/^no socials$/, () => "没有社交媒体"],
  [/^sells outnumber buys 3:1$/, () => "卖单是买单的 3 倍"],
  [/^volume 50x liquidity$/, () => "交易量是流动性的 50 倍"],
  [/^copies the ticker of (.+)$/, (m) => `抄袭 ${m[1]} 的代号`],
];

export function tChain(text: string): string {
  if (current !== "zh") return text;
  for (const [re, fn] of CHAIN) {
    const m = text.match(re);
    if (m) return fn(m);
  }
  return text;
}
