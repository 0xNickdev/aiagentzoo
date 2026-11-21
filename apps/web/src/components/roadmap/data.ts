import { OLD_BURIED, OLD_SHIPPED } from "./ledger";

/** One plan, in one file. Shipped means a commit, cut means a reason. Edit this file and the page follows. */
export const UPDATED = "2026-11-21";
export const REPO = "https://github.com/0xNickdev/aiagentzoo";
const commit = (h: string) => ({ label: h, href: `${REPO}/commit/${h}` });

export interface Proof {
  label: string;
  href: string;
}
export interface Shipped {
  id: string;
  date: string;
  title: string;
  text: string;
  why?: string;
  proof: Proof[];
  zh?: { title?: string; text?: string; why?: string };
  /** What the 20 Nov rebuild did to it, when it did anything. */
  cut?: string;
  cutZh?: string;
  /** A milestone rather than a build: no commit behind it. */
  milestone?: boolean;
}
export interface Buried {
  id: string;
  date: string;
  title: string;
  text: string;
  reason: string;
  zh?: { title?: string; text?: string; reason?: string };
}
export interface Planned {
  id: string;
  when?: string;
  whenZh?: string;
  title: string;
  text: string;
  zh: { title: string; text: string };
}

const NEW_SHIPPED: Shipped[] = [
  {
    id: "real-volume",
    date: "2026-11-15",
    title: "Real volume",
    text: "PumpSwap's biggest pools read from their own transactions: who opened each, SOL in and out, and how many trades only passed a bag around.",
    proof: [commit("5a9a114"), commit("d0a2482")],
    zh: { title: "真实成交量", text: "直接从交易里读 PumpSwap 最大的池子：谁开的池，进出多少 SOL，有多少笔交易只是左手倒右手。" },
  },
  {
    id: "final",
    date: "2026-11-19",
    title: "Best Consumer App on Solana",
    text: "Solana Hackathon 2026, run by Encode Club. The prize is a place in the accelerator, not cash.",
    proof: [],
    milestone: true,
    zh: { title: "Solana 最佳消费级应用", text: "Encode Club 主办的 Solana Hackathon 2026。奖励是加速器名额，不是现金。" },
  },
  {
    id: "rebuild",
    date: "2026-11-20",
    title: "One product",
    text: "The site rebuilt around the x-ray: a dashboard x-ray, a new home, and both contests graded against the odds model. Everything that was not the x-ray left.",
    why: "A month of building left a zoo of pages. Traders opened one of them.",
    proof: [commit("9c3f5ef"), commit("836d595"), commit("cc5175f")],
    zh: { title: "一个产品", text: "网站围绕透视重建：仪表盘式透视、新首页，两个竞赛都以赔率模型为准。不属于透视的都移除了。", why: "一个月的开发留下了一整园的页面，交易者只打开其中一个。" },
  },
  {
    id: "extension-07",
    date: "2026-11-20",
    title: "Extension 0.7",
    text: "Solana only, with the verdict and the odds where the score used to be.",
    proof: [commit("5ac6f4d")],
    zh: { title: "扩展 0.7", text: "只支持 Solana，用结论和赔率取代了原来的分数。" },
  },
  {
    id: "crowd",
    date: "2026-11-21",
    title: "A crowd changes the verdict",
    text: "With 30 or more buyers in, a dev selling, a dump record, late bundles and the dev's own snipers warn instead of deciding. What traps a holder still reads avoid.",
    why: "Almost every coin with a crowd read avoid, including the ones that ran. A label that never changes ranks nothing.",
    proof: [commit("d5596a9")],
    zh: { title: "人多了，结论就不同", text: "买家达到 30 个以上时，开发者卖出、砸盘记录、后期捆绑和开发者自己的狙击手只作提醒，不再直接定论。会困住持有者的问题仍然判为避开。", why: "几乎所有有人气的币都被判为避开，包括后来大涨的。一个永远不变的标签排不出任何先后。" },
  },
  {
    id: "dev-record",
    date: "2026-11-21",
    title: "A dev's record with its dates",
    text: "A long record says since which day it is counted, and a coin that graduated in its first second is no longer read as launch spam.",
    proof: [commit("17a3678")],
    zh: { title: "带日期的开发者记录", text: "较长的记录会写明从哪一天算起；第一秒就毕业的币不再被当成刷发射。" },
  },
];

export const SHIPPED: Shipped[] = [...OLD_SHIPPED, ...NEW_SHIPPED].sort((a, b) => a.date.localeCompare(b.date));

