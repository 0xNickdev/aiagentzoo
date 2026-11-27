import { type ReactNode, useEffect, useState } from "react";

/** The Chinese strings (100+ KB) load only for readers who use them. */
let ZH: Record<string, string> = {};
let zhLoad: Promise<void> | null = null;
const loadZh = () =>
  (zhLoad ??= import("./zh").then(
    (m) => void (ZH = m.ZH),
    () => void (zhLoad = null),
  ));

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
  const notify = () => {
    for (const fn of listeners) fn(l);
  };
  if (l === "zh") void loadZh().then(notify);
  else notify();
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
  // A reader who opens the site in Chinese waits for the strings once, instead of seeing English flash first.
  const [ready, setReady] = useState(current !== "zh");
  useEffect(() => {
    listeners.add(setL);
    if (!ready) void loadZh().then(() => setReady(true));
    return () => void listeners.delete(setL);
  }, []);
  return ready ? <>{children(l)}</> : null;
}

/** EN / 中文 switch. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const l = current;
  const btn = (to: Lang, label: string) => (
    <button
      type="button"
      onClick={() => setLang(to)}
      aria-pressed={l === to}
      className={`whitespace-nowrap rounded-[5px] px-2 py-0.5 transition-colors ${l === to ? "bg-night-raised text-white" : "text-faint hover:text-white"}`}
    >
      {label}
    </button>
  );
  return (
    <div className={`flex items-center gap-0.5 rounded-[7px] border border-line p-0.5 text-[12px] ${className}`} role="group" aria-label="Language">
      {btn("en", "EN")}
      {btn("zh", "中文")}
    </div>
  );
}

/** The operator graph's tie words (apps/node/src/chain/opgraph.ts TIE_TEXT). */
const TIE_ZH: Record<string, string> = { "same funder": "同一个资助者", "SOL from another launch wallet": "来自其他发币钱包的 SOL", "the same early snipers": "同一批早期狙击手", "the same private launch tool": "同一个私有发币工具", "the same account": "同一个账号" };

/**
 * The chain's own phrases, written by the nodes in English: "creator sold 92% after 3 min", "pool drained to 0.9 SOL
 * after graduation", the judges' rule flags. Known patterns are translated; anything else passes through.
 */
