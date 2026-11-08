import { useState } from "react";
import { shortAddress } from "../../zoo";
import { lang, t as tr, tChain } from "../../i18n";
import { DEXSCREENER_URL } from "../../links";
import { nightSkill } from "../../accuracy";
import type { Call, GuestReport, Obs, Sections, Week } from "./types";
import { clean, dex, money, pct, TABS } from "./shared";
import type { TabKey } from "./shared";

export function Change({ n }: { n: number | null | undefined }) {
  if (n === null || n === undefined) return <span className="text-fg-4">-</span>;
  return <span className={n >= 0 ? "text-moss" : "text-danger"}>{pct(n)}</span>;
}

export function Tables({ s }: { s: Sections }) {
  const [tab, setTab] = useState<TabKey>("topVolume");
  const rows = s[tab] ?? [];
  const reasons = tab === "suspicious";
  return (
    <div className="rounded-2xl bg-black/40 ring-1 ring-white/10 backdrop-blur-md">
      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.08] px-3 pt-3" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px shrink-0 border-b px-3 pb-3 pt-1 text-[13px] transition ${
              tab === t.key ? "border-white text-white" : "border-transparent text-fg-3 hover:text-fg-2"
            }`}
          >
            {tr(t.label)}
            <span className="tabular-nums ml-1.5 text-[13px] text-fg-4">{(s[t.key] ?? []).length}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-[13px] text-fg-4">{tr("Nothing in this section tonight.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="tabular-nums text-left text-[12.5px] text-fg-4">
                <th className="px-6 py-3 font-normal">{tr("Token")}</th>
                {reasons ? (
                  <th className="px-6 py-3 font-normal">{tr("Why it is flagged")}</th>
                ) : (
                  <>
                    <th className="px-3 py-3 text-right font-normal">{tr("Volume 24h")}</th>
                    <th className="px-3 py-3 text-right font-normal">{tr("Liquidity")}</th>
                    <th className="px-6 py-3 text-right font-normal">24H</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((o, i) => (
                <tr key={o.mint} className="border-t border-white/[0.08] transition hover:bg-white/[0.02]">
                  <td className="px-6 py-3">
                    <a href={dex(o)} target="_blank" rel="noopener noreferrer" className="group flex items-baseline gap-3" title={o.mint}>
                      <span className="tabular-nums w-5 text-[13px] text-fg-4">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-fg group-hover:text-white">{o.symbol}</span>
                      <span className="tabular-nums text-[13px] text-fg-4">{shortAddress(o.mint)}</span>
                    </a>
                  </td>
                  {reasons ? (
                    <td className="px-6 py-3 text-fg-4">{clean((o.reasons ?? []).map(tChain).join(" · "))}</td>
                  ) : (
                    <>
                      <td className="tabular-nums px-3 py-3 text-right text-fg-3">{money(o.market?.volume24hUsd)}</td>
                      <td className="tabular-nums px-3 py-3 text-right text-fg-3">{money(o.market?.liquidityUsd)}</td>
                      <td className="tabular-nums px-6 py-3 text-right">
                        <Change n={o.market?.priceChange24h} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export const VERDICT_TONE: Record<string, string> = {
  suspicious: "text-danger ring-rose-200/25",
  promising: "text-moss ring-emerald-200/25",
  watch: "text-fg-4 ring-white/15",
};

export function Calls({ calls }: { calls: Call[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? calls : calls.slice(0, 6);
  return (
    <div className="rounded-2xl bg-black/40 p-6 ring-1 ring-white/10 backdrop-blur-md">
      <p className="tabular-nums text-[13px] text-fg-4">{tr("The pack's calls")} · {calls.length}</p>
      {calls.length === 0 ? (
        <p className="mt-4 text-[13px] text-fg-4">{tr("No calls yet this night.")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.06]">
          {shown.map((c) => (
            <li key={c.mint} className="flex items-start gap-3 py-3">
              <span className={`tabular-nums mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[12.5px] ring-1 ${VERDICT_TONE[c.verdict] ?? VERDICT_TONE.watch}`}>{tr(c.verdict)}</span>
              <div className="min-w-0 flex-1">
                <a href={`${DEXSCREENER_URL}/solana/${c.mint}`} target="_blank" rel="noopener noreferrer" className="text-[13.5px] text-fg hover:text-white">
                  {c.symbol}
                </a>
                <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{clean(lang() === "zh" && c.whyZh ? c.whyZh : c.why)}</p>
              </div>
              <span className="tabular-nums shrink-0 text-[13px] text-fg-4">{Math.round(c.confidence * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
      {calls.length > 6 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="tabular-nums mt-2 text-[13px] text-fg-3 hover:text-white">
          {all ? tr("show fewer") : tr("show all {n}", { n: calls.length })}
        </button>
      )}
    </div>
  );
}

export function Learned({ learned }: { learned: Sections["learned"] }) {
  const [open, setOpen] = useState(false);
  const score = learned?.score;
  const scored = score ? score.hits + score.misses : 0;
  const skill = nightSkill(score);
  const oneSided = scored > 0 && skill === null && !!score?.cases;
  return (
    <div className="rounded-2xl bg-black/40 p-6 ring-1 ring-white/10 backdrop-blur-md">
      <p className="tabular-nums text-[13px] text-fg-4">{tr("What the pack learned")}</p>
      {scored > 0 && skill !== null ? (
        <>
          <p className="font-display mt-4 text-5xl">{Math.round(skill * 100)}%</p>
          <p className="mt-2 text-[13.5px] font-normal text-fg-4">
            {tr("balanced accuracy on yesterday's calls: half for calling the dead, half for calling the living. By the plain count, {h} right and {m} wrong.", { h: score!.hits, m: score!.misses })}
          </p>
        </>
      ) : scored > 0 ? (
        <>
          <p className="font-display mt-4 text-5xl text-fg-3">-</p>
          <p className="mt-2 text-[13.5px] font-normal text-fg-4">
            {oneSided
              ? tr("No token from these calls lived, so this night has no balanced score. By the plain count, {h} right and {m} wrong, which most fresh tokens dying makes easy.", { h: score!.hits, m: score!.misses })
              : tr("This night was scored before balanced accuracy. By the plain count, {h} right and {m} wrong, which most fresh tokens dying makes easy.", { h: score!.hits, m: score!.misses })}
          </p>
        </>
      ) : (
        <p className="mt-4 text-[13.5px] font-normal text-fg-4">{tr("Calls are re-checked the next night; the score lands here.")}</p>
      )}
      {learned && (
        <div className="mt-6 border-t border-white/[0.08] pt-4">
          <button type="button" onClick={() => setOpen((o) => !o)} className="tabular-nums flex w-full items-center justify-between text-[13px] text-fg-4 hover:text-white">
            <span>{tr("PLAYBOOK V{v} · REWRITTEN BY THE BEAVER", { v: learned.playbook.version })}</span>
            <span>{open ? "−" : "+"}</span>
          </button>
          {open && (
            <ol className="mt-4 space-y-2 text-[13px] font-normal leading-relaxed text-fg-4">
              {learned.playbook.text.split("\n").map((line) => (
                <li key={line}>{clean(line)}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/** The weekly contest as it stood that morning. */
export function WeekBoard({ week }: { week: Week }) {
  const need = (r: Week["rows"][number]) =>
    r.ranked ? null : r.graded < week.minGraded ? tr("{n} more graded", { n: week.minGraded - r.graded }) : r.alive < week.minSide ? tr("{n} more living", { n: week.minSide - r.alive }) : tr("{n} more dead", { n: week.minSide - r.dead });
  return (
    <div className="rounded-2xl bg-black/40 p-6 ring-1 ring-white/10 backdrop-blur-md">
      <p className="tabular-nums text-[13px] text-fg-4">
        {tr("Agent of the week so far")} · {week.start} → {week.end}
      </p>
      {!week.rows.length ? (
        <p className="mt-3 text-[13px] font-normal text-fg-4">
          {tr("No guest agent graded this week yet. The first one leads:")} <a href="/connect" className="underline decoration-white/30 underline-offset-4 hover:text-white">{tr("connect an agent")}</a>
        </p>
      ) : (
        <ol className="mt-3 divide-y divide-white/[0.06]">
          {week.rows.slice(0, 3).map((r, i) => (
            <li key={r.name} className="flex items-baseline justify-between gap-3 py-2.5">
              <a href={`/agents?guest=${encodeURIComponent(r.name)}`} className="min-w-0 truncate text-[14px] text-fg hover:text-white">
                <span className="tabular-nums mr-3 text-[13px] text-fg-4">{String(i + 1).padStart(2, "0")}</span>
                {r.name}
              </a>
              <span className="tabular-nums shrink-0 text-[13px] text-fg-4">
                {Math.round(r.score * 100)}% · {r.graded}
                {need(r) && <span className="ml-2 text-warn">{tr("{need} to qualify", { need: need(r)! })}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function GuestReports({ reports }: { reports: GuestReport[] }) {
  return (
    <div className="rounded-2xl bg-black/40 p-6 ring-1 ring-white/10 backdrop-blur-md">
      <p className="tabular-nums text-[13px] text-fg-4">{tr("From the guest enclosures")} · {reports.length}</p>
      <div className={`mt-3 grid gap-6 ${reports.length > 1 ? "md:grid-cols-2" : ""}`}>
        {reports.map((r) => (
          <div key={r.guest} className="min-w-0">
            <p className="text-[14px] text-fg">
              {r.guest} <span className="text-[13px] text-fg-4">· {r.platform === "clawpump" ? `${tr("ClawPump wing")} · ` : ""}{tr(r.species)}</span>
            </p>
            <ul className="mt-2 divide-y divide-white/[0.06]">
              {r.items.slice(0, 5).map((i) => (
                <li key={i.mint} className="flex items-start gap-3 py-2.5">
                  <span className={`tabular-nums mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[12.5px] ring-1 ${VERDICT_TONE[i.verdict] ?? VERDICT_TONE.watch}`}>{tr(i.verdict)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg-4" title={i.note}>
                    {clean(i.note) || shortAddress(i.mint)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Watched({ items }: { items: Obs[] }) {
  return (
    <div className="rounded-2xl bg-black/40 p-6 ring-1 ring-white/10 backdrop-blur-md">
      <p className="tabular-nums text-[13px] text-fg-4">{tr("Guardian watch")} · {items.length}</p>
      <ul className="mt-3 divide-y divide-white/[0.06]">
        {items.map((o) => (
          <li key={o.mint} className="flex items-baseline justify-between gap-3 py-2.5 text-[13px]">
            <a href={dex(o)} target="_blank" rel="noopener noreferrer" className="text-fg-2 hover:text-white">
              {o.symbol} <span className="tabular-nums text-[13px] text-fg-4">{shortAddress(o.mint)}</span>
            </a>
            <span className="tabular-nums text-[13px]">
              <Change n={o.market?.priceChange24h} /> <span className="text-fg-4">· {(o.watchedBy ?? []).map(shortAddress).join(", ")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
