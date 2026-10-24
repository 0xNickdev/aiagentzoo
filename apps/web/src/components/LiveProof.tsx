import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section } from "./ui";
import { t, tChain } from "../i18n";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";

interface Side {
  n: number;
  dead: number;
}
interface Record {
  flaggedAvoid: Side;
  notFlagged: Side;
  avoidBecause: { dumped: number; serial: number; bundle: number };
}
interface Moment {
  mint: string;
  symbol: string;
  kind: string;
  text: string;
  at: number;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

/**
 * Proof before the explanation: what pump.fun looked like a day ago, read from the chain, and three devs who sold
 * minutes ago, each one tap from its x-ray. The numbers are the check's own public record.
 */
export default function LiveProof() {
  const [rec, setRec] = useState<Record | null>(null);
  const [dumps, setDumps] = useState<Moment[] | null>(null);

  useEffect(() => {
    const load = () => {
      fetch(`${NORTH}/v1/check/record`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: Record | null) => b && setRec(b))
        .catch(() => {});
      fetch(`${NORTH}/v1/chain/moments?kind=dump&limit=30`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { moments: Moment[] } | null) => {
          if (!b) return;
          const seen = new Set<string>();
          setDumps(b.moments.filter((m) => !seen.has(m.mint) && seen.add(m.mint)).slice(0, 3));
        })
        .catch(() => setDumps([]));
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  const total = rec ? rec.flaggedAvoid.n + rec.notFlagged.n : 0;
  const dead = rec ? rec.flaggedAvoid.dead + rec.notFlagged.dead : 0;
  const stats: Array<[string, string]> = rec
    ? [
        [total.toLocaleString("en-US"), t("pump.fun launches a day ago")],
        [pct(rec.avoidBecause.dumped, total), t("the dev sold their bag within 5 minutes")],
        [pct(rec.avoidBecause.serial, total), t("came from a wallet that launches and dumps all day")],
        [pct(dead, total), t("were dead a day later")],
      ]
    : [];
  const ago = (at: number) => {
    const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
    return m < 1 ? t("now") : t("{m} min ago", { m });
  };

  return (
    <Section className="!pb-10 !pt-14">
      <Reveal>
        <p className="tabular-nums mb-3 text-[12px] text-fg-3">{t("Read from the chain, not from a chart")}</p>
        <h2 className="font-display max-w-3xl text-3xl leading-tight sm:text-4xl">
          {t("Most launches are rigged before you can see them.")}
        </h2>
      </Reveal>

      <Reveal delay={0.1} className="bg-night-surface border border-white/[0.08] mt-8 grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4">
        {(rec ? stats : Array.from({ length: 4 }, () => ["…", ""] as [string, string])).map(([v, k], i) => (
          <div key={i} className="border-white/[0.08] p-5 sm:p-6 [&:not(:first-child)]:border-l max-lg:[&:nth-child(3)]:border-l-0 max-lg:[&:nth-child(n+3)]:border-t">
            <p className="tabular-nums text-3xl text-white sm:text-4xl">{v}</p>
            <p className="mt-2 text-[13px] font-normal leading-snug text-fg-4">{k}</p>
          </div>
        ))}
      </Reveal>
      <p className="tabular-nums mt-3 text-[12.5px] text-fg-4">
        {t("every SOL launch from 24 to 48 hours ago · our check's public record:")}{" "}
        <a href={`${NORTH}/v1/check/record`} className="underline decoration-white/25 underline-offset-4 hover:text-white">
          /v1/check/record
        </a>
      </p>

      <div className="mt-10 mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-xl text-fg">{t("Devs who sold in the last few minutes")}</h3>
        <a href="/xray" className="tabular-nums text-[12.5px] text-fg-3 hover:text-white">
          {t("x-ray any token →")}
        </a>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {!dumps && Array.from({ length: 3 }, (_, i) => <div key={i} className="bg-night-surface border border-white/[0.08] h-[92px] animate-pulse rounded-2xl opacity-60" />)}
        {dumps?.map((m) => (
          <a key={m.mint} href={`/xray?mint=${m.mint}`} className="bg-night-surface border border-white/[0.08] group rounded-2xl p-4 transition hover:bg-white/[0.06]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display truncate text-[18px]">${m.symbol.replace(/^\$/, "")}</span>
              <span className="tabular-nums shrink-0 text-[12px] text-fg-4">{ago(m.at)}</span>
            </div>
            <p className="mt-1.5 truncate text-[13px] font-normal text-[#ff8a7e]">{tChain(m.text)}</p>
            <p className="tabular-nums mt-2 text-[12px] text-fg-4 group-hover:text-fg-3">{t("see who bought it first →")}</p>
          </a>
        ))}
      </div>
    </Section>
  );
}
