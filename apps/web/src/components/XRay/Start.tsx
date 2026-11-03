import { useEffect, useState } from "react";
import { Section } from "../ui";
import { t, tChain } from "../../i18n";
import { minAgo } from "../../format";
import type { Verdict } from "./types";
import { NORTH, TONE } from "./shared";

export interface Moment {
  mint: string;
  symbol: string;
  kind: string;
  text: string;
  at: number;
}

export const SHOWS = [
  { title: "The first 5 seconds", text: "Every wallet that bought before anyone could see the token: what it took, what it still holds, when it sold out." },
  { title: "Who those wallets are", text: "Across every launch of the last two days: the creator's own crew, sniper rings, serial snipers." },
  { title: "Who paid for the creator", text: "The wallet that funded the dev, and what else it funded. Exchanges are left out: they fund everyone." },
];

/** Before anything is pasted: tokens the chain is talking about right now, one tap from their x-ray, and what it shows. */
export function Start({ onPick }: { onPick: (mint: string) => void }) {
  const [moments, setMoments] = useState<Moment[] | null>(null);
  // The check's own verdict on each, so a token that graduated is not mistaken for a good one.
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  useEffect(() => {
    for (const m of moments ?? []) {
      if (verdicts[m.mint]) continue;
      fetch(`${NORTH}/v1/check/${m.mint}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { verdict?: Verdict } | null) => b?.verdict && setVerdicts((v) => ({ ...v, [m.mint]: b.verdict! })))
        .catch(() => {});
    }
  }, [moments]);
  useEffect(() => {
    const load = () =>
      fetch(`${NORTH}/v1/chain/moments?limit=120`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { moments: Moment[] } | null) => {
          if (!b) return;
          const seen = new Set<string>();
          // Something worth looking at: a dev who just dumped, a serial launcher, a token that graduated.
          const pickd = b.moments.filter((m) => ["dump", "serial", "graduated"].includes(m.kind) && !seen.has(m.mint) && seen.add(m.mint)).slice(0, 8);
          setMoments(pickd);
        })
        .catch(() => setMoments([]));
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Section className="!pt-2">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl">{t("Try one from the chain, right now")}</h2>
        <p className="tabular-nums text-[12.5px] text-fg-3">{t("live from Solana · tap to x-ray")}</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!moments && Array.from({ length: 4 }, (_, i) => <div key={i} className="bg-night-surface border border-white/[0.08] h-[84px] animate-pulse rounded-2xl opacity-60" />)}
        {moments?.map((m) => (
          <button
            key={m.mint}
            type="button"
            onClick={() => onPick(m.mint)}
            className="bg-night-surface border border-white/[0.08] group rounded-2xl p-4 text-left transition hover:bg-white/[0.06]"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display truncate text-[17px]">${m.symbol.replace(/^\$/, "")}</span>
              <span className="tabular-nums shrink-0 text-[12px] text-fg-4">{minAgo(m.at)}</span>
            </div>
            <p className="mt-1.5 truncate text-[12.5px] font-normal text-fg-4">{tChain(m.text)}</p>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              {verdicts[m.mint] ? (
                <span className="tabular-nums rounded-full px-2 py-0.5 text-[11.5px] tracking-[0.06em] ring-1" style={{ color: TONE[verdicts[m.mint]!].color, boxShadow: "none", borderColor: "transparent", background: "rgba(255,255,255,0.03)" }}>
                  {t(TONE[verdicts[m.mint]!].label)}
                </span>
              ) : (
                <span className="tabular-nums text-[11.5px] text-fg-4">{t("checking…")}</span>
              )}
              <span className="tabular-nums text-[12px] text-fg-4 group-hover:text-fg-3">{t("x-ray it →")}</span>
            </div>
          </button>
        ))}
      </div>
      {moments && moments.length === 0 && <p className="text-[13px] font-normal text-fg-3">{t("Nothing loud on the chain this minute. Paste any token above.")}</p>}

      <div className="mt-10 grid gap-3 md:grid-cols-3">
        {SHOWS.map((x) => (
          <div key={x.title} className="bg-night-surface border border-white/[0.08] rounded-2xl p-5 sm:p-6">
            <h3 className="font-display text-xl text-fg">{t(x.title)}</h3>
            <p className="mt-2 text-[13.5px] font-normal leading-relaxed text-fg-3">{t(x.text)}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
