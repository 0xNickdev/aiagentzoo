import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section, SectionHead } from "./ui";
import { t, tChain } from "../i18n";

interface Rugger {
  wallet: string;
  launches24h: number;
  launches48h: number;
  dumped: number;
  medianDumpMin: number | null;
  recent: Array<{ mint: string; symbol: string; dumpedAfterMin: number | null }>;
  lastDump: { symbol: string; text: string; tx?: string; at: number } | null;
}

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** The devs who dump the most of their own launches, read from the chain, each with a transaction to check. */
export default function WallOfRugs() {
  const [list, setList] = useState<Rugger[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetch(`${NORTH}/v1/chain/ruggers?limit=25`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { ruggers: Rugger[] } | null) => b && setList(b.ruggers))
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Section className="!pt-0 overflow-x-clip" backdrop={{ tint: "200,60,50", glowAt: "50% 10%", opacity: 0.4 }}>
      {/* The wall itself, as a banner: a backdrop would stretch it past the red plaques on a page this tall. */}
      <div className="relative left-1/2 mb-2 h-[52vh] min-h-[300px] w-screen -translate-x-1/2 overflow-hidden">
        <img src="/backdrops/rugs.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_42%]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,4,0.35)_0%,rgba(3,5,4,0)_30%,rgba(3,5,4,0.2)_70%,#030504_100%)]" />
      </div>
      <SectionHead
        eyebrow={t("Wall of rugs · last 48 hours · read from Solana")}
        title={[t("The devs who dump"), t("their own tokens.")]}
        text={t("Creator wallets ranked by how many of their own pump.fun launches they sold half or more of. Every row links to a real transaction. Check your dev before you buy.")}
      />
      <Reveal className="liquid-glass overflow-hidden rounded-3xl">
        <div className="font-mono grid grid-cols-[2rem_minmax(0,1fr)_4rem_4rem] gap-3 border-b border-white/[0.07] px-5 py-3 text-[10.5px] text-white/40 sm:grid-cols-[2.5rem_minmax(0,12rem)_6rem_6rem_6rem_minmax(0,1fr)] sm:px-7">
          <span>#</span>
          <span>{t("dev wallet")}</span>
          <span className="text-right">{t("launched")}</span>
          <span className="text-right">{t("dumped")}</span>
          <span className="hidden text-right sm:block">{t("median")}</span>
          <span className="hidden sm:block">{t("latest dump")}</span>
        </div>
        {!list && <p className="px-7 py-10 text-center text-[13px] text-white/45">{t("Reading the chain…")}</p>}
        {list && list.length === 0 && <p className="px-7 py-10 text-center text-[13px] text-white/45">{t("No serial dumpers in the last two days yet. The stream fills this as it watches.")}</p>}
        {list?.map((r, i) => (
          <div
            key={r.wallet}
            className="font-mono grid grid-cols-[2rem_minmax(0,1fr)_4rem_4rem] items-center gap-3 border-t border-white/[0.05] px-5 py-3.5 text-[12.5px] sm:grid-cols-[2.5rem_minmax(0,12rem)_6rem_6rem_6rem_minmax(0,1fr)] sm:px-7"
          >
            <span className="text-white/40">{String(i + 1).padStart(2, "0")}</span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(r.wallet).catch(() => {});
                setCopied(r.wallet);
                window.setTimeout(() => setCopied(null), 1200);
              }}
              className="truncate text-left text-white/85 hover:text-white"
              title={t("Copy the wallet")}
            >
              {copied === r.wallet ? t("copied") : short(r.wallet)}
            </button>
            <span className="text-right text-white/70">{r.launches48h}</span>
            <span className="text-right text-[#ff8a7e]">{r.dumped}</span>
            <span className="hidden text-right text-white/60 sm:block">{r.medianDumpMin === null ? "-" : t("{m} min", { m: r.medianDumpMin })}</span>
            <span className="hidden truncate sm:block">
              {r.lastDump ? (
                <a href={r.lastDump.tx ? `https://solscan.io/tx/${r.lastDump.tx}` : undefined} target="_blank" rel="noopener noreferrer" className="text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white">
                  ${r.lastDump.symbol} · {tChain(r.lastDump.text)}
                </a>
              ) : (
                <span className="text-white/35">-</span>
              )}
            </span>
          </div>
        ))}
      </Reveal>
      <p className="font-mono mt-4 text-center text-[11px] text-white/40">
        {t("check any dev:")} <a href="/ask" className="underline decoration-white/25 underline-offset-4 hover:text-white">{t("ask the beaver")}</a> · {t("raw:")}{" "}
        <a href={`${NORTH}/v1/chain/ruggers`} className="underline decoration-white/25 underline-offset-4 hover:text-white">/v1/chain/ruggers</a>
      </p>
    </Section>
  );
}
