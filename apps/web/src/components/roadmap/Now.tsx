import { type ReactNode, useEffect, useState } from "react";
import { BOT_URL, X_URL, ZOOAGENCY_CLAWPUMP_URL, ZOOAGENCY_DEXSCREENER_URL } from "../../links";
import { pick, t } from "../../i18n";
import { Corners } from "./Timeline";
import { TRIAL } from "./data";

const day = 86_400_000;

/** A link drawn as a small button; `primary` is the white one. Outside links open in a new tab. */
function Go({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  const ext = href.startsWith("http");
  return (
    <a
      href={href}
      target={ext ? "_blank" : undefined}
      rel={ext ? "noopener noreferrer" : undefined}
      className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[7px] px-3.5 text-[12.5px] font-medium ${primary ? "bg-white text-night hover:bg-lit-hover" : "border border-line-2 text-white hover:border-[#4a524e]"}`}
    >
      {children}
      <span className={primary ? "" : "text-faint"}>{ext ? "↗" : "→"}</span>
    </a>
  );
}

function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">
      <span>{children}</span>
      {right}
    </p>
  );
}

/* ---------- runner radar: what it is on the left, the five steps and where we are on the right ---------- */

type StepState = "done" | "running" | "waiting";

function TrialCard() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const d = Math.max(1, Math.floor((now - TRIAL.from) / day) + 1);
  const over = d > TRIAL.days;
  const steps: Array<{ state: StepState; when: string; title: string; note: string }> = [
    { state: "done", when: pick("done", "完成"), title: t("Run back on 79,000 past launches"), note: t("Only what a coin did after its fifth minute counts, so the model cannot be graded on what it already saw.") },
    { state: "done", when: pick("21 Nov", "11 月 21 日"), title: t("The model is frozen"), note: t("Nothing in it changes during the trial. A model tuned while it is tested proves nothing.") },
    {
      state: over ? "done" : "running",
      when: over ? pick("done", "完成") : pick(`day ${d} of ${TRIAL.days}`, `第 ${d} 天 / 共 ${TRIAL.days} 天`),
      title: t("It reads live coins it has never seen"),
      note: t("Quietly: nothing shows on the site or in the bot yet."),
    },
    { state: over ? "running" : "waiting", when: pick("28 Nov", "11 月 28 日"), title: t("Graded against what the coins did"), note: t("How many of its picks ran, next to how many coins run on an ordinary day.") },
    { state: "waiting", when: pick("after", "之后"), title: t("It ships, if the numbers hold"), note: t("If they do not hold, it does not ship.") },
  ];
  return (
    <div className="rm-frame rm-wide">
      <Corners />
      <div className="rm-box grid gap-x-12 gap-y-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col">
          <Label
            right={
              <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-white px-1.5 leading-[16px] text-night">
                <span className="h-[5px] w-[5px] rounded-full bg-night" />
                {t("Running")}
              </span>
            }
          >
            {t("Silent trial")}
          </Label>
          <h3 className="mt-4 text-[clamp(24px,2.6vw,32px)] font-semibold leading-[1.05] tracking-[-0.04em] text-white">{t("Runner radar")}</h3>
          <p className="mt-4 max-w-[48ch] text-[14.5px] leading-[1.6] text-fg-2">
            {t("For months we said which coins to stay away from. That is half the job. Runner radar asks the same chain data the other question: what does a runner look like in its first five minutes, before the chart shows it.")}
          </p>
          <dl className="mt-6 grid grid-cols-3 border-y border-line">
            {[
              ["79,000", t("launches in the backtest")],
              [pick("5 min", "5 分钟"), t("of a coin's life is all it reads")],
              [pick("28 Nov", "11 月 28 日"), t("the day it is graded")],
            ].map(([v, k], i) => (
              <div key={k} className={`py-4 ${i ? "border-l border-line pl-4" : "pr-3"}`}>
                <dt className="text-[20px] font-semibold leading-none tracking-[-0.03em] text-white sm:text-[24px]">{v}</dt>
                <dd className="mt-2 text-[12px] leading-[1.4] text-dim">{k}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-2 lg:mt-auto lg:pt-6">
            <Go href="/xray" primary>
              {t("Open the x-ray")}
            </Go>
            <Go href={X_URL}>{t("Follow the trial on X")}</Go>
          </div>
        </div>

        <ol className="min-w-0">
          {steps.map((s, i) => (
            <li key={s.title} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0">
              {i < steps.length - 1 && <span className={`absolute bottom-0 left-[13.5px] top-[28px] w-px ${s.state === "done" ? "bg-white" : "border-l border-dashed border-[#4a524e]"}`} />}
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-[11px] ${
                  s.state === "done" ? "bg-white text-night" : s.state === "running" ? "border-[1.5px] border-white text-white" : "border border-dashed border-[#4a524e] text-faint"
                }`}
              >
                {s.state === "done" ? "✓" : i + 1}
              </span>
              <div className="min-w-0 pt-[3px]">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className={`text-[15px] font-medium tracking-[-0.01em] ${s.state === "waiting" ? "text-fg-3" : "text-white"}`}>{s.title}</span>
                  <span className={`font-mono text-[10.5px] uppercase tracking-[0.08em] ${s.state === "running" ? "text-white" : "text-faint"}`}>{s.when}</span>
                </p>
                <p className="mt-1 text-[13px] leading-[1.55] text-fg-4">{s.note}</p>
                {i === 2 && (
                  <div className="mt-3" role="img" aria-label={pick(`Day ${Math.min(d, TRIAL.days)} of ${TRIAL.days}`, `第 ${Math.min(d, TRIAL.days)} 天，共 ${TRIAL.days} 天`)}>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: TRIAL.days }, (_, j) => (
                        <span key={j} className={`h-[6px] rounded-[1px] ${j + 1 < d || over ? "bg-white" : j + 1 === d ? "rm-pulse bg-white" : "bg-line-2"}`} />
                      ))}
                    </div>
                    <div className="mt-1.5 grid grid-cols-7 gap-1 font-mono text-[9.5px] text-faint">
                      {Array.from({ length: TRIAL.days }, (_, j) => (
                        <span key={j} className={j + 1 === d && !over ? "text-white" : ""}>
                          {new Date(TRIAL.from + j * day).getUTCDate()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ---------- two plain lists with a way to act on each ---------- */

function Rows({ rows, lit }: { rows: Array<{ en: string; zh: string }>; lit: boolean }) {
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.en} className="flex gap-2.5 border-b border-line py-2.5 text-[13.5px] leading-[1.45] text-fg-2">
          <span className={`mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full ${lit ? "bg-white" : "border border-[#7d8681]"}`} />
          {pick(r.en, r.zh)}
        </li>
      ))}
    </ul>
  );
}

