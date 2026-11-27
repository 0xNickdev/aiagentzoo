import { useEffect, useState } from "react";
import { t, tChain } from "../../i18n";
import { minAgo } from "../../format";
import type { Verdict } from "./types";
import { NORTH, TONE } from "./shared";
import { Pn } from "./ui";

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
          setMoments(b.moments.filter((m) => ["dump", "serial", "graduated"].includes(m.kind) && !seen.has(m.mint) && seen.add(m.mint)).slice(0, 8));
        })
        .catch(() => setMoments([]));
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <section className="x-s12 x-hero">
        <a href="/hackathon-winner.png" target="_blank" rel="noopener" className="x-award">
          <b>{t("Winner")}</b>
          <span>{t("Best Consumer App on Solana, Solana Hackathon 2026 by Encode Club")}</span>
        </a>
        <h1>{t("See who you are buying from.")}</h1>
        <p>{t("Paste a token above. The wallets that got in during the first five seconds, who they are across every launch of the last two days, who paid for the creator, and how much of the volume is churn. pump.fun, LaunchLab, Meteora and Raydium, read live from Solana.")}</p>
      </section>
      <Pn span="x-s12" title={t("Try one from the chain, right now")} meta={t("live from Solana · tap to x-ray")} body={false}>
        <div className="x-moments">
          {!moments && Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="x-mo">
              <div className="x-sk" style={{ height: 16, width: "50%" }} />
              <div className="x-sk" style={{ height: 12, width: "85%" }} />
              <div className="x-sk" style={{ height: 12, width: "30%" }} />
            </div>
          ))}
          {moments?.map((m) => {
            const v = verdicts[m.mint];
            return (
              <button key={m.mint} type="button" className="x-mo" onClick={() => onPick(m.mint)}>
                <span className="x-a">
                  <span>${m.symbol.replace(/^\$/, "")}</span>
                  <small>{minAgo(m.at)}</small>
                </span>
                <p>{tChain(m.text)}</p>
                <span className="x-vd" style={{ color: v ? TONE[v].color : "var(--fg-4)" }}>{v ? t(TONE[v].label) : t("checking…")}</span>
              </button>
            );
          })}
        </div>
        {moments && moments.length === 0 && <p className="x-note" style={{ padding: 14 }}>{t("Nothing loud on the chain this minute. Paste any token above.")}</p>}
      </Pn>
      {SHOWS.map((x) => (
        <Pn key={x.title} span="x-s4" title={t(x.title)}>
          <p className="x-note">{t(x.text)}</p>
        </Pn>
      ))}
    </>
  );
}