/** Built, live, then removed on purpose. Newest first. */
export const CUT: Buried[] = [
  {
    id: "nursery",
    date: "2026-11-20",
    title: "The nursery",
    text: "Eight judges that sat the same exam every night, bred and died, with holders voting the next gene.",
    reason: "It was the zoo, not the product. The odds model does the judging now, and both contests are graded against it.",
    zh: { title: "育婴室", text: "八个评审每晚参加同一场考试，优胜者繁殖、垫底者淘汰，持有者投票决定下一个基因。", reason: "那是动物园，不是产品。现在由赔率模型来评判，两个竞赛也都以它为准。" },
  },
  {
    id: "ask",
    date: "2026-11-20",
    title: "Ask the beaver",
    text: "A chat that answered questions about a coin.",
    reason: "The x-ray answers the same question with the transactions. Nothing we kept calls a language model.",
    zh: { title: "问海狸", text: "一个回答代币问题的聊天窗口。", reason: "透视用交易本身回答同样的问题。保留下来的功能都不调用语言模型。" },
  },
  {
    id: "brief",
    date: "2026-11-20",
    title: "Morning Brief",
    text: "A daily issue written and published with no human in the loop.",
    reason: "A newsletter is a different product. We kept the one people open.",
    zh: { title: "晨报", text: "每天自动撰写并发布的一期简报，全程无人参与。", reason: "简报是另一个产品。我们留下了大家真正会打开的那个。" },
  },
  {
    id: "chains",
    date: "2026-11-20",
    title: "BNB Chain and Base",
    text: "four.meme, Flap and Clanker launches, read the same way as Solana.",
    reason: "One chain read fully is worth more than three read partly.",
    zh: { title: "BNB Chain 和 Base", text: "four.meme、Flap 和 Clanker 的发射，读法与 Solana 相同。", reason: "把一条链读透，胜过三条链各读一半。" },
  },
  {
    id: "pages",
    date: "2026-11-20",
    title: "Live, rugs and cabals pages",
    text: "Separate pages for the stream, the worst devs and the wallet groups.",
    reason: "The data stays, inside the x-ray and the API. The pages went.",
    zh: { title: "直播、跑路墙和团伙页面", text: "分别展示数据流、最差开发者和钱包团伙的独立页面。", reason: "数据还在，在透视和 API 里。页面移除了。" },
  },
  {
    id: "mini-app",
    date: "2026-11-20",
    title: "Telegram mini app",
    text: "The site inside Telegram.",
    reason: "The bot does the same in the chat you are already in.",
    zh: { title: "Telegram 小程序", text: "放进 Telegram 里的网站。", reason: "机器人在你已经打开的聊天里就能做同样的事。" },
  },
  {
    id: "score",
    date: "2026-10-28",
    title: "A score from 0 to 100",
    text: "One number for how safe a coin looks.",
    reason: "Our own record showed avoid and pass dying at almost the same rate, so a label ranked nothing. Odds from the first five minutes replaced it.",
    zh: { title: "0 到 100 的分数", text: "用一个数字表示代币看起来有多安全。", reason: "我们自己的记录显示，避开和通过的币死亡率几乎一样，标签排不出先后。前五分钟算出的赔率取代了它。" },
  },
  ...OLD_BURIED,
].sort((a, b) => b.date.localeCompare(a.date));

/** On the 14 Nov plan, not on this one. */
export const PARKED: Array<{ en: string; zh: string }> = [
  { en: "Holders' vote on what gets built", zh: "持有者投票决定开发顺序" },
  { en: "Morning Brief on X and Telegram", zh: "晨报同步到 X 和 Telegram" },
  { en: "Agent passports", zh: "代理护照" },
  { en: "Our verdicts against outside rug labels", zh: "用外部跑路标签检验我们的结论" },
  { en: "Our numbers, quarter one", zh: "第一季度数据报告" },
];

/** Runner radar's silent trial: the model was frozen at this moment and is graded a week later. */
export const TRIAL = { from: Date.UTC(2026, 10, 21, 13, 37), days: 7 };

export const NEXT: Planned[] = [
  {
    id: "accelerator",
    when: "7 Dec",
    whenZh: "12 月 7 日",
    title: "Accelerator",
    text: "The Encode Club x Solana accelerator starts. The hackathon prize was the place in it.",
    zh: { title: "加速器", text: "Encode Club x Solana 加速器开营。黑客松的奖励就是这个名额。" },
  },
  {
    id: "pro",
    when: "soon",
    whenZh: "即将",
    title: "Pro",
    text: "The verdict and its main reasons stay free. Pro opens the deep x-ray: the funding trace, one hand in many wallets, where the SOL went, and alerts. No price here until it is live.",
    zh: { title: "Pro", text: "结论和主要理由继续免费。Pro 打开深度透视：资金追踪、多钱包同一只手、SOL 的去向，以及提醒。上线之前这里不写价格。" },
  },
  {
    id: "keys",
    title: "API keys and limits",
    text: "Keys and fair limits on the deep x-ray for builders.",
    zh: { title: "API 密钥与限额", text: "面向开发者的深度透视密钥和合理限额。" },
  },
  {
    id: "average",
    title: "The verdict against the average launch",
    text: "Every reason shown next to what an ordinary launch looks like, so caution says how far from normal.",
    zh: { title: "把结论放到普通发射旁边", text: "每条理由都对照普通发射的样子，让提醒说清楚偏离正常有多远。" },
  },
  {
    id: "record",
    title: "The public record, recounted",
    text: "Our hit rate counted again from the verdicts as they were given, after the 21 Nov change.",
    zh: { title: "公开战绩重新统计", text: "在 11 月 21 日的调整之后，按当时给出的结论重新统计命中率。" },
  },
];

