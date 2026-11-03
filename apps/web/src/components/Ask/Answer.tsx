import { motion } from "framer-motion";
import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { X_URL, XIcon } from "../../links";
import CopyCa from "../CopyCa";
import { pick, t } from "../../i18n";
import { launchOutcome } from "../../outcome";
import type { Ask, Council, CreatorRecord, Verdict } from "./types";
import { evidence, graded, TONE, whyOf } from "./shared";
import { drawCard } from "./shareCard";

export function Answer({ a }: { a: Ask }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [png, setPng] = useState<string | null>(null);
  const tone = TONE[a.verdict];

  useEffect(() => {
    if (!canvas.current) return;
    setPng(null);
    void drawCard(canvas.current, a).then(() => setPng(canvas.current!.toDataURL("image/png")));
  }, [a]);

  const link = `zooaiagency.com/ask#${a.id}`;
  const tweet = encodeURIComponent(
    pick(
      [`asked the beaver about $${a.symbol}: ${tone.label.toLowerCase()}.`, a.why, "", `graded against reality tomorrow: ${link}`],
      [`问了海狸 $${a.symbol}：${t(tone.label)}。`, whyOf(a), "", `明天由市场打分：${link}`],
    ).join("\n"),
  );

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-5 pb-6 sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 bg-night-surface border border-white/[0.08] rounded-2xl p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="tabular-nums flex flex-wrap items-center gap-2 text-[12.5px] text-fg-4">
                <span className="min-w-0 truncate">
                  {a.name ? `${a.name} · ` : ""}
                  {a.mint}
                </span>
                <CopyCa mint={a.mint} />
              </p>
              <h2 className="font-display mt-1 text-4xl">${a.symbol}</h2>
            </div>
            {a.facts.url && (
              <a href={a.facts.url} target="_blank" rel="noopener noreferrer" className="tabular-nums text-[12.5px] text-fg-3 underline decoration-white/20 underline-offset-4 hover:text-white">
                {t("chart ↗")}
              </a>
            )}
          </div>

          <p className="font-display mt-6 text-6xl leading-none sm:text-7xl" style={{ color: tone.color }}>
            {t(tone.label)}
          </p>
          <p className="tabular-nums mt-3 text-[12.5px] text-fg-3">
            {t("confidence {c}% · playbook v{v}", { c: Math.round(a.confidence * 100), v: a.playbookVersion })}
            {a.by === "rules" ? t(" · rules only, the model was busy") : ""}
          </p>
          <p className="mt-5 max-w-2xl text-[17px] font-normal leading-relaxed text-fg-2">{whyOf(a)}</p>

          <dl className="tabular-nums mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] text-[12px] sm:grid-cols-3">
            {evidence(a).map(([k, v, bad]) => (
              <div key={k} className="bg-[#070908] px-4 py-3">
                <dt className="text-fg-4">{t(k)}</dt>
                <dd className={`mt-1 text-[15px] ${bad ? "text-[#ff8a7e]" : "text-fg-2"}`}>{v}</dd>
              </div>
            ))}
          </dl>
          {a.facts.creator && (
            <div className="mt-6 rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/[0.06]">
              <CreatorBlock r={a.facts.creator} />
            </div>
          )}
          {a.council && <CouncilBlock c={a.council} outcome={a.graded?.outcome ?? null} />}
          {!a.facts.chain && (
            <p className="mt-3 text-[12px] font-normal text-fg-4">{t("No chain facts: this token launched before our pump.fun stream picked it up, so the beaver judged from the market alone.")}</p>
          )}

          <p className={`tabular-nums mt-6 text-[12px] ${a.graded?.hit === true ? "text-[#a6e3b4]" : a.graded?.hit === false ? "text-[#ff8a7e]" : "text-warn"}`}>
            {a.graded ? "● " : "○ "}
            {graded(a)}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <canvas ref={canvas} className="hidden" />
          <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
            {png ? <img src={png} alt={t("Card: the beaver on ${s}", { s: a.symbol })} className="h-full w-full" /> : <div className="h-full w-full animate-pulse bg-white/[0.03]" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={png ?? undefined}
              download={`beaver-${a.symbol}-${a.id}.png`}
              className={`inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-medium text-black ${png ? "hover:bg-white/90" : "pointer-events-none opacity-50"}`}
            >
              <Download size={14} /> {t("Download card")}
            </a>
            <a
              href={`https://x.com/intent/post?text=${tweet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-night-surface border border-white/[0.08] inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] text-fg hover:text-white"
              title={`Follow ${X_URL.replace("https://x.com/", "@")}`}
            >
              <XIcon size={13} /> {t("Post on X")}
            </a>
          </div>
          <p className="tabular-nums text-[12.5px] text-fg-4">
            {t("share:")} <span className="text-fg-3">{link}</span>
          </p>
          <p className="text-[13px] font-normal text-fg-4">{t("Not financial advice. A verdict from public data, checked in public a day later.")}</p>
        </div>
      </div>
    </motion.section>
  );
}

/** The nursery's judges on the same token, heaviest record first; once graded, each vote shows if it was right. */
export function CouncilBlock({ c, outcome }: { c: Council; outcome: "dead" | "alive" | "unknown" | null }) {
  const tone = TONE[c.verdict];
  const max = Math.max(...c.votes.map((v) => v.weight), 0);
  const right = (v: Verdict) => (outcome === "dead" ? v === "suspicious" : outcome === "alive" ? v === "promising" : null);
  return (
    <div className="mt-6 rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/[0.06]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] text-fg">
          {t("The nursery votes:")} <span className={tone.text}>{t(tone.label)}</span>
        </p>
        <a href="/evolution" className="tabular-nums text-[12px] text-fg-4 underline decoration-white/20 underline-offset-4 hover:text-white">
          {t("{n} judges, weighted by their record", { n: c.votes.length })}
        </a>
      </div>
      <ul className="mt-4 divide-y divide-white/[0.06]">
        {c.votes.map((v) => {
          const hit = right(v.verdict);
          return (
            <li key={v.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-2.5">
              <a href={`/evolution#${v.id}`} className="min-w-0 truncate text-[13.5px] text-fg-2 hover:text-white">
                {v.name}
              </a>
              <span className={`tabular-nums text-right text-[12.5px] ${TONE[v.verdict].text}`}>
                {hit === true ? "✓ " : hit === false ? "✗ " : ""}
                {t(TONE[v.verdict].label)}
              </span>
              <p className="min-w-0 text-[12.5px] font-normal leading-snug text-fg-4">{v.why}</p>
              <span className="tabular-nums self-start pt-0.5 text-right text-[11.5px] text-fg-4" title={t("Balanced accuracy above a coin flip; a judge no better than a coin flip weighs nothing")}>
                {max > 0 ? (v.weight > 0 ? t("weight {w}", { w: Math.round((v.weight / max) * 100) }) : t("no weight")) : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A creator wallet's last two days, the way a trader asks: does this dev rug, and how fast. */
export function CreatorBlock({ r, big = false }: { r: CreatorRecord; big?: boolean }) {
  const serial = r.launches48h >= 3 && r.dumped >= Math.ceil(r.launches48h / 2);
  return (
    <div>
      <p className="tabular-nums text-[12.5px] text-fg-4">
        {t("creator wallet · {w} · last 48h on pump.fun", { w: `${r.wallet.slice(0, 6)}…${r.wallet.slice(-6)}` })}
      </p>
      <p className={`font-display mt-2 ${big ? "text-4xl sm:text-5xl" : "text-2xl"} ${serial ? "text-[#ff8a7e]" : "text-white"}`}>
        {t(r.launches48h === 1 ? "{n} launch, dumped {d}" : "{n} launches, dumped {d}", { n: r.launches48h, d: r.dumped })}
        {r.medianDumpMin !== null ? t(", median {m} min", { m: r.medianDumpMin }) : ""}
      </p>
      <p className="tabular-nums mt-2 text-[12.5px] text-fg-3">
        {t("{a} in the last 24h · {g} graduated", { a: r.launches24h, g: r.graduated })}{serial ? t(" · a serial dumper") : ""}
      </p>
      {big && r.recent.length > 0 && (
        <ul className="tabular-nums mt-5 grid gap-1.5 text-[12px] sm:grid-cols-2">
          {r.recent.map((x) => (
            <li key={x.mint} className="flex justify-between gap-3 border-b border-dashed border-white/10 py-1.5">
              <span className="truncate text-fg-2">${x.symbol}</span>
              <span className={x.dumpedAfterMin !== null ? "text-[#ff8a7e]" : x.graduated ? "text-[#a6e3b4]" : "text-fg-3"}>
                {[launchOutcome(x).head, launchOutcome(x).tail].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
