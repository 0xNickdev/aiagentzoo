import { useEffect, useState } from "react";
import { nodeOf } from "../zoo";
import { Reveal, Section, SectionHead } from "./ui";
import { lang, t } from "../i18n";

interface Night {
  night: string;
  graded: number;
  skill: number | null;
  dead: number;
  deadRight: number;
  alive: number;
  aliveRight: number;
}
interface Call {
  night: string;
  mint: string;
  symbol: string;
  verdict: string;
  outcome: string;
  hit: boolean;
  why: string;
  whyZh?: string;
}

/** The beaver's track record, night by night: the honest argument for everything else. */
export default function BeaverRecord() {
  const [data, setData] = useState<{ nights: Night[]; warnedDead: number; calls: Call[] } | null>(null);
  useEffect(() => {
    void nodeOf("beaver").then((n) =>
      n
        ? fetch(`${n.url}/v1/beaver/record`)
            .then((r) => (r.ok ? r.json() : null))
            .then(setData)
            .catch(() => {})
        : null,
    );
  }, []);

  const nights = data?.nights ?? [];
  const right = data?.calls.filter((c) => c.hit).length ?? 0;
  const wrong = data?.calls.filter((c) => !c.hit).length ?? 0;

  return (
    <Section id="record">
      <SectionHead
        eyebrow={t("The beaver's record · every call re-checked")}
        title={[t("Where it was right."), t("Where it was wrong.")]}
        text={t("Every night the beaver judges fresh tokens; the next day reality grades each call. Nothing is removed, the misses stay next to the hits.")}
      />
      <Reveal className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="bg-night-surface border border-white/[0.08] min-w-0 rounded-2xl p-6">
          <p className="tabular-nums text-[12px] text-fg-3">{t("flagged, then went to zero")}</p>
          <p className="font-display mt-2 text-6xl">{data ? data.warnedDead.toLocaleString("en-US") : "-"}</p>
          <p className="mt-2 text-[13px] font-normal text-fg-4">{t("tokens the beaver called suspicious first, re-checked the next day at zero")}</p>

          <p className="tabular-nums mt-8 text-[12px] text-fg-3">{t("balanced accuracy, night by night")}</p>
          <div className="mt-3 flex h-28 items-end gap-1.5">
            {nights.map((n) => (
              <div key={n.night} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={t("{night}: {p} over {n}", { night: n.night, p: n.skill === null ? "-" : Math.round(n.skill * 100) + "%", n: n.graded })}>
                <div className="w-full rounded-t bg-amber-100/70" style={{ height: `${Math.max(4, (n.skill ?? 0) * 100)}%`, opacity: n.graded >= 10 ? 1 : 0.45 }} />
                <span className="tabular-nums mt-1.5 hidden text-[11px] text-fg-4 sm:block">{n.night.slice(5)}</span>
              </div>
            ))}
            {!nights.length && <p className="text-[12px] text-fg-4">{t("The first graded night appears after the next re-check.")}</p>}
          </div>
          <p className="tabular-nums mt-3 text-[11.5px] text-fg-4">{t("faint bars rest on fewer than 10 graded calls; 50% is a coin flip")}</p>
        </div>

        <div className="bg-night-surface border border-white/[0.08] flex max-h-[26rem] flex-col rounded-2xl p-6">
          <div className="tabular-nums flex justify-between text-[12px] text-fg-3">
            <span>{t("latest graded calls")}</span>
            <span>
              <span className="text-[#a6e3b4]">{t("{n} right", { n: right })}</span> · <span className="text-[#ff8a7e]">{t("{n} wrong", { n: wrong })}</span>
            </span>
          </div>
          <ul className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {data?.calls.map((c) => (
              <li key={c.night + c.mint} className="border-b border-dashed border-white/10 py-2.5 text-[12.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <a
                    href={`https://dexscreener.com/solana/${c.mint}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t("check what it did on DexScreener")}
                    className="font-display truncate text-[15px] underline decoration-white/20 underline-offset-4 hover:decoration-white"
                  >
                    ${c.symbol} ↗
                  </a>
                  <span className={`tabular-nums shrink-0 text-[12.5px] ${c.hit ? "text-[#a6e3b4]" : "text-[#ff8a7e]"}`}>
                    {t(c.hit ? "right" : "wrong")} · {t("said {v}", { v: t(c.verdict) })}, {t(c.outcome === "dead" ? "it died" : "it lived")}
                  </span>
                </div>
                {c.why && <p className="mt-0.5 truncate text-[13px] font-normal text-fg-3">{lang() === "zh" && c.whyZh ? c.whyZh : c.why}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-relaxed text-fg-4">{t("We grade our own calls, so don't take our word for it: each one opens on DexScreener, where you can see what the token did.")}</p>
        </div>
      </Reveal>
    </Section>
  );
}