const FREE = [
  { en: "The verdict and its main reasons", zh: "结论和主要理由" },
  { en: "The odds it runs, as of minute 5", zh: "第 5 分钟时的上涨概率" },
  { en: "The dev's other launches", zh: "开发者的其他发射" },
  { en: "Who bought in the first seconds", zh: "最初几秒是谁买的" },
];
const PRO = [
  { en: "Who funded the buyers, four hops back", zh: "谁给买家打的钱，向上追四层" },
  { en: "Where the SOL went", zh: "SOL 的去向" },
  { en: "Every early wallet's history", zh: "每个早期钱包的历史" },
  { en: "All the callers and FOMO theses", zh: "全部喊单人和 FOMO 论点" },
  { en: "A Telegram ping the second the dev starts selling", zh: "开发者一开始卖出，Telegram 立刻提醒" },
];

function ProCard() {
  return (
    <div className="rm-frame">
      <Corners />
      <div className="rm-box flex flex-col p-5 sm:p-7">
        <Label right={<span className="text-white">{t("Soon")}</span>}>{t("Next up")}</Label>
        <h3 className="mt-4 text-[24px] font-semibold leading-[1.05] tracking-[-0.04em] text-white">{t("Pro, the deep x-ray")}</h3>
        <p className="mt-3 text-[14px] leading-[1.6] text-fg-2">{t("The x-ray stays free. Pro opens everything behind it. No price here until it is live.")}</p>
        <div className="mt-6 grid gap-x-7 gap-y-6 sm:grid-cols-2">
          <div>
            <p className="border-b border-line pb-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-white">{t("Free, and stays free")}</p>
            <Rows rows={FREE} lit />
          </div>
          <div>
            <p className="border-b border-line pb-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-white">{t("Pro opens")}</p>
            <Rows rows={PRO} lit={false} />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2 lg:mt-auto lg:pt-6">
          <Go href="/xray" primary>
            {t("Try the free x-ray")}
          </Go>
          <Go href={BOT_URL}>{t("Telegram bot")}</Go>
        </div>
      </div>
    </div>
  );
}

const TOKEN_NOW = [
  { en: "Creator fees go to buybacks", zh: "创作者费用用于回购" },
  { en: "Holders of 500k play the weekly contest", zh: "持有 50 万枚可参加每周竞赛" },
  { en: "Holders of 500k get bot alerts 10 minutes early", zh: "持有 50 万枚可提前 10 分钟收到机器人提醒" },
];
const TOKEN_PRO = [
  { en: "Pay for Pro in USDC, or in $ZOOAGENCY at 25% off", zh: "Pro 可用 USDC 支付，或用 $ZOOAGENCY 支付并减 25%" },
  { en: "Every $ZOOAGENCY paid is burned", zh: "支付的每一枚 $ZOOAGENCY 都会销毁" },
  { en: "A cut of the USDC goes to buyback and burn, and the cut grows with revenue", zh: "一部分 USDC 用于回购销毁，比例随收入增长" },
];

function TokenCard() {
  return (
    <div className="rm-frame">
      <Corners />
      <div className="rm-box flex flex-col p-5 sm:p-7">
        <Label>{t("The token")}</Label>
        <h3 className="mt-4 text-[24px] font-semibold leading-[1.05] tracking-[-0.04em] text-white">{t("What $ZOOAGENCY does")}</h3>
        <p className="mt-3 text-[14px] leading-[1.6] text-fg-2">{t("What holding it gets you today, and how Pro revenue comes back to it once Pro is open.")}</p>
        <div className="mt-6 grid gap-x-7 gap-y-6 sm:grid-cols-2">
          <div>
            <p className="border-b border-line pb-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-white">{t("Today")}</p>
            <Rows rows={TOKEN_NOW} lit />
          </div>
          <div>
            <p className="border-b border-line pb-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-white">{t("When Pro opens")}</p>
            <Rows rows={TOKEN_PRO} lit={false} />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2 lg:mt-auto lg:pt-6">
          <Go href={ZOOAGENCY_CLAWPUMP_URL} primary>
            {t("Buy on ClawPump")}
          </Go>
          <Go href="/token">{t("The token page")}</Go>
          <Go href={ZOOAGENCY_DEXSCREENER_URL}>DexScreener</Go>
        </div>
      </div>
    </div>
  );
}

export default function Now() {
  return (
    <div className="rm-bento">
      <TrialCard />
      <ProCard />
      <TokenCard />
    </div>
  );
}
