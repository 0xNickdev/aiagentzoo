import { useEffect, useState } from "react";
import { TagList } from "../WalletTags";
import { t } from "../../i18n";
import { KIND, kindOf, secs } from "../XRayRadar";
import { pctFine, short } from "../../format";
import type { Early } from "./types";
import { NORTH, openWallet } from "./shared";
import { LockRow } from "./ui";

export interface Sniper {
  wallet: string;
  snipes48h: number;
  soldOut: number;
  medianExitSec: number | null;
  topCreators: Array<{ creator: string; launches: number }>;
  recent: Array<{ mint: string; symbol: string; createdAt: number }>;
}

/**
 * Who a first-second wallet is. What it did on this coin is always shown; its history across every launch of the
 * last two days is the deep check, read only when it is open.
 */
export function Dossier({ e, creator, onPick, deep, onUnlock }: { e: Early; creator: string; onPick: (mint: string) => void; deep: boolean; onUnlock: () => void }) {
  const [s, setS] = useState<Sniper | null | undefined>(undefined);
  useEffect(() => {
    if (!deep) return;
    setS(undefined);
    let live = true;
    fetch(`${NORTH}/v1/chain/sniper/${e.wallet}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Sniper | null) => live && setS(b))
      .catch(() => live && setS(null));
    return () => {
      live = false;
    };
  }, [e.wallet, deep]);
  const k = KIND[kindOf(e)];
  const sameDev = s?.topCreators.find((c) => c.creator === creator);
  return (
    <div>
      <div className="x-li-h">
        <span>
          <span style={{ color: k.color }}>{e.smart?.name ?? t(k.label)}</span>{" "}
          <code className="x-dim">{short(e.wallet)}</code>
        </span>
        <button type="button" className="x-link" onClick={() => openWallet(e.wallet)}>
          {t("open this wallet's page")}
        </button>
      </div>
      <p className="x-fine" style={{ marginTop: 4 }}>{t(k.what)}</p>
      <TagList tags={e.tags} />
      {e.cabal && <p className="x-fine x-w">{t("In cabal #{n}: wallets the memory ties together.", { n: e.cabal })}</p>}
      <div className="x-cells">
        {[
          [t("in at"), `${e.afterSec}s`, false],
          [t("took"), pctFine(e.bought), e.bought >= 0.05],
          [t("holds now"), pctFine(e.held), e.held >= 0.05],
          [t("sold out"), e.exitSec === null ? t("not yet") : secs(e.exitSec), false],
          [t("snipes 48h"), String(e.snipes48h), e.snipes48h >= 10],
          [t("sold out of"), deep ? (s ? String(s.soldOut) : s === null ? "-" : "…") : t("deep check"), false],
        ].map(([kk, v, bad]) => (
          <div key={kk as string}>
            <div className={`x-v ${bad ? "x-d" : ""}`} style={{ fontSize: 17 }}>{v}</div>
            <div className="x-k">{kk}</div>
          </div>
        ))}
      </div>
      {!deep && (
        <div style={{ marginTop: 12 }}>
          <LockRow text={t("Its last two days across every launch: whose coins it snipes, how fast it sells, its latest snipes.")} onUnlock={onUnlock} />
        </div>
      )}
      {deep && s === undefined && <div className="x-sk" style={{ height: 72, marginTop: 12 }} />}
      {deep && s === null && <p className="x-note" style={{ marginTop: 12 }}>{t("No other launches from this wallet on the stream in the last two days.")}</p>}
      {deep && s && (
        <>
          <p className="x-note" style={{ marginTop: 12 }}>
            {t("Last two days: bought {n} launches in their first seconds, sold out of {o}, usually {x} after buying.", { n: s.snipes48h, o: s.soldOut, x: secs(s.medianExitSec) })}
            {sameDev ? ` ${t("{n} of them were this creator's.", { n: sameDev.launches })}` : ""}
          </p>
          {s.topCreators.length > 0 && (
            <>
              <p className="x-h3">{t("Whose launches it buys")}</p>
              <div className="x-kv x-flush">
                {s.topCreators.slice(0, 4).map((c) => (
                  <div key={c.creator}>
                    <button type="button" className={c.creator === creator ? "x-d" : ""} onClick={() => openWallet(c.creator)}>
                      <code>{short(c.creator)}</code>
                    </button>
                    <b className={c.creator === creator ? "x-d" : ""}>
                      {c.creator === creator ? `${t("this creator")} · ` : ""}
                      {c.launches === 1 ? t("1 launch") : t("{n} launches", { n: c.launches })}
                    </b>
                  </div>
                ))}
              </div>
            </>
          )}
          {s.recent.length > 0 && (
            <>
              <p className="x-h3">{t("Its latest snipes, tap to x-ray")}</p>
              <div className="x-acts" style={{ marginTop: 4 }}>
                {s.recent.slice(0, 8).map((m) => (
                  <button key={m.mint} type="button" className="x-btn" onClick={() => onPick(m.mint)}>
                    ${m.symbol.replace(/^\$/, "")}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
