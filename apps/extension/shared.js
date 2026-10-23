// Shared by the popup, the content scripts and the background worker: where the zoo lives, how a verdict looks, how to find a token in text.
var ZOO = (() => {
  const SITE = "https://zooaiagency.com";
  const BOT = "https://t.me/zooaiagency_bot";
  const TONE = {
    avoid: { get label() { return t("AVOID"); }, color: "#ff8a7e", badge: "!!", badgeBg: "#d9584b" },
    caution: { get label() { return t("CAUTION"); }, color: "#f2d39b", badge: "!", badgeBg: "#b8913f" },
    pass: { get label() { return t("NO RED FLAGS"); }, color: "#9df3b0", badge: "ok", badgeBg: "#3f8f55" },
    unknown: { get label() { return t("NOT ON THE STREAM"); }, color: "#d9d8d3", badge: "", badgeBg: "#444" },
  };
  const VENUE = { "pump.fun": "pump.fun", launchlab: "Raydium LaunchLab", dbc: "Meteora" };
  const B58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  /** Every Solana address in a piece of text, longest first so a token beats a shorter fragment. */
  const addresses = (text) => [...new Set((String(text || "").match(B58) || []).filter((a) => a.length >= 32))];
  const pct = (x) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");
  const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
  const secs = (s) => (s === null || s === undefined ? "-" : s < 120 ? `${s}s` : `${Math.round(s / 60)}m`);
  const mins = (m) => (m < 60 ? t("{n} min", { n: m }) : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);
  const ago = (at) => {
    const m = Math.max(0, Math.round((Date.now() - at) / 60000));
    return m < 1 ? t("now") : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };
  const sym = (s) => String(s || "?").replace(/^\$+/, "");
  const ask = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? { error: t("The extension restarted. Reload the page.") } : r)));
  return { SITE, BOT, TONE, VENUE, addresses, pct, short, secs, mins, ago, sym, ask };
})();

