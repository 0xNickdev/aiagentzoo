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
  // Inside Telegram the account's language is the better guess than the device's.
  const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } }).Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tg) return /^zh/i.test(tg) ? "zh" : "en";
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
  // The creator check's reasons and notes (apps/node/src/chain/check.ts).
  [/^the creator (?:has )?sold (\d+)% of their own bag$/, (m) => `开发者已卖出自己 ${m[1]}% 的筹码`],
  [/^this creator dumped (\d+) of their (\d+) launches in 48 hours(?:, usually (\d+) min after launch)?$/, (m) => `这个开发者 48 小时内 ${m[2]} 个币砸了 ${m[1]} 个${m[3] ? `，通常在发币 ${m[3]} 分钟后` : ""}`],
  [/^the creator launched (\d+) tokens in the last 24 hours$/, (m) => `开发者过去 24 小时发了 ${m[1]} 个币`],
  [/^the wallet that funded this creator also funded (\d+) other launchers?; they dumped (\d+) of their (\d+) launches in 48 hours$/, (m) => `给这个开发者打钱的钱包还资助了另外 ${m[1]} 个发币号；它们 48 小时内 ${m[3]} 个币砸了 ${m[2]} 个`],
  [/^the wallet that funded this creator also funded (\d+) other launchers? the zoo has traced$/, (m) => `给这个开发者打钱的钱包还资助了另外 ${m[1]} 个已追踪到的发币号`],
  [/^(\d+) wallets bought (\d+)% of the supply in the launch block$/, (m) => `开盘区块里 ${m[1]} 个钱包买走了 ${m[2]}% 的供应`],
  [/^(\d+) wallets that bought in the first 5 seconds still hold (\d+)% of the supply$/, (m) => `前 5 秒买入的 ${m[1]} 个钱包仍持有 ${m[2]}% 的供应`],
  [/^(\d+) of the wallets in the first 5 seconds keep sniping this creator's other launches: they are the creator's own wallets$/, (m) => `前 5 秒的钱包里有 ${m[1]} 个一直在狙这个开发者的其他币：它们就是开发者自己的小号`],
  [/^(\d+) of the first-second wallets have sniped launches together before: one operator$/, (m) => `前几秒的钱包里有 ${m[1]} 个以前一起狙过币：同一个操盘手`],
  [/^(\d+) serial snipers got in first: wallets that buy launches in the first seconds to sell to whoever comes next$/, (m) => `${m[1]} 个职业狙击手抢在最前面：开盘几秒就买，卖给后来的人`],
  [/^graduated, but the pool is down to ([\d.]+) SOL$/, (m) => `已毕业，但池子只剩 ${m[1]} SOL`],
  [/^(\d+) hours old and the curve is back where it opened: nobody is holding it$/, (m) => `已发币 ${m[1]} 小时，内盘回到起点：没人拿着`],
  [/^the top 5 buyers took (\d+)% of all buying$/, (m) => `前五买家占了全部买入的 ${m[1]}%`],
  [/^not a launch from pump\.fun, Raydium LaunchLab or Meteora in the last two days, so there is no chain record to check$/, () => "不是过去两天里在 pump.fun、Raydium LaunchLab 或 Meteora 上发的币，所以没有链上记录可查"],
  [/^the (X account|X community|Telegram group) this token links to \((.+)\) is also on (\d+) other launch(?:es)? from the last 48 hours; their dev sold within 5 minutes on (\d+)$/, (m) => `这个币关联的${m[1] === "Telegram group" ? " Telegram 群" : m[1] === "X community" ? " X 社区" : " X 账号"}（${m[2]}）在过去 48 小时还出现在另外 ${m[3]} 个币上，其中 ${m[4]} 个的开发者 5 分钟内就卖了`],
  [/^nobody has bought it$/, () => "还没人买"],
  [/^only (\d+) wallets have bought it$/, (m) => `只有 ${m[1]} 个钱包买过`],
  [/^only 1 wallet has bought it$/, () => "只有 1 个钱包买过"],
  [/^sells outnumber buys (\d+) to (\d+)$/, (m) => `卖单多于买单：${m[1]} 比 ${m[2]}`],
  [/^at least (\d+)% of the trading is wallets selling back what they just bought: volume, not holders$/, (m) => `至少 ${m[1]}% 的成交是钱包刚买就卖回：这是刷量，不是持有者`],
  [/^a bot bought and sold it in the same transaction (\d+) times to keep it on the front page$/, (m) => `机器人在同一笔交易里买了又卖 ${m[1]} 次，为了挂在首页`],
  [/^one wallet holds (\d+)% of the supply$/, (m) => `一个钱包持有 ${m[1]}% 的供应`],
  [/^the 10 largest wallets hold (\d+)% of the supply$/, (m) => `前十大钱包持有 ${m[1]}% 的供应`],
  [/^the creator no longer holds any of it, but never sold on the curve: the bag moved to other wallets$/, () => "开发者已经不持有，但从没在内盘卖过：筹码转去了别的钱包"],
  [/^only (\d+) min old: no red flags yet, so check again before adding$/, (m) => `才发币 ${m[1]} 分钟：暂无危险信号，加仓前再查一次`],
  [/^only (\d+) min old: more can show up, check again before adding$/, (m) => `才发币 ${m[1]} 分钟：还可能出现更多信号，加仓前再查一次`],
  [/^launched in Mayhem Mode: .*$/, () => "Mayhem 模式发币：供应 20 亿，前 24 小时 pump.fun 自己的机器人在交易，所以成交量里有一部分是它"],
  [/^pass means .*$/, () => "通过只代表链上没看到开发者砸盘、捆绑、开发者小号、狙击手囤货、连环发币或内盘归零，不代表会涨"],
  [/^who funded the creator is not traced yet: it is queued$/, () => "还没追踪到谁给开发者打的钱：已排队"],
  [/^holders could not be read from Solana right now$/, () => "暂时无法从 Solana 读取持币者"],
  [/^the chain stream is down right now: .*$/, () => "链上数据流暂时中断：结果可能不是最新的"],
];

export function tChain(text: string): string {
  if (current !== "zh") return text;
  for (const [re, fn] of CHAIN) {
    const m = text.match(re);
    if (m) return fn(m);
  }
  return text;
}
