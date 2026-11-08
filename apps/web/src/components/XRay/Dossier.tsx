import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { TagList } from "../WalletTags";
import { t } from "../../i18n";
import { KIND, kindOf, secs } from "../XRayRadar";
import { pctFine } from "../../format";
import type { Early } from "./types";
import { Addr, NORTH, openWallet } from "./shared";

export interface Sniper {
  wallet: string;
  snipes48h: number;
  soldOut: number;
  medianExitSec: number | null;
  topCreators: Array<{ creator: string; launches: number }>;
  recent: Array<{ mint: string; symbol: string; createdAt: number }>;
}

/** Who a first-second wallet is: what it did here, and what it does across every launch of the last two days. */
export function Dossier({ e, creator, onPick, onClose }: { e: Early; creator: string; onPick: (mint: string) => void; onClose: () => void }) {
  const [s, setS] = useState<Sniper | null | undefined>(undefined);
  useEffect(() => {
    setS(undefined);
    let live = true;
    fetch(`${NORTH}/v1/chain/sniper/${e.wallet}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Sniper | null) => live && setS(b))
      .catch(() => live && setS(null));
    return () => {
      live = false;
    };
  }, [e.wallet]);
  const k = KIND[kindOf(e)];
  const sameDev = s?.topCreators.find((c) => c.creator === creator);
  return (
    <motion.div key={e.wallet} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="tabular-nums text-[13px] [&::first-letter]:uppercase" style={{ color: k.color }}>
            {t(k.label)}
          </p>
          <Addr a={e.wallet} className="mt-1 inline-block text-[15px] text-fg" />
        </div>
        <button type="button" onClick={onClose} className="tabular-nums rounded-full px-2.5 py-1 text-[13px] text-fg-3 ring-1 ring-white/10 hover:text-white">
          {t("close")}
        </button>
      </div>
      <p className="mt-2 text-[13px] font-normal leading-snug text-fg-4">{t(k.what)}</p>
      <TagList tags={e.tags} />
      {e.cabal && (
        <a href={`/cabals?id=${e.cabal}`} className="mt-2 inline-block text-[13px] text-[#ffc27a] underline decoration-[#ffc27a]/30 underline-offset-4">
          {t("in cabal #{n}: wallets the memory ties together →", { n: e.cabal })}
        </a>
      )}
      <button type="button" onClick={() => openWallet(e.wallet)} className="tabular-nums mt-3 self-start rounded-full px-3 py-1.5 text-[13px] text-[#ffc27a] ring-1 ring-[#ffc27a]/30 transition hover:bg-[#ffc27a]/10">
        {t("open this wallet's page →")}
      </button>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          ["in at", `${e.afterSec}s`, false],
          ["took", pctFine(e.bought), e.bought >= 0.05],
          ["holds now", pctFine(e.held), e.held >= 0.05],
          ["sold out", e.exitSec === null ? t("not yet") : secs(e.exitSec), false],
          ["snipes 48h", String(e.snipes48h), e.snipes48h >= 10],
          ["sold out of", s ? `${s.soldOut}` : "…", false],
        ].map(([kk, v, bad]) => (
          <div key={kk as string} className="rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/[0.06]">
            <p className="text-[13px] text-fg-4">{t(kk as string)}</p>
            <p className={`tabular-nums mt-0.5 text-[14px] ${bad ? "text-[#ff8a7e]" : "text-fg"}`}>{v}</p>
          </div>
        ))}
      </div>
      {s === undefined && <div className="mt-4 h-24 animate-pulse rounded-xl bg-white/[0.03]" />}
      {s === null && <p className="mt-4 text-[13px] font-normal text-fg-3">{t("No other launches from this wallet on the stream in the last two days.")}</p>}
      {s && (
        <>
          <p className="mt-4 text-[13px] font-normal leading-snug text-fg-3">
            {t("Last two days: bought {n} launches in their first seconds, sold out of {o}, usually {x} after buying.", { n: s.snipes48h, o: s.soldOut, x: secs(s.medianExitSec) })}
            {sameDev ? ` ${t("{n} of them were this creator's.", { n: sameDev.launches })}` : ""}
          </p>
          {s.topCreators.length > 0 && (
            <div className="mt-3">
              <p className="tabular-nums text-[12.5px] [&::first-letter]:uppercase text-fg-4">{t("whose launches it buys")}</p>
              <div className="mt-1.5 divide-y divide-white/[0.05]">
                {s.topCreators.slice(0, 4).map((c) => (
                  <div key={c.creator} className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
                    <Addr a={c.creator} className={c.creator === creator ? "text-[#ff8a7e]" : "text-fg-3"} />
                    <span className="tabular-nums text-fg-3">
                      {c.creator === creator ? `${t("this creator")} · ` : ""}
                      {c.launches === 1 ? t("1 launch") : t("{n} launches", { n: c.launches })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {s.recent.length > 0 && (
            <div className="mt-3">
              <p className="tabular-nums text-[12.5px] [&::first-letter]:uppercase text-fg-4">{t("its latest snipes · tap to x-ray")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.recent.slice(0, 8).map((m) => (
                  <button key={m.mint} type="button" onClick={() => onPick(m.mint)} className="tabular-nums max-w-[9rem] truncate rounded-full px-2.5 py-1 text-[13px] text-fg-3 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-white">
                    ${m.symbol.replace(/^\$/, "")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