// English and Simplified Chinese. Strings are keyed by their English text: t("Alert me"). A string without a
// translation stays English. Chinese when the browser is Chinese, unless the popup's EN / 中文 switch saved a choice.
var ZOO_LANG = /^zh/i.test((typeof navigator !== "undefined" && navigator.language) || "") ? "zh" : "en";
var ZOO_LANG_READY = (async () => {
  try {
    const v = await chrome.storage.local.get("lang");
    if (v.lang === "en" || v.lang === "zh") ZOO_LANG = v.lang;
  } catch {
    /* storage unavailable: the browser's language stands */
  }
  return ZOO_LANG;
})();
try {
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch.lang && (ch.lang.newValue === "en" || ch.lang.newValue === "zh")) ZOO_LANG = ch.lang.newValue;
  });
} catch {
  /* not in an extension context */
}
function lang() {
  return ZOO_LANG;
}
var ZH = {
  // verdicts
  AVOID: "避开",
  CAUTION: "谨慎",
  "NO RED FLAGS": "目前没有红旗",
  "NOT ON THE STREAM": "不在数据流里",
  CLEAR: "无红旗",
  VERDICT: "判定",
  "LIVE READ": "实时读取",
  "STREAM BEHIND": "数据流延迟",
  // shared
  "The extension restarted. Reload the page.": "扩展已重启，请刷新页面。",
  "Something went wrong.": "出错了。",
  now: "刚刚",
  "{n} min": "{n} 分钟",
  copied: "已复制",
  copy: "复制",
  home: "主页",
  // background
  "Ten full x-rays a minute on the free tier. Try again in a minute.": "免费版每分钟 10 次完整 X 光，请一分钟后再试。",
  "Not a launch the stream saw in the last two days (pump.fun, LaunchLab, Meteora).": "不是数据流在过去两天里看到的新币（pump.fun、LaunchLab、Meteora）。",
  "Too many lookups this minute. Try again in a minute.": "这一分钟查询太多了，请一分钟后再试。",
  "This wallet did not launch, snipe or fund a launch the stream saw in the last two days.": "过去两天里，这个钱包没有发过、狙过或资助过数据流看到的币。",
  "X-Ray this token": "X 光查看这个币",
  "the dev sold": "开发者卖了",
  "the pool was drained": "池子被抽干了",
  "it graduated": "已毕业",
  "a whale bought": "巨鲸买入",
  // popup
  "token or wallet address, or a link": "代币或钱包地址，或链接",
  "X-ray": "X 光",
  "See who you're buying from.": "看清你在跟谁买。",
  "Open a token on pump.fun, DexScreener, gmgn, Axiom, Photon or BullX: the verdict shows up on the page.": "在 pump.fun、DexScreener、gmgn、Axiom、Photon 或 BullX 打开一个币：判定会直接显示在页面上。",
  "On X, token addresses in posts get a verdict chip.": "在 X 上，帖子里的代币地址旁会出现判定标签。",
  "Anywhere: select an address, right click, X-Ray this token.": "任何地方：选中地址，右键，X 光查看这个币。",
  "ALERTS ON": "提醒已开",
  RECENT: "最近",
  "SERIAL DUMPERS": "连环砸盘",
  BUILDERS: "建设者",
  "48 hours": "48 小时",
  "read from public Solana data · not financial advice · ": "数据来自公开的 Solana 链上记录 · 不构成投资建议 · ",
  "read from public Solana data · not financial advice": "数据来自公开的 Solana 链上记录 · 不构成投资建议",
  "Paste a Solana token or wallet address, or a link.": "粘贴一个 Solana 代币或钱包地址，或链接。",
  "since {t}": "{t} 起",
  "Stop alerts": "关闭提醒",
  "Open its page": "打开它的页面",
  "dumped {a} of {b}": "{b} 个砸了 {a} 个",
  "{g} graduated · {d} dumped": "{g} 个毕业 · {d} 个砸盘",
  Language: "语言",
  // pill and chip
  "ZOOAI X-Ray: click to open, drag to move": "ZOOAI X 光：点击打开，拖动移动",
  "site ↗": "网站 ↗",
  minimize: "收起",
  // panel
  "dev's own wallet": "开发者自己的钱包",
  "sniper ring": "狙击团伙",
  "serial sniper": "职业狙击手",
  "launch block": "开盘区块",
  "first 5 s": "前 5 秒",
  "{n} wallets in the first 5 seconds": "前 5 秒有 {n} 个钱包",
  LAUNCH: "开盘",
  "{w} · {k} · in at {a}s · took {b} · holds {c} · {x}": "{w} · {k} · 第 {a} 秒买入 · 拿走 {b} · 持有 {c} · {x}",
  "still in": "仍持有",
  "sold out after {s}": "{s} 后清仓",
  "Copy the token address": "复制代币地址",
  "Track record: {g} of this dev's {n} launches grew and still hold liquidity, and it has not dumped them.": "往绩：这个开发者的 {n} 个币里有 {g} 个涨起来且仍有流动性，它也没有砸过这些币。",
  "the dev": "开发者",
  "{a} of {b} dumped": "{b} 个砸了 {a} 个",
  "first launch": "第一次发币",
  "never bought their own": "没买过自己的币",
  "sold {p}% of their bag": "卖出了 {p}% 的筹码",
  "who paid the dev": "谁给开发者打的钱",
  "tracing…": "追踪中…",
  "no transfer found": "没找到转账",
  "an exchange": "交易所",
  "{n} other devs": "另外 {n} 个开发者",
  "only this dev": "只有这个开发者",
  "funds everyone, ties no one": "给所有人打钱，连不上谁",
  "{n} dumps in 48h": "48 小时内砸盘 {n} 次",
  "dev's own wallets": "开发者自己的钱包",
  "keep sniping this dev": "一直在狙这个开发者的币",
  "rings · serial": "团伙 · 职业",
  "snipers in the first seconds": "头几秒的狙击手",
  "The first 5 seconds": "开盘前 5 秒",
  "{n} wallets": "{n} 个钱包",
  "took ": "拿走 ",
  " of supply": " 的供应",
  "still hold ": "仍持有 ",
  "sold out": "已清仓",
  WALLET: "钱包",
  WHO: "身份",
  TOOK: "拿走",
  OUT: "离场",
  in: "持有",
  "+{n} more on the full X-Ray ↗": "完整 X 光里还有 {n} 个 ↗",
  "Nobody bought before it was visible.": "在它出现在页面上之前没人买。",
  "Alert me": "提醒我",
  "Alerts on ✓": "提醒已开 ✓",
  "{t} old": "已上线 {t}",
  graduated: "已毕业",
  "Mayhem Mode": "Mayhem 模式",
  "Who is behind it": "背后是谁",
  "Who holds it": "谁在持有",
  "top 10": "前 10",
  "largest {p}%": "最大钱包 {p}%",
  "dev holds": "开发者持有",
  "bundlers hold": "捆绑钱包持有",
  "first 5 s hold": "前 5 秒钱包持有",
  "dev's crew holds": "开发者团伙持有",
  "curve / pool": "曲线 / 池子",
  "tap to open": "点击打开",
  "Full X-Ray ↗": "完整 X 光 ↗",
  "Alerts in the Telegram bot": "在 Telegram 机器人里收提醒",
  "A track record: {g} of its {n} launches grew and still hold liquidity, and it has not dumped them.": "有往绩：它的 {n} 个币里有 {g} 个涨起来且仍有流动性，它也没有砸过这些币。",
  "A serial dumper: launched {n} tokens in two days and dumped {d} of them, usually {m} min after launch.": "连环砸盘：两天发了 {n} 个币，砸了 {d} 个，通常在发币 {m} 分钟后。",
  "Pays for other devs: funded {n} launch wallets the zoo traced, with {d} dumps between them in two days.": "给别的开发者打钱：资助了 {n} 个已追踪到的发币钱包，两天内它们一共砸盘 {d} 次。",
  "A sniper: bought {n} launches in their first seconds in two days and sold out of {s}, usually {t} after buying.": "狙击手：两天里在开盘头几秒买了 {n} 个币，清仓了 {s} 个，通常在买入 {t} 后。",
  "A dev whose launches graduated and who has not dumped one in two days.": "这个开发者的币有毕业的，两天内一个都没砸过。",
  "Launched {n} in two days, dumped {d}.": "两天发了 {n}，砸了 {d} 个。",
  "1 token": "1 个币",
  "{n} tokens": "{n} 个币",
  "An exchange or a router: it funds everyone, so it ties no one together.": "交易所或路由钱包：它给所有人打钱，所以不能把谁和谁连起来。",
  "Seen in the first seconds of {n} launches in two days.": "两天里在 {n} 个币开盘的头几秒出现过。",
  DEV: "开发者",
  "FIRST-SECOND BUYER": "头几秒买家",
  "PAYS FOR DEVS": "给开发者打钱",
  "EXCHANGE OR ROUTER": "交易所或路由",
  "solscan ↗": "solscan ↗",
  "As a dev": "作为开发者",
  launched: "发币",
  "{n} in 24h": "24 小时内 {n} 个",
  dumped: "砸盘",
  "usually after {m} min": "通常在 {m} 分钟后",
  "{n} still live": "{n} 个仍在",
  "Open its X-Ray": "打开它的 X 光",
  "{t} · {n} buyers": "{t} · {n} 个买家",
  "dumped after {m} min": "{m} 分钟后砸盘",
  "dev holding": "开发者仍持有",
  "and {n} more in two days": "两天内还有 {n} 个",
  "Who paid for it": "谁出的钱",
  "Not traced yet. It is queued: open this again in a minute.": "还没追踪到。已排队：一分钟后再打开看看。",
  "No funding transfer in the dev's recent history.": "开发者最近的记录里没有资金转入。",
  "funded by": "资金来自",
  "It paid for {n} other devs too, with {d} dumps between them in two days.": "它还给另外 {n} 个开发者打过钱，两天内它们一共砸盘 {d} 次。",
  "It paid for no other dev the zoo traced.": "没追踪到它给别的开发者打过钱。",
  "Keeps buying its launches": "一直买它的币",
  "A wallet in the first seconds of most of one dev's launches is usually that dev's own.": "一个钱包如果在某个开发者大部分币开盘的头几秒都出现，通常就是这个开发者自己的。",
  "{n} of its {m} launches": "它的 {m} 个币里有 {n} 个",
  "Accounts its tokens link to": "它的币关联的账号",
  "Typed in by whoever launched the token: a lead to who is behind it, not proof.": "由发币的人自己填写：是找出背后是谁的线索，不是证据。",
  "{n} launches · {d} fast dumps": "{n} 个币 · {d} 次快速砸盘",
  "As a first-second buyer": "作为头几秒买家",
  sniped: "狙过",
  launches: "个币",
  "sold out of": "清仓了",
  "out after": "离场用时",
  usually: "通常",
  "dev ": "开发者 ",
  "1 launch": "1 个币",
  "{n} launches": "{n} 个币",
  "Devs it paid for": "它资助的开发者",
  "{n} launched · {d} dumped": "发了 {n} 个 · 砸了 {d} 个",
  "Full page ↗": "完整页面 ↗",
  "Solscan ↗": "Solscan ↗",
};
/** Translates an English string; `{name}` placeholders are filled from `vars`. */
function t(en, vars) {
  const s = ZOO_LANG === "zh" ? (ZH[en] ?? en) : en;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
// The chain's own phrases, written by the nodes in English. Same patterns and wording as the site (apps/web/src/i18n.tsx).
var ZOO_CHAIN = [
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
  [/^dumped (\d+) min after launch$/, (m) => `开盘 ${m[1]} 分钟后砸盘`],
  [/^sells outnumber buys (\d+) to (\d+)$/, (m) => `卖单多于买单：${m[1]} 比 ${m[2]}`],
  [/^at least (\d+)% of the trading is wallets selling back what they just bought: volume, not holders$/, (m) => `至少 ${m[1]}% 的成交是钱包刚买就卖回：这是刷量，不是持有者`],
  [/^a bot bought and sold it in the same transaction (\d+) times to keep it on the front page$/, (m) => `机器人在同一笔交易里买了又卖 ${m[1]} 次，为了挂在首页`],
  [/^one wallet holds (\d+)% of the supply$/, (m) => `一个钱包持有 ${m[1]}% 的供应`],
  [/^the 10 largest wallets hold (\d+)% of the supply$/, (m) => `前十大钱包持有 ${m[1]}% 的供应`],
  [/^the creator no longer holds any of it, but never sold on the curve: the bag moved to other wallets$/, () => "开发者已经不持有，但从没在内盘卖过：筹码转去了别的钱包"],
  [/^just launched: no red flags yet, so check again before adding$/, () => "刚刚发币：暂无危险信号，加仓前再查一次"],
  [/^just launched: more can show up, check again before adding$/, () => "刚刚发币：还可能出现更多信号，加仓前再查一次"],
  [/^only (\d+) min old: no red flags yet, so check again before adding$/, (m) => `才发币 ${m[1]} 分钟：暂无危险信号，加仓前再查一次`],
  [/^only (\d+) min old: more can show up, check again before adding$/, (m) => `才发币 ${m[1]} 分钟：还可能出现更多信号，加仓前再查一次`],
  [/^launched in Mayhem Mode: .*$/, () => "Mayhem 模式发币：供应 20 亿，前 24 小时 pump.fun 自己的机器人在交易，所以成交量里有一部分是它"],
  [/^pass means .*$/, () => "通过只代表链上没看到开发者砸盘、捆绑、开发者小号、狙击手囤货、连环发币或内盘归零，不代表会涨"],
  [/^who funded the creator is not traced yet: it is queued$/, () => "还没追踪到谁给开发者打的钱：已排队"],
  [/^holders could not be read from Solana right now$/, () => "暂时无法从 Solana 读取持币者"],
  [/^the chain stream is down right now: .*$/, () => "链上数据流暂时中断：结果可能不是最新的"],
];
/** A reason or note from the node, in the reader's language when the pattern is known; anything else passes through. */
function tChain(text) {
  const s = String(text ?? "");
  if (ZOO_LANG !== "zh") return s;
  for (const [re, fn] of ZOO_CHAIN) {
    const m = s.match(re);
    if (m) return fn(m);
  }
  return s;
}