const CHAIN: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^(\d+) wallets have bought in: with a crowd like that, .*$/, (m) => `已有 ${m[1]} 个钱包买入：人这么多时，开发者卖出、砸盘记录、捆绑和开发者自己的狙击钱包是大多数发币的常态，所以这里只是警告，不决定结论`],
  [/^this dev sells early, yet (\d+)% of their last (\d+) launches went past \$20K(?: \(usual peak (\$[\d.]+[KM])\))?: .*$/, (m) => `这个开发者习惯早卖，但他最近 ${m[2]} 次发币中有 ${m[1]}% 涨过 $20K${m[3] ? `（通常峰值 ${m[3]}）` : ""}：快速卖出是他的套路，风险在于能否及时离场，而不是跑路`],
  [/^creator sold (\d+)% after (\d+)(s| min| h)$/, (m) => `开发者 ${m[2]}${m[3] === "s" ? " 秒" : m[3] === " h" ? " 小时" : " 分钟"}后卖出 ${m[1]}%`],
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
  [/^the dev sold at a loss$/, () => "开发者亏本卖出"],
  [/^the dev bought back after selling$/, () => "开发者卖出后又买回"],
  [/^the dev took back what they put in and still holds (\d+)%$/, (m) => `开发者收回了投入的本金，仍持有 ${m[1]}%`],
  [/^the dev took back (\d+)% of what they put in and still holds (\d+)%$/, (m) => `开发者收回了投入的 ${m[1]}%，仍持有 ${m[2]}%`],
  [/^the dev sold (\d+)% in the first minute$/, (m) => `开发者在第一分钟内卖出 ${m[1]}%`],
  [/^the dev sold (\d+)% after (\d+) minutes?$/, (m) => `开发者在 ${m[2]} 分钟后卖出 ${m[1]}%`],
  [/^the dev sold (\d+)% after (\d+) hours$/, (m) => `开发者在 ${m[2]} 小时后卖出 ${m[1]}%`],
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
  [/^the wallet that opened this pool took the liquidity back: ([\d.,]+) SOL out after ([\d.,]+) SOL in$/, (m) => `开池钱包已把流动性撤走：投入 ${m[2]} SOL，撤出 ${m[1]} SOL`],
  [/^the wallet that opened this pool opened and emptied (\d+) other pools? in the last three days$/, (m) => `开池钱包过去三天还开过并撤空了另外 ${m[1]} 个池子`],
  [/^(\d+) of (\d+) trades drawn at random passed one bag between two wallets through the pool(, so most of the volume shown is not buying)?$/, (m) => `随机抽取 ${m[2]} 笔交易中有 ${m[1]} 笔是两个钱包通过池子对倒同一份筹码${m[3] ? "，所以显示的成交量大多不是真实买入" : ""}`],
  [/^its pool was opened straight on PumpSwap, outside the launchpads the stream reads: this is what the pool's own transactions show, with no launch on record$/, () => "它的池子是直接在 PumpSwap 上开的，不在数据流读取的发射台之内：这里是池子自身交易显示的情况，没有发币记录"],
  [/^only (\d+) wallets have bought it$/, (m) => `只有 ${m[1]} 个钱包买过`],
  [/^only 1 wallet has bought it$/, () => "只有 1 个钱包买过"],
  [/^dumped (\d+) min after launch$/, (m) => `开盘 ${m[1]} 分钟后砸盘`],
  [/^sells outnumber buys (\d+) to (\d+)$/, (m) => `卖单多于买单：${m[1]} 比 ${m[2]}`],
  [/^at least (\d+)% of the trading is wallets selling back what they just bought: volume, not holders$/, (m) => `至少 ${m[1]}% 的成交是钱包刚买就卖回：这是刷量，不是持有者`],
  [/^a bot bought and sold it in the same transaction (\d+) times to keep it on the front page$/, (m) => `机器人在同一笔交易里买了又卖 ${m[1]} 次，为了挂在首页`],
  [/^one wallet holds (\d+)% of the supply$/, (m) => `一个钱包持有 ${m[1]}% 的供应`],
  [/^(\d+) of its (\d+) biggest buyers were paid from (the dev's own wallet|one wallet up to (\d+) hops back|one wallet) and took (\d+)% of the supply; they still hold (\d+)%$/, (m) => `最大的 ${m[2]} 个买家里有 ${m[1]} 个的资金来自${m[3] === "the dev's own wallet" ? "开发者自己的钱包" : m[4] ? `同一个钱包（最多往上 ${m[4]} 跳）` : "同一个钱包"}，买走了 ${m[5]}% 的供应，现在还持有 ${m[6]}%`],
  [/^the money of its (\d+) biggest buyers was traced up to (\d+) hops back: no one wallet paid enough of them to flag(?: \((\d+) had no funding to follow\))?$/, (m) => `最大的 ${m[1]} 个买家的资金已往上追溯最多 ${m[2]} 跳：没有一个钱包资助了足够多的买家，不构成警告${m[3] ? `（其中 ${m[3]} 个没有可追溯的资金来源）` : ""}`],
  [/^the funding of (\d+) of its (\d+) biggest buyers could not be read this time, so the one-wallet check is incomplete: check again in a minute$/, (m) => `最大的 ${m[2]} 个买家里有 ${m[1]} 个的资金来源这次没能读取，同一钱包检查不完整：一分钟后再查一次`],
  [/^the funding of (\d+) of its (\d+) biggest buyers is too far back in a long history to read, so the one-wallet check is incomplete$/, (m) => `最大的 ${m[2]} 个买家里有 ${m[1]} 个的历史太长，读不到最初的资金来源，同一钱包检查不完整`],
  [/^the money trail of its biggest buyers took too long to read this time, so the one-wallet check is not in this answer: check again in a minute$/, () => "这次追溯最大买家的资金用时太久，本次结果不含同一钱包检查：一分钟后再查一次"],
  [/^one wallet can still freeze any holder's tokens: a frozen wallet cannot sell$/, () => "仍有一个钱包可以冻结任何持有者的代币：被冻结的钱包无法卖出"],
  [/^one wallet can move or burn any holder's tokens without asking: a permanent delegate$/, () => "有一个钱包可以不经同意转走或销毁任何持有者的代币：永久代理"],
  [/^one wallet can pause every transfer of it: while paused nobody can sell$/, () => "有一个钱包可以暂停所有转账：暂停期间谁也卖不了"],
  [/^a new holder's tokens start frozen until the token's authority thaws them$/, () => "新持有者的代币一开始就是冻结的，要等代币权限方解冻"],
  [/^it cannot be transferred, so it cannot be sold$/, () => "这个代币不能转账，所以也不能卖出"],
  [/^the supply is not fixed: one wallet can still mint more$/, () => "供应不固定：仍有一个钱包可以增发"],
  [/^a program of the creator's choosing runs on every transfer and can refuse a sell: a transfer hook$/, () => "每次转账都会运行开发者指定的程序，它可以拒绝卖出：转账钩子"],
  [/^every transfer pays a ([\d.]+)% fee to the token's authority$/, (m) => `每次转账都要向代币权限方支付 ${m[1]}% 的手续费`],
  [/^(.+) issues it and keeps the rights to mint and freeze it, as a stablecoin issuer does: said, not scored$/, (m) => `${m[1]} 发行它并保留增发和冻结的权限，稳定币发行方都这样：仅作说明，不计分`],
  [/^the 10 largest wallets hold (\d+)% of the supply$/, (m) => `前十大钱包持有 ${m[1]}% 的供应`],
  [/^the creator never sold: they locked ([\d.]+)% of the supply in a token locker until its date$/, (m) => `开发者从未卖出：他把 ${m[1]}% 的供应锁进了锁仓合约，直到解锁日`],
  [/^the creator never sold: the bag left their wallet, and ([\d.]+)% of the supply is locked in a token locker until its date$/, (m) => `开发者从未卖出：筹码离开了钱包，${m[1]}% 的供应锁在锁仓合约中直到解锁日`],
  [/^the creator no longer holds any of it, but never sold on the curve: the bag moved to other wallets$/, () => "开发者已经不持有，但从没在内盘卖过：筹码转去了别的钱包"],
  [/^this wallet launched (\d+) tokens in 24 hours: launch spam, not a project$/, (m) => `这个钱包 24 小时内发了 ${m[1]} 个币：批量刷币，不是项目`],
  [/^just launched: no red flags yet, so check again before adding$/, () => "刚刚发币：暂无危险信号，加仓前再查一次"],
  [/^launches like this one ran (\d+)x more often than the average launch: the people around it do rug things, yet it may still run, so the risk is getting out in time$/, (m) => `同类发币上涨的概率是平均的 ${m[1]} 倍：它周围的人在做跑路的事，但它仍可能上涨，风险在于能否及时离场`],
  [/^just launched: more can show up, check again before adding$/, () => "刚刚发币：还可能出现更多信号，加仓前再查一次"],
  [/^only (\d+) min old: no red flags yet, so check again before adding$/, (m) => `才发币 ${m[1]} 分钟：暂无危险信号，加仓前再查一次`],
  [/^only (\d+) min old: more can show up, check again before adding$/, (m) => `才发币 ${m[1]} 分钟：还可能出现更多信号，加仓前再查一次`],
  [/^launched in Mayhem Mode: .*$/, () => "Mayhem 模式发币：供应 20 亿，前 24 小时 pump.fun 自己的机器人在交易，所以成交量里有一部分是它"],
  [/^trades here stop at our record of (.+), (\d+) (h|days) after launch: .*$/, (m) => `这里的交易数据截止到我们 ${m[1]} 的记录（发币后 ${m[2]} ${m[3] === "h" ? "小时" : "天"}）：之后发生的不在本次检查内`],
  [/^(\d+) wallets have bought it in bundles over its (\d+) days and held up to (\d+)% together, (\d+)% now; .*$/, (m) => `${m[1]} 个钱包在它的 ${m[2]} 天里捆绑买入过，合计最多持有 ${m[3]}%，现在 ${m[4]}%；对这么老、池子还活着的币，同块买入多半就是它的正常市场，不决定结论`],
  [/^about (\d+)% of its trading over its life is wallets selling back what they just bought: .*$/, (m) => `它一生中约 ${m[1]}% 的成交是钱包刚买就卖回：对这么老的币，这就是它的市场交易方式，不是伪造的发射`],
  [/^(\d+) wallets bought it in bundles and held up to (\d+)% of the supply together; they have sold down to (\d+)%, so they no longer decide the verdict$/, (m) => `${m[1]} 个钱包捆绑买入，合计最多持有 ${m[2]}% 的供应；现在已卖到 ${m[3]}%，不再决定结论`],
  [/^(\d+) wallets bought it in bundles and held up to (\d+)% of the supply together, under the 30% we flag; they still hold (\d+)%$/, (m) => `${m[1]} 个钱包捆绑买入，合计最多持有 ${m[2]}% 的供应，低于我们 30% 的标记线；现在还持有 ${m[3]}%`],
  [/^pass means .*$/, () => "通过只代表链上没看到开发者砸盘、大额捆绑、开发者小号、狙击手囤货、连环发币或内盘归零，不代表会涨"],
  [/^who funded the creator is not traced yet: it is queued$/, () => "还没追踪到谁给开发者打的钱：已排队"],
  [/^holders could not be read from (Solana|BNB Chain|Base) right now$/, (m) => `暂时无法从 ${m[1]} 读取持币者`],
  [/^not a launch from four\.meme or Flap in the last two days, so there is no chain record to check$/, () => "不是过去两天里在 four.meme 或 Flap 上发的币，所以没有链上记录可查"],
  [/^not a Clanker launch on Base in the last two days, so there is no chain record to check$/, () => "不是过去两天里在 Base 上通过 Clanker 发的币，所以没有链上记录可查"],
  [/^\+([\d.]+) (BNB|ETH) buy$/, (m) => `+${m[1]} ${m[2]} 大单买入`],
  [/^the chain stream is down right now: .*$/, () => "链上数据流暂时中断：结果可能不是最新的"],
  [/^(\d+) wallets bought (\d+)% of the supply in the launch block; they still hold (\d+)% of it$/, (m) => `开盘区块里 ${m[1]} 个钱包买走了 ${m[2]}% 的供应；其中 ${m[3]}% 还在手里`],
  [/^(\d+) wallets bought (\d+)% of the supply in the launch block and have sold (\d+)% of it$/, (m) => `开盘区块里 ${m[1]} 个钱包买走了 ${m[2]}% 的供应，其中 ${m[3]}% 已卖出`],
  [/^(\d+) wallets bought it in bundles \(four or more in one block\) and held up to (\d+)% of the supply together; they still hold (\d+)%$/, (m) => `${m[1]} 个钱包捆绑买入（同一区块四个以上），合计最多持有 ${m[2]}% 的供应；现在还持有 ${m[3]}%`],
  [/^launched with (a tool setup built like that of|the same tool setup as) (\d+) other wallets in two days; their creators dumped (\d+) of (\d+) of those launches$/, (m) => `发币工具配置与两天内另外 ${m[2]} 个钱包${m[1]!.startsWith("the same") ? "相同" : "相似"}；那 ${m[4]} 个币里开发者砸了 ${m[3]} 个`],
  [/^the dev signed transactions together with (\d+) other wallets?: one operator, whose other wallets launched (\d+) coins in two days and dumped (\d+) of the (\d+) that settled$/, (m) => `开发者与另外 ${m[1]} 个钱包共同签过交易：同一个操盘手，其他钱包两天内发了 ${m[2]} 个币，已有结果的 ${m[4]} 个里砸了 ${m[3]} 个`],
  [/^the dev who launched it dumps their launches and already sold .*$/, () => "发币的开发者惯于砸盘，且已卖到不足 1%；现在靠持有者撑着，风险在市场，不在开发者"],
  [/^the dev sold to shake out the snipers and came back through their own wallets: wallets that snipe their launches hold (\d+)% of the supply$/, (m) => `开发者先卖出洗掉狙击手，又用自己的钱包买回：常狙他币的钱包持有 ${m[1]}% 的供应`],
  [/^the creator wallet is (.+?)'s deployer: it creates every coin launched there \((\d+) in 24 hours\).*$/, (m) => `创建钱包是${m[1] === "a launchpad" ? "某个发币平台" : ` ${m[1]} `}的部署钱包：那里的每个币都由它创建（24 小时 ${m[2]} 个），所以这个数量属于平台，不属于某个开发者`],
  [/^launched (\d{4}-\d\d-\d\d), before the stream's window: .*$/, (m) => `${m[1]} 发币，早于数据流的记录范围：没有发币时的记录，只能看到现在谁持有以及开发者的历史`],
  [/^its dev dumped (\d+) of (\d+) launches the zoo has kept$/, (m) => `在我们保存的记录里，它的开发者 ${m[2]} 个币砸了 ${m[1]} 个`],
  // Operator graph, early callers, borrowed accounts and the channel's posts against the chain (nodes, Nov 2026).
  [/^this dev shares (.+?) as (\d+) other launch wallets? whose (\d+) launches dumped (\d+) times(?:; same (.+))?$/, (m) => `这个开发者与另外 ${m[2]} 个发币钱包有${m[1]!.split(" and ").map((k) => TIE_ZH[k] ?? k).join("和")}，这些钱包的 ${m[3]} 次发币砸了 ${m[4]} 次${m[5] ? `；同一个 ${m[5]}` : ""}`],
  [/^called early by (\S+)(?: and (\d+) more good callers?)?, (?:in the first minute|(\d+) min after launch) \(record: (\d+) of (\d+) calls ended up, (\d+) dead(?:, median ([\d.]+)x)?\)$/, (m) => `${m[1]} ${m[2] ? `和另外 ${m[2]} 个靠谱叫单者` : ""}${m[3] ? `在发币 ${m[3]} 分钟后` : "在第一分钟"}就喊了（战绩：${m[5]} 次喊单 ${m[4]} 次上涨，${m[6]} 次归零${m[7] ? `，中位 ${m[7]}x` : ""}）`],
  [/^this (X account|X community|Telegram group) \((.+)\) appears on (\d+) launches by (\d+) different devs; it is likely borrowed$/, (m) => `这个${m[1] === "Telegram group" ? " Telegram 群" : m[1] === "X community" ? " X 社区" : " X 账号"}（${m[2]}）出现在 ${m[4]} 个不同开发者的 ${m[3]} 次发币上：多半是借用的`],
  [/^the (X account|X community|Telegram group) this token links to \((.+)\) is also on (\d+) other launch(?:es)? from the last (\d+) days; their dev sold within 5 minutes on (\d+)$/, (m) => `这个币关联的${m[1] === "Telegram group" ? " Telegram 群" : m[1] === "X community" ? " X 社区" : " X 账号"}（${m[2]}）在过去 ${m[4]} 天还出现在另外 ${m[3]} 个币上，其中 ${m[5]} 个的开发者 5 分钟内就卖了`],
  [/^the channel posted '(.+)' at (.+?) UTC; the dev wallet sold (\d+)% at (.+?) UTC$/, (m) => `频道在 ${m[2]} UTC 发了"${m[1]}"；开发者钱包在 ${m[4]} UTC 卖出了 ${m[3]}%`],
  [/^the channel posted (\d+) other contracts in the posts we read(?:; (\d+) of them trade under the line or nowhere now)?$/, (m) => `在我们读到的帖子里，频道还发过 ${m[1]} 个其他合约${m[2] ? `；其中 ${m[2]} 个现在低于基准线或已不在交易` : ""}`],
  [/^trades before we watched could not be read yet$/, () => "我们开始读取之前的交易暂时还读不到"],
  // The radar's reasons (apps/node/src/chain/radar.ts termText).
  [/^(\d+) buyers in 5 minutes$/, (m) => `5 分钟内 ${m[1]} 个买家`],
  [/^(\d+) buys from just (\d+) buyers$/, (m) => `只有 ${m[2]} 个买家，买了 ${m[1]} 笔`],
  [/^(\d+) buys in 5 minutes$/, (m) => `5 分钟内 ${m[1]} 笔买入`],
  [/^(\d+) buys in 5 minutes, a quiet start$/, (m) => `5 分钟内 ${m[1]} 笔买入，开局安静`],
  [/^(\d+) sells, plenty of trading$/, (m) => `${m[1]} 笔卖出，交易活跃`],
  [/^only (\d+) sells so far$/, (m) => `目前只有 ${m[1]} 笔卖出`],
  [/^([\d.]+) SOL in$/, (m) => `流入 ${m[1]} SOL`],
  [/^([\d.]+) SOL cap at 5 minutes$/, (m) => `第 5 分钟市值 ${m[1]} SOL`],
  [/^top 5 buyers took (\d+)%$/, (m) => `前五买家拿走 ${m[1]}%`],
  [/^top 5 buyers took only (\d+)%$/, (m) => `前五买家只拿走 ${m[1]}%`],
  [/^(\d+)% of buyers already out$/, (m) => `${m[1]}% 的买家已离场`],
  [/^few buyers out yet \((\d+)%\)$/, (m) => `离场的买家还很少（${m[1]}%）`],
  [/^dev sold (\d+)%$/, (m) => `开发者卖了 ${m[1]}%`],
  [/^dev has not sold$/, () => "开发者还没卖"],
  [/^dev sold only (\d+)%$/, (m) => `开发者只卖了 ${m[1]}%`],
  [/^early wallets still hold (\d+)%$/, (m) => `早期钱包仍持有 ${m[1]}%`],
  [/^early wallets hold nothing$/, () => "早期钱包已不持有"],
  [/^early wallets hold only (\d+)%$/, (m) => `早期钱包只持有 ${m[1]}%`],
  [/^no bundles holding$/, () => "没有捆绑持仓"],
  [/^bundles peaked at (\d+)%$/, (m) => `捆绑峰值 ${m[1]}%`],
  [/^bundles peaked at only (\d+)%$/, (m) => `捆绑峰值只有 ${m[1]}%`],
  [/^no SOL bundled at launch$/, () => "开盘没有捆绑 SOL"],
  [/^([\d.]+) SOL bundled at launch$/, (m) => `开盘捆绑 ${m[1]} SOL`],
  [/^the dev's first launch$/, () => "开发者第一次发币"],
  [/^the dev launched (\d+) coins before$/, (m) => `开发者之前发过 ${m[1]} 个币`],
  [/^the dev graduated (\d+) before$/, (m) => `开发者之前有 ${m[1]} 个币毕业`],
  [/^the dev never graduated a coin$/, () => "开发者从没有币毕业过"],
  [/^(\d+) early wallets? with a runner record$/, (m) => `${m[1]} 个早期钱包有拉盘战绩`],
  [/^(\d+) first-second wallets$/, (m) => `首秒钱包 ${m[1]} 个`],
  [/^only (\d+) first-second wallets$/, (m) => `首秒钱包只有 ${m[1]} 个`],
];

export function tChain(text: string): string {
  if (current !== "zh") return text;
  for (const [re, fn] of CHAIN) {
    const m = text.match(re);
    if (m) return fn(m);
  }
  return text;
}
