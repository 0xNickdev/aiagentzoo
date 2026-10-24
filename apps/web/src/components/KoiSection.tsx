import { useEffect, useState } from "react";
import { nodeOf } from "../zoo";
import { Reveal, Section, SectionHead } from "./ui";
import { lang, pick } from "../i18n";

interface Pick {
  mint: string;
  symbol: string;
  why: string;
  whyZh?: string;
  at: number;
}
interface KoiView {
  night: string;
  tonight: Pick[];
  tally: { picks: number; graded: number; alive: number; dead: number; nights: number };
  nights: Array<{ night: string; picks: Pick[]; score: { alive: number; dead: number; unknown: number; cases: Array<{ mint: string; outcome: string }> } | null }>;
  perNight: number;
  lastLook?: { at: number; candidates: number } | null;
}

/** About 1 in 270 pump.fun tokens is alive a day later: the bar the koi's picks are measured against. */
const MARKET_RATE = 0.0037;

/** 锦鲤, the koi: the zoo's hunter of survivors, its picks and how they turned out. */
export default function KoiSection() {
  const [data, setData] = useState<KoiView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void nodeOf("koi").then((n) =>
      n
        ? fetch(`${n.url}/v1/koi`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => (d ? setData(d) : setFailed(true)))
            .catch(() => setFailed(true))
        : setFailed(true),
    );
  }, []);
  if (failed && !data) return null;

  const t = data?.tally;
  const rate = t && t.graded ? t.alive / t.graded : null;
  const why = (p: Pick) => (lang() === "zh" && p.whyZh ? p.whyZh : p.why);
  const graded = (data?.nights ?? []).flatMap((n) => (n.score ? n.picks.map((p) => ({ ...p, night: n.night, outcome: n.score!.cases.find((c) => c.mint === p.mint)?.outcome ?? "unknown" })) : []));

  return (
    <Section id="koi">
      <SectionHead
        eyebrow={pick("锦鲤 · the koi · hunter of survivors", "锦鲤 · 幸存者猎手")}
        title={[pick("The beaver finds what dies.", "海狸找出会死的币。"), pick("The koi looks for what lives.", "锦鲤寻找能活下来的。")]}
        text={pick(
          "About 1 in 270 pump.fun tokens is still alive a day later. A few times a night the koi picks, from launches that already passed the chain checks, the ones it thinks will be among them. The next night every pick is graded, in public.",
          "在 pump.fun 上，大约 270 个币里只有 1 个能活过一天。锦鲤每晚从已经通过链上检查的新币里挑出几个它认为能活下来的。第二晚，每一次挑选都公开打分。",
        )}
      />
      <Reveal className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="liquid-glass rounded-3xl p-6">
          <div className="flex items-center gap-4">
            <img src="/agents/koi.webp" alt="" className="h-16 w-16 rounded-full" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            <div>
              <p className="font-mono text-[12px] text-fg-3">{pick("picks alive a day later", "一天后还活着的挑选")}</p>
              <p className="font-display mt-1 text-6xl">{rate === null ? "-" : `${Math.round(rate * 100)}%`}</p>
            </div>
          </div>
          <p className="mt-3 text-[13px] font-light text-fg-4">
            {t && t.graded
              ? pick(`${t.alive} of ${t.graded} graded picks, against a market where ${(MARKET_RATE * 100).toFixed(2)}% survive.`, `${t.graded} 次已打分的挑选中 ${t.alive} 个活着；整个市场的存活率是 ${(MARKET_RATE * 100).toFixed(2)}%。`)
              : pick("No graded picks yet: the first ones are checked the night after the koi makes them.", "还没有打分的挑选：第一批会在挑出后的第二晚复查。")}
          </p>
          <p className="font-mono mt-8 text-[12px] text-fg-3">{pick(`tonight · ${data?.tonight.length ?? 0} of ${data?.perNight ?? 8}`, `今晚 · ${data?.tonight.length ?? 0}/${data?.perNight ?? 8}`)}</p>
          <ul className="mt-3 space-y-3">
            {(data?.tonight ?? []).map((p) => (
              <li key={p.mint} className="text-[12.5px]">
                <span className="font-display text-[15px]">${p.symbol}</span>
                <p className="mt-0.5 font-light text-fg-4">{why(p)}</p>
              </li>
            ))}
            {data && !data.tonight.length && <p className="text-[12.5px] text-fg-4">{pick("No picks yet tonight. Most nights the honest answer is \"none\".", "今晚还没有挑选。大多数夜里，诚实的答案是「一个都没有」。")}</p>}
            {data?.lastLook && (
              <p className="font-mono text-[12px] text-fg-4">
                {pick(
                  `last looked ${new Date(data.lastLook.at).toISOString().slice(11, 16)} UTC · ${data.lastLook.candidates} launches worth a look`,
                  `上次查看 ${new Date(data.lastLook.at).toISOString().slice(11, 16)} UTC · ${data.lastLook.candidates} 个值得一看的新币`,
                )}
              </p>
            )}
          </ul>
        </div>

        <div className="liquid-glass flex max-h-[26rem] flex-col rounded-3xl p-6">
          <p className="font-mono text-[12px] text-fg-3">{pick("past picks, graded", "过去的挑选，已打分")}</p>
          <ul className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {graded.map((p) => (
              <li key={p.night + p.mint} className="border-b border-dashed border-white/10 py-2.5 text-[12.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display truncate text-[15px]">${p.symbol}</span>
                  <span className={`font-mono shrink-0 text-[12.5px] ${p.outcome === "alive" ? "text-[#9df3b0]" : p.outcome === "dead" ? "text-[#ff8a7e]" : "text-fg-4"}`}>
                    {p.night.slice(5)} · {p.outcome === "alive" ? pick("alive", "活着") : p.outcome === "dead" ? pick("dead", "死了") : pick("not graded", "未打分")}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[13px] font-light text-fg-3">{why(p)}</p>
              </li>
            ))}
            {!graded.length && <p className="text-[12px] text-fg-4">{pick("Graded picks show up here after their first night.", "挑选在第一晚之后出现在这里。")}</p>}
          </ul>
          <p className="font-mono mt-3 text-[11.5px] text-fg-4">{pick("A pick is not advice. It is graded tomorrow, in public.", "挑选不是投资建议。明天公开打分。")}</p>
        </div>
      </Reveal>
    </Section>
  );
}
