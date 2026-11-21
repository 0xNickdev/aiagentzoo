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
    text: "Final 8 at Solana Hackathon 2026, run by Encode Club, and the Best Consumer App award. The prize is a place in the accelerator, not cash.",
    proof: [],
    milestone: true,
    zh: { title: "Solana 最佳消费级应用", text: "进入 Encode Club 主办的 Solana Hackathon 2026 八强，并获最佳消费级应用奖。奖励是加速器名额，不是现金。" },
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
    text: "The x-ray stays free. Pro opens who funded the buyers four hops back, where the SOL went, every early wallet's history, all the callers and a Telegram ping the second the dev starts selling. Pay in USDC, or in $ZOOAGENCY at 25% off, and every $ZOOAGENCY paid is burned.",
    zh: { title: "Pro", text: "透视继续免费。Pro 打开：谁给买家打的钱（向上四层）、SOL 的去向、每个早期钱包的历史、全部喊单人，以及开发者一卖出就发的 Telegram 提醒。可用 USDC 支付，或用 $ZOOAGENCY 支付并减 25%，支付的代币全部销毁。" },
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

/** The line at the top of the page: seven stops from the first commit to what is next. */
export type StopStatus = "shipped" | "now" | "next";
export interface Stop {
  id: string;
  status: StopStatus;
  date: string;
  dateZh: string;
  title: string;
  titleZh: string;
  /** One measured fact under the title. */
  count?: string;
  countZh?: string;
  points: Array<{ en: string; zh: string }>;
  /** Where on the page the stop continues. */
  href: string;
}
const between = (from: string, to: string) => SHIPPED.filter((s) => !s.milestone && s.date >= from && s.date <= to).length;
const oct = between("2026-10-01", "2026-10-31");
const nov = between("2026-11-01", "2026-11-14");
const cutDay = CUT.filter((c) => c.date === "2026-11-20").length;
export const STOPS: Stop[] = [
  {
    id: "built",
    status: "shipped",
    date: "6 - 31 Oct",
    dateZh: "10 月 6 - 31 日",
    title: "Built",
    titleZh: "建成",
    count: `${oct} builds`,
    countZh: `${oct} 项发布`,
    points: [
      { en: "Solana read straight from the chain", zh: "直接从链上读 Solana" },
      { en: "X-Ray, bundles, the odds", zh: "透视、捆绑检测、赔率" },
      { en: "Extension and Telegram bot", zh: "扩展和 Telegram 机器人" },
    ],
    href: "#shipped",
  },
  {
    id: "own",
    status: "shipped",
    date: "1 - 14 Nov",
    dateZh: "11 月 1 - 14 日",
    title: "Own ground",
    titleZh: "自己的地盘",
    count: `${nov} builds`,
    countZh: `${nov} 项发布`,
    points: [
      { en: "x402: agents pay per check", zh: "x402：代理按次付费" },
      { en: "One hand in many wallets", zh: "多钱包同一只手" },
      { en: "Caller Truth", zh: "喊单真相" },
    ],
    href: "#shipped",
  },
  {
    id: "final",
    status: "shipped",
    date: "19 Nov",
    dateZh: "11 月 19 日",
    title: "The final",
    titleZh: "决赛",
    count: "Solana Hackathon 2026",
    points: [
      { en: "Final 8 of the hackathon", zh: "进入黑客松八强" },
      { en: "Best Consumer App on Solana", zh: "Solana 最佳消费级应用" },
      { en: "The prize: a place in the accelerator", zh: "奖励：加速器名额" },
    ],
    href: "#shipped",
  },
  {
    id: "cut",
    status: "shipped",
    date: "20 Nov",
    dateZh: "11 月 20 日",
    title: "The cut",
    titleZh: "大删减",
    count: `${cutDay} things removed`,
    countZh: `移除 ${cutDay} 项`,
    points: [
      { en: "The site rebuilt around the x-ray", zh: "网站围绕透视重建" },
      { en: "Solana only", zh: "只做 Solana" },
      { en: "Contests graded by the odds model", zh: "竞赛以赔率模型评分" },
    ],
    href: "#cut",
  },
  {
    id: "runner",
    status: "now",
    date: "21 - 28 Nov",
    dateZh: "11 月 21 - 28 日",
    title: "Runner radar",
    titleZh: "黑马雷达",
    count: "silent trial",
    countZh: "静默试运行",
    points: [
      { en: "Model frozen 21 Nov", zh: "模型于 11 月 21 日冻结" },
      { en: "Reads live coins it never saw", zh: "读从未见过的真实代币" },
      { en: "Graded 28 Nov", zh: "11 月 28 日评分" },
    ],
    href: "#now",
  },
  {
    id: "accelerator",
    status: "next",
    date: "7 Dec",
    dateZh: "12 月 7 日",
    title: "Accelerator",
    titleZh: "加速器",
    count: "Encode Club x Solana",
    points: [{ en: "The program starts", zh: "项目开营" }],
    href: "#next",
  },
  {
    id: "pro",
    status: "next",
    date: "soon",
    dateZh: "即将",
    title: "Pro",
    titleZh: "Pro",
    count: "the deep x-ray",
    countZh: "深度透视",
    points: [
      { en: "The verdict stays free", zh: "结论继续免费" },
      { en: "No price until it is live", zh: "上线前不写价格" },
    ],
    href: "#next",
  },
];
