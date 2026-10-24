import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Bell } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGuardian } from "../zoo";
import { t, tChain } from "../i18n";
import WalletButton, { useHolder } from "./Wallet";
import { ago, useRadar, type Watched } from "./radarCore";

const EASE = [0.215, 0.61, 0.355, 1] as const;

function Row({ w, locked }: { w: Watched; locked: boolean }) {
  const turned = !!w.turnedAt;
  const color = turned ? (w.verdict === "avoid" ? "#ff8a7e" : "#ffc27a") : w.verdict === "pass" ? "#a6e3b4" : "rgba(255,255,255,0.45)";
  const status = turned ? (w.verdict === "avoid" ? t("turned · avoid") : t("turned · caution")) : w.verdict === "pass" ? t("no red flags so far") : t("checking");
  return (
    <motion.a
      layout
      href={locked ? undefined : `/xray?mint=${w.mint}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: EASE }}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 border-b border-white/[0.08] px-1 py-4 sm:grid-cols-[minmax(0,1.4fr)_120px_120px_220px] ${locked ? "pointer-events-none select-none blur-[5px]" : "hover:bg-white/[0.03]"}`}
    >
      <div className="min-w-0">
        <p className="truncate text-[17px] text-white">
          ${w.symbol} <span className="text-[14px] text-fg-4">{w.name}</span>
        </p>
        {turned && w.reason && <p className="mt-1 text-[14px] leading-snug" style={{ color }}>{tChain(w.reason)}</p>}
      </div>
      <p className="tabular-nums hidden text-[14px] tabular-nums text-fg-3 sm:block">{t("{n} buyers", { n: w.buyers })}</p>
      <p className="tabular-nums hidden text-[14px] tabular-nums text-fg-3 sm:block">{w.graduated ? t("graduated") : `${w.curveSol.toFixed(1)} SOL`}</p>
      <p className="flex items-center justify-end gap-2 text-right text-[14px] sm:justify-start sm:text-left" style={{ color }}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${w.verdict ? "" : "animate-pulse"}`} style={{ background: color }} />
        {status}
        {turned && w.turnedAt && <span className="text-fg-4">· {ago(w.turnedAt)}</span>}
      </p>
    </motion.a>
  );
}

export default function Radar() {
  const { session } = useGuardian();
  const holder = useHolder(session?.publicKey ?? null);
  const { watched, notify, askNotify } = useRadar();
  const isHolder = !!holder?.holder;
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const { turned, live } = useMemo(() => {
    const all = Object.values(watched);
    return {
      turned: all.filter((w) => w.turnedAt).sort((a, b) => (b.turnedAt ?? 0) - (a.turnedAt ?? 0)),
      live: all.filter((w) => !w.turnedAt).sort((a, b) => a.ageMin - b.ageMin),
    };
  }, [watched]);
  const lockAfter = isHolder ? Infinity : 3;

  return (
    <section className="relative min-h-screen px-5 pb-28 pt-16 sm:px-8 sm:pt-24">
      <div className="mx-auto max-w-6xl">
        <p className="text-[15px] text-fg-3">{t("For holders of $ZOOAGENCY")}</p>
        <h1 className="font-display mt-3 max-w-3xl text-[44px] font-semibold leading-[1.02] text-white sm:text-[72px]">
          {t("Holder radar.")} <span className="accent">{t("Know first when it turns.")}</span>
        </h1>
        <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-fg-3">
          {t("Fresh coins that passed our checks, re-checked against the chain all the time. The moment one turns, the dev dumps, the bundles leave, the pool drains, it goes red and moves to the top.")}
        </p>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-4">
          {t("Not a buy list. No red flags only means we have not caught anything yet.")}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          {!session && <WalletButton />}
          {session && holder && !isHolder && (
            <p className="text-[15px] text-warn">{t("Hold {n} $ZOOAGENCY to open the whole radar. Here are the first three.", { n: Math.round(holder.min).toLocaleString("en-US") })}</p>
          )}
          {isHolder && (
            <button
              type="button"
              onClick={askNotify}
              disabled={notify}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-[14px] text-fg-2 transition hover:bg-white/[0.06] disabled:opacity-70"
            >
              <Bell size={15} /> {notify ? t("Pings on in this tab") : t("Ping me in this tab when one turns")}
            </button>
          )}
          <span className="text-[14px] text-fg-4">{t("Telegram pings are next.")}</span>
        </div>

        <AnimatePresence>
          {turned.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-14">
              <h2 className="font-display text-[26px] text-[#ff8a7e]">{t("Turned")}</h2>
              <div className="mt-3 border-t border-[#ff8a7e]/30">
                {turned.map((w, i) => (
                  <Row key={w.mint} w={w} locked={i >= lockAfter} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-[26px] text-white">{t("Watching now")}</h2>
            <p className="tabular-nums text-[13px] text-fg-4">{live.length === 1 ? t("1 coin · re-checked about every minute") : t("{n} coins · re-checked about every minute", { n: live.length })}</p>
          </div>
          <div className="relative mt-3 border-t border-white/[0.12]">
            {live.length === 0 && <p className="py-10 text-[15px] text-fg-4">{t("Reading the chain...")}</p>}
            {live.map((w, i) => (
              <Row key={w.mint} w={w} locked={i >= lockAfter} />
            ))}
            {live.length > 0 && live.length < 4 && (
              <p className="border-t border-white/[0.08] py-8 text-[15px] leading-relaxed text-fg-4">
                {t("Only fresh coins with no red flags so far make this list. On a rough day that leaves a few. New ones show up here the moment they pass.")}
              </p>
            )}
            {!isHolder && live.length > lockAfter && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-48 items-end justify-center bg-gradient-to-t from-[#030504] to-transparent pb-6">
                <span className="pointer-events-auto">
                  {session ? (
                    <a href="https://clawpump.tech/tokens/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-black">
                      {t("Get $ZOOAGENCY")} <ArrowRight size={15} />
                    </a>
                  ) : (
                    <WalletButton />
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