export const EXPLORING: Planned[] = [
  {
    id: "x-bot",
    title: "A reply on X",
    text: "Tag us under a coin and the answer is our verdict.",
    zh: { title: "X 上的回复", text: "在代币帖子下 @ 我们，回复就是我们的结论。" },
  },
  {
    id: "callers-in",
    title: "Known callers in the coin",
    text: "Which of the callers we track already holds it.",
    zh: { title: "币里的知名喊单人", text: "我们追踪的喊单人里，谁已经持有它。" },
  },
];

/** The orbit: seven stops from the first commit to what is next. */
export type StopStatus = "shipped" | "now" | "next";
export interface Stop {
  id: string;
  status: StopStatus;
  date: string;
  dateZh: string;
  title: string;
  titleZh: string;
  text: string;
  textZh: string;
  /** Where on the page the stop continues. */
  href: string;
  related: string[];
}
export const STOPS: Stop[] = [
  {
    id: "built",
    status: "shipped",
    date: "Oct 2026",
    dateZh: "2026 年 10 月",
    title: "Built",
    titleZh: "建成",
    text: "From the first commit on 6 October to an x-ray traders use: the chain read directly, bundles, the extension, the bot, the odds.",
    textZh: "从 10 月 6 日的第一个提交到交易者在用的透视：直接读链、捆绑检测、扩展、机器人、赔率。",
    href: "#shipped",
    related: ["own"],
  },
  {
    id: "own",
    status: "shipped",
    date: "Nov 2026",
    dateZh: "2026 年 11 月",
    title: "Own ground",
    titleZh: "自己的地盘",
    text: "Our own servers, x402 for agents, tool prints, one hand in many wallets, Caller Truth and real volume.",
    textZh: "自己的服务器、面向代理的 x402、工具指纹、多钱包同一只手、喊单真相和真实成交量。",
    href: "#shipped",
    related: ["built", "final"],
  },
  {
    id: "final",
    status: "shipped",
    date: "19 Nov",
    dateZh: "11 月 19 日",
    title: "The final",
    titleZh: "决赛",
    text: "Best Consumer App on Solana at Solana Hackathon 2026. The prize is a place in the accelerator.",
    textZh: "Solana Hackathon 2026 的 Solana 最佳消费级应用。奖励是加速器名额。",
    href: "#shipped",
    related: ["own", "accelerator"],
  },
  {
    id: "cut",
    status: "shipped",
    date: "20 Nov",
    dateZh: "11 月 20 日",
    title: "The cut",
    titleZh: "大删减",
    text: "The day after the final, everything that was not the x-ray left: the nursery, the brief, the chat, two chains and the pages around them.",
    textZh: "决赛后的第二天，所有不属于透视的东西都移除了：育婴室、晨报、聊天、两条链，以及围绕它们的页面。",
    href: "#cut",
    related: ["final", "runner"],
  },
  {
    id: "runner",
    status: "now",
    date: "21 - 28 Nov",
    dateZh: "11 月 21 - 28 日",
    title: "Runner radar",
    titleZh: "黑马雷达",
    text: "The other question, asked of the same chain data: what does a runner look like in its first five minutes. A silent trial on live coins.",
    textZh: "用同样的链上数据问另一个问题：黑马在最初五分钟是什么样子。正在真实代币上静默试运行。",
    href: "#now",
    related: ["cut", "pro"],
  },
  {
    id: "accelerator",
    status: "next",
    date: "7 Dec",
    dateZh: "12 月 7 日",
    title: "Accelerator",
    titleZh: "加速器",
    text: "The Encode Club x Solana accelerator starts.",
    textZh: "Encode Club x Solana 加速器开营。",
    href: "#next",
    related: ["final", "pro"],
  },
  {
    id: "pro",
    status: "next",
    date: "soon",
    dateZh: "即将",
    title: "Pro",
    titleZh: "Pro",
    text: "The deep x-ray for those who want all of it. The verdict stays free.",
    textZh: "给想看全部的人的深度透视。结论继续免费。",
    href: "#next",
    related: ["runner", "accelerator"],
  },
];

/** Shipped builds per week, running total: what the chart draws. */
export function shippedByWeek(): Array<{ week: string; total: number }> {
  const day = 86_400_000;
  const start = Date.UTC(2026, 9, 5); // the Monday of the first commit's week
  const end = Date.parse(UPDATED);
  const out: Array<{ week: string; total: number }> = [];
  for (let w = start; w <= end; w += 7 * day) {
    const upTo = new Date(w + 7 * day).toISOString().slice(0, 10);
    out.push({ week: new Date(w).toISOString().slice(0, 10), total: SHIPPED.filter((s) => !s.milestone && s.date < upTo).length });
  }
  return out;
}
