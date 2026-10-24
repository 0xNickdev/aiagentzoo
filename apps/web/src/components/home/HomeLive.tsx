import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { t, tChain } from "../../i18n";
import { ago, compact, feedRows, type FeedRow, full, hue, initials, type Moment, NORTH, picOf, short, SITE_WALLET, SITE_XRAY, ticker, useNorth, useNow, useTicker } from "./live";

const EASE = [0.16, 1, 0.3, 1] as const;
// Magic UI's AnimatedList spring: new rows grow in on top, the rest glide down.
const SPRING = { type: "spring" as const, stiffness: 350, damping: 40 };

function Avatar({ mint, symbol, image, venue, tone, size = 40 }: { mint: string; symbol?: string; image?: string; venue?: string; tone?: "red" | "amber"; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = picOf(mint, image, venue);
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-full border border-white/[0.08] text-[13px] font-semibold text-white"
      style={{ width: size, height: size, background: `hsl(${hue(mint)} 14% 15%)` }}
    >
      {initials(symbol, mint)}
      {src && !broken && (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full rounded-full bg-[#0b0d0c] object-cover" />
      )}
      {tone && <i className={`absolute -bottom-px -right-px z-10 h-[11px] w-[11px] rounded-full border-2 border-[#0a0e0c] ${tone === "red" ? "bg-[#ff8a7e]" : "bg-[#ffc27a]"}`} />}
    </span>
  );
}

function Row({ e, now }: { e: FeedRow; now: number }) {
  const red = Boolean(e.dump || e.drained != null);
  const [big, label] = e.dump
    ? [e.dump.after, t("dev sold {p}%", { p: e.dump.pct })]
    : e.drained != null
      ? [`${Math.round(e.drained)} SOL`, t("left in the pool")]
      : [`#${e.serial}`, t("launch today")];
  const sub = [e.creator ? `${t("dev")} ${short(e.creator)}` : "", e.dump && e.serial ? t("{n}th launch today", { n: e.serial }) : ""].filter(Boolean).join(" · ");
  return (
    <a href={SITE_XRAY(e.mint)} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[10px] p-3 transition-colors hover:bg-white/[0.035] sm:grid-cols-[40px_minmax(0,1fr)_auto_64px]">
      <Avatar mint={e.mint} symbol={e.symbol} image={e.image} venue={e.venue} tone={red ? "red" : "amber"} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <b className="truncate text-[15px] font-semibold text-white">{ticker(e.symbol, e.mint)}</b>
        <small className="truncate text-[12.5px] text-[#a3aaa6]">{sub}</small>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <b className="text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-white">{big}</b>
        <small className="whitespace-nowrap text-[12.5px] text-[#a3aaa6]">{label}</small>
      </span>
      <span className="hidden text-right text-[12.5px] tabular-nums text-[#a3aaa6] sm:block">{t("{a} ago", { a: ago(e.at, now) })}</span>
    </a>
  );
}

interface CheckResult {
  symbol?: string;
  verdict: string;
  reasons: string[];
  image?: string;
  facts: { buyers?: number; creatorDumped48h?: number; creatorSoldPct?: number; bundlersPeakPct?: number; curveSol?: number; poolSol?: number | null; venue?: string };
}

/** A real coin that went to zero in the last hours, as the X-Ray reads it now. */
function useRugCase() {
  const [c, setC] = useState<(CheckResult & { mint: string; at: number }) | null>(null);
  useEffect(() => {
    if (!NORTH) return;
    let live = true;
    (async () => {
      try {
        const { moments } = (await (await fetch(`${NORTH}/v1/chain/moments?kind=drained&limit=20`)).json()) as { moments: Moment[] };
        const seen = new Set<string>();
        for (const m of moments) {
          if (seen.has(m.mint)) continue;
          seen.add(m.mint);
          const x = (await (await fetch(`${NORTH}/v1/check/${m.mint}`)).json()) as CheckResult;
          // a rug with real people on the other side, not a dev trading with themselves
          if (x.verdict === "avoid" && (x.facts.buyers ?? 0) >= 40 && x.reasons.length >= 2) {
            if (live) setC({ ...x, mint: m.mint, at: m.at });
            return;
          }
        }
      } catch {
        /* the card stays empty rather than showing a made-up example */
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return c;
}

function RugCase() {
  const c = useRugCase();
  const now = useNow(10_000);
  if (!c) return <div className="min-h-[420px] rounded-2xl border border-white/[0.07] bg-[#0a0e0c]" />;
  const f = c.facts;
  const left = f.poolSol != null && f.curveSol ? Math.max(0, Math.min(1, f.poolSol / f.curveSol)) : null;
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE }} className="rounded-2xl border border-white/[0.07] bg-[#0a0e0c] px-6 pb-2 pt-6">
      <div className="flex items-center gap-3">
        <Avatar mint={c.mint} symbol={c.symbol} image={c.image} venue={f.venue} tone="red" size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[20px] font-semibold tracking-[-0.02em] text-white">{ticker(c.symbol, c.mint)}</p>
          <p className="text-[12.5px] text-[#a3aaa6]">
            <span className="tabular-nums">{short(c.mint)}</span> · {t("went to zero {a} ago", { a: ago(c.at, now) })}
          </p>
        </div>
        <span className="rounded-full border border-[#ff8a7e]/35 bg-[#ff8a7e]/10 px-3 py-1 text-[12px] font-medium text-[#ff8a7e]">{t("AVOID")}</span>
      </div>
      {left != null && (
        <>
          <div className="mt-6 flex flex-wrap items-baseline gap-3">
            <p className="font-display text-[48px] font-semibold leading-none tracking-[-0.045em] tabular-nums text-white">
              {Math.round(f.curveSol!)}
              <span className="px-[0.12em] font-medium text-[#a3aaa6]">→</span>
              {f.poolSol! < 1 ? f.poolSol!.toFixed(2) : Math.round(f.poolSol!)}
            </p>
            <span className="text-[20px] font-medium text-[#a3aaa6]">SOL</span>
            <span className="ml-auto text-[15px] font-semibold tabular-nums text-[#ff8a7e]">-{Math.round((1 - left) * 100)}%</span>
          </div>
          <p className="mt-2 text-[14px] text-[#a3aaa6]">{t("in the pool, from graduation to now")}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.i initial={{ width: "100%" }} whileInView={{ width: `${(left * 100).toFixed(1)}%` }} viewport={{ once: true }} transition={{ duration: 1.4, ease: EASE, delay: 0.3 }} className="block h-full rounded-full bg-[#ff8a7e]" />
          </div>
        </>
      )}
      <div className="mt-5 grid grid-cols-3 gap-3">
        {(
          [
            [f.buyers != null ? full(f.buyers) : "-", t("people bought it")],
            [f.bundlersPeakPct != null ? `${Math.round(f.bundlersPeakPct)}%` : "-", t("held by bundles at the peak")],
            f.creatorSoldPct != null
              ? [`${Math.round(f.creatorSoldPct)}%`, t("of the bag the dev sold")]
              : [f.creatorDumped48h != null ? String(f.creatorDumped48h) : "-", t("launches this dev dumped, 48h")],
          ] as Array<[string, string]>
        ).map(([v, k]) => (
          <div key={k} className="rounded-[10px] bg-white/[0.03] p-3.5">
            <p className="text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-white">{v}</p>
            <p className="mt-1 text-[12.5px] leading-snug text-[#a3aaa6]">{k}</p>
          </div>
        ))}
      </div>
      <ul className="mt-5">
        {c.reasons.slice(0, 3).map((r) => (
          <li key={r} className="relative pb-3.5 pl-5 text-[14.5px] leading-relaxed text-[#e6e9e7] before:absolute before:left-0.5 before:top-[0.62em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-[#ff8a7e]">
            {tChain(r).replace(/^./, (x) => x.toUpperCase())}
          </li>
        ))}
      </ul>
      <div className="-mx-6 mt-1 flex items-center justify-between gap-3 border-t border-white/[0.07] px-6 py-3.5 text-[13px] text-[#a3aaa6]">
        <span>{t("What the X-Ray shows on it.")}</span>
        <a href={SITE_XRAY(c.mint)} className="inline-flex items-center gap-1.5 font-medium text-white">
          {t("Open X-Ray")} <ArrowRight size={14} />
        </a>
      </div>
    </motion.div>
  );
}

/** What devs are doing right now, one row per coin, next to a real rug read by the X-Ray. */
export function LiveNow() {
  const data = useNorth<{ moments: Moment[] }>("/v1/chain/moments?limit=80", 6_000);
  const chain = useNorth<{ perMinute: { launches: number } }>("/v1/chain", 20_000);
  const now = useNow();
  const rows = data ? feedRows(data.moments).slice(0, 8) : [];
  return (
    <section id="now" className="relative scroll-mt-20 px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-7xl">
        <p className="flex items-center gap-2.5 text-[15px] text-[#a3aaa6]">
          <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-[#a6e3b4]" />
          {t("Live from the chain, refreshes every few seconds")}
        </p>
        <h2 className="font-display mt-3 text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-[60px]">{t("What devs are doing right now.")}</h2>
        <div className="mt-12 grid items-start gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0a0e0c]">
            <div className="flex items-center justify-between px-5 py-4 text-[13px] text-[#a3aaa6]">
              <span>{t("Dev dumps, serial launchers, drained pools")}</span>
              <span>
                <b className="font-medium tabular-nums text-white">{chain ? full(chain.perMinute.launches) : "-"}</b> {t("launches a minute")}
              </span>
            </div>
            <ul className="px-2 pb-2">
              <AnimatePresence initial={false}>
                {rows.map((e) => (
                  <motion.li key={e.mint} layout initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1, originY: 0 }} exit={{ scale: 0, opacity: 0 }} transition={SPRING}>
                    <Row e={e} now={now} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
          <RugCase />
        </div>
      </div>
    </section>
  );
}

/** The three reasons behind most avoids, counted on yesterday's launches, and the loudest dev of two days. */
export function WhyAvoid() {
  const rec = useNorth<{ avoidBecause: { dumped: number; serial: number; bundle: number } }>("/v1/check/record", 120_000);
  const rug = useNorth<{ ruggers: Array<{ wallet: string; launches48h: number; dumped: number; medianDumpMin: number }> }>("/v1/chain/ruggers?limit=1", 120_000);
  const dumped = useTicker(rec?.avoidBecause.dumped ?? null);
  const serial = useTicker(rec?.avoidBecause.serial ?? null);
  const bundle = useTicker(rec?.avoidBecause.bundle ?? null);
  const top = rug?.ruggers[0];
  const cells: Array<[number | null, string]> = [
    [dumped, t("launches where the dev had already sold by the time we checked, five minutes in.")],
    [serial, t("launches from a dev who dumped most of their earlier coins.")],
    [bundle, t("launches where three or more wallets took 15% of the supply in the launch block.")],
  ];
  return (
    <section className="relative px-5 pb-24 sm:px-8 sm:pb-32">
      <div className="mx-auto max-w-7xl">
        <p className="text-[15px] text-[#a3aaa6]">{t("Why it says avoid")}</p>
        <h2 className="font-display mt-3 max-w-4xl text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-[60px]">
          {t("Three things that kill most coins, counted on yesterday's launches.")}
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {cells.map(([v, k]) => (
            <div key={k} className="rounded-2xl border border-white/[0.07] bg-[#0a0e0c] p-6">
              <p className="font-display text-[40px] font-semibold tabular-nums tracking-[-0.04em] text-white">{v != null ? compact(v) : "-"}</p>
              <p className="mt-2.5 text-[15.5px] leading-relaxed text-[#d9dddb]">{k}</p>
            </div>
          ))}
        </div>
        {top && (
          <a href={SITE_WALLET(top.wallet)} className="group mt-5 flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-white/[0.07] bg-[#0a0e0c] p-6 transition-colors hover:border-white/20">
            <div>
              <p className="text-[15px] text-[#a3aaa6]">
                {t("Loudest dev of the last 48 hours")} · <span className="tabular-nums">{short(top.wallet)}</span>
              </p>
              <p className="mt-2.5 text-[22px] tracking-[-0.02em] text-white sm:text-[24px]">
                {t("{n} launches, {d} dumped. Usually sells {m}.", {
                  n: full(top.launches48h),
                  d: full(top.dumped),
                  m: top.medianDumpMin < 1 ? t("in under a minute") : t("after {m} min", { m: top.medianDumpMin }),
                })}
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-[14px] font-medium text-white">
              {t("See the wallet")} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </a>
        )}
      </div>
    </section>
  );
}
