import { motion } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { t } from "../i18n";
import { secs } from "./XRayRadar";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const sym = (s: string) => s.replace(/^\$+/, "");
const ago = (at: number) => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return m < 60 ? t("{m} min ago", { m }) : m < 1440 ? t("{h}h ago", { h: Math.round(m / 60) }) : t("{d}d ago", { d: Math.round(m / 1440) });
};
const VENUE: Record<string, string> = { "pump.fun": "pump.fun", launchlab: "LaunchLab", dbc: "Meteora" };

interface Profile {
  wallet: string;
  dev: {
    launches24h: number;
    launches48h: number;
    dumped: number;
    medianDumpMin: number | null;
    graduated: number;
    builder: { launches: number; grew: number; graduated: number; aliveGraduated: number; dumped: number; isBuilder: boolean } | null;
    launches: Array<{ mint: string; symbol: string; createdAt: number; venue: string; buyers: number; early: number; dumpedAfterMin: number | null; graduated: boolean }>;
    regulars: Array<{ wallet: string; launches: number; snipes48h: number }>;
  } | null;
  funding: { funder: string | null; funderIsHot: boolean; siblings: Array<{ wallet: string; launches48h: number; dumped: number }>; siblingDumped48h: number } | null;
  funded: { hot: boolean; creators: Array<{ wallet: string; launches48h: number; dumped: number }> };
  sniper: { snipes48h: number; soldOut: number; medianExitSec: number | null; topCreators: Array<{ creator: string; launches: number }>; recent: Array<{ mint: string; symbol: string; createdAt: number }> } | null;
  accounts: Array<{ social: { url: string; label: string; kind: string }; launches: number; fastDumps: number; creators: number }>;
}

/** A link to another wallet's page, and a small one out to Solscan. */
export function WalletLink({ a, onWallet, className = "" }: { a: string; onWallet: (w: string) => void; className?: string }) {
  return (
    <span className={`font-mono inline-flex items-baseline gap-1.5 ${className}`}>
      <button type="button" onClick={() => onWallet(a)} className="underline decoration-white/15 underline-offset-4 transition hover:text-white hover:decoration-white/60">
        {short(a)}
      </button>
      <a href={`https://solscan.io/account/${a}`} target="_blank" rel="noopener noreferrer" title="Solscan" className="text-[10px] text-white/35 hover:text-white">
        ↗
      </a>
    </span>
  );
}

function Box({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="liquid-glass rounded-3xl p-5 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl text-white/90">{t(title)}</h3>
        {note && <span className="font-mono text-[10.5px] text-white/40">{t(note)}</span>}
      </div>
      {children}
    </div>
  );
}

function Num({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="bg-[#070a09]/90 px-4 py-3">
      <p className="text-[11px] text-white/45">{t(k)}</p>
      <p className={`font-mono mt-1 text-[18px] ${bad ? "text-[#ff8a7e]" : "text-white/90"}`}>{v}</p>
    </div>
  );
}

/** One sentence for the whole wallet, from the facts, no adjectives the facts do not carry. */
function lead(p: Profile): { text: string; bad: boolean; good?: boolean } {
  const d = p.dev;
  if (d && d.builder?.isBuilder)
    return { text: t("A track record: {g} of its {n} launches grew and still hold liquidity, and it has not dumped them.", { g: d.builder.grew, n: d.builder.launches }), bad: false, good: true };
  if (d && d.launches48h >= 3 && d.dumped >= Math.ceil(d.launches48h * 0.6))
    return { text: t("A serial dumper: launched {n} tokens in two days and dumped {d} of them, usually {m} min after launch.", { n: d.launches48h, d: d.dumped, m: d.medianDumpMin ?? 0 }), bad: true };
  if (p.funded.creators.length >= 2 && !p.funded.hot) {
    const dumps = p.funded.creators.reduce((n, c) => n + c.dumped, 0);
    return { text: t("Pays for other devs: funded {n} launch wallets the zoo traced, with {d} dumps between them in two days.", { n: p.funded.creators.length, d: dumps }), bad: dumps >= 3 };
  }
  if (p.sniper && p.sniper.snipes48h >= 10)
    return { text: t("A sniper: bought {n} launches in their first seconds in two days and sold out of {o}, usually {x} after buying.", { n: p.sniper.snipes48h, o: p.sniper.soldOut, x: secs(p.sniper.medianExitSec) }), bad: true };
  if (d && d.graduated >= 1 && d.dumped === 0) return { text: t("A dev whose launches graduated and who has not dumped one in two days."), bad: false };
  if (d) return { text: t("Launched {n} tokens in two days, dumped {d}.", { n: d.launches48h, d: d.dumped }), bad: d.dumped >= 2 };
  return { text: t("Seen in the first seconds of {n} launches in two days.", { n: p.sniper?.snipes48h ?? 0 }), bad: false };
}

/** A wallet's page: as a dev, as a first-second buyer and as the one who pays for devs. Every address leads on. */
export default function WalletProfile({ wallet, onToken, onWallet }: { wallet: string; onToken: (mint: string) => void; onWallet: (w: string) => void }) {
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setP(undefined);
    setError(null);
    let live = true;
    fetch(`${NORTH}/v1/wallet/${wallet}`)
      .then(async (r) => {
        const b = (await r.json()) as Profile & { error?: string };
        if (!live) return;
        if (r.ok) setP(b);
        else {
          setP(null);
          setError(r.status === 429 ? t("Too many lookups this minute. Try again in a minute.") : t("This wallet did not launch, snipe or fund a launch the stream saw in the last two days."));
        }
      })
      .catch(() => live && (setP(null), setError(t("The chain reader did not answer. Try again in a minute."))));
    return () => {
      live = false;
    };
  }, [wallet]);

  if (p === undefined) return <div className="mx-auto max-w-7xl px-5 pb-10 sm:px-8"><div className="liquid-glass h-64 animate-pulse rounded-3xl" /></div>;
  if (!p) return <p className="mx-auto max-w-7xl px-5 pb-10 text-center text-[13px] text-[#ff9a8f] sm:px-8">{error}</p>;

  const l = lead(p);
  const roles = [p.dev && t("dev"), p.sniper && t("first-second buyer"), p.funded.creators.length > 0 && !p.funded.hot && t("pays for devs"), p.funded.hot && t("exchange or router")].filter(Boolean) as string[];
  const d = p.dev;
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="px-5 pb-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="liquid-glass rounded-3xl p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[11px] text-white/45">
              {t("wallet")} · {roles.join(" · ")}
            </p>
            <span className="flex items-center gap-3 text-[11px]">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(wallet)} className="font-mono text-white/50 hover:text-white">
                {t("copy")}
              </button>
              <a href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noopener noreferrer" className="font-mono text-white/50 underline decoration-white/20 underline-offset-4 hover:text-white">
                Solscan ↗
              </a>
            </span>
          </div>
          <p className="font-mono mt-2 break-all text-[15px] text-white/85">{wallet}</p>
          <p className={`font-display mt-4 max-w-4xl text-2xl leading-snug sm:text-3xl ${l.good ? "text-[#9df3b0]" : l.bad ? "text-[#ff8a7e]" : "text-white/90"}`}>{l.text}</p>
          {d && (
            <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06] sm:grid-cols-5">
              <Num k="launches · 48h" v={String(d.launches48h)} bad={d.launches48h >= 5} />
              <Num k="launches · 24h" v={String(d.launches24h)} />
              <Num k="dumped" v={String(d.dumped)} bad={d.dumped >= 2} />
              <Num k="usually dumps after" v={d.medianDumpMin === null ? "-" : t("{m} min", { m: d.medianDumpMin })} />
              <Num k="graduated" v={String(d.graduated)} />
            </div>
          )}
        </div>

        {d && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Box title="Its launches" note="last 48 hours · tap to x-ray">
              <div className="font-mono grid grid-cols-[minmax(0,1fr)_5rem_4rem_8rem] gap-3 border-b border-white/[0.07] pb-2 text-[10.5px] text-white/40">
                <span>{t("token")}</span>
                <span className="text-right">{t("buyers")}</span>
                <span className="text-right">{t("first 5 s")}</span>
                <span className="text-right">{t("what happened")}</span>
              </div>
              <div className="max-h-[440px] overflow-auto">
                {d.launches.map((x) => (
                  <button key={x.mint} type="button" onClick={() => onToken(x.mint)} className="font-mono grid w-full grid-cols-[minmax(0,1fr)_5rem_4rem_8rem] items-baseline gap-3 border-t border-white/[0.04] py-2 text-left text-[12px] transition first:border-t-0 hover:bg-white/[0.03]">
                    <span className="truncate text-white/85">
                      ${sym(x.symbol)} <span className="text-white/35">· {VENUE[x.venue] ?? x.venue} · {ago(x.createdAt)}</span>
                    </span>
                    <span className="text-right text-white/60">{x.buyers}</span>
                    <span className="text-right text-white/60">{x.early}</span>
                    <span className={`text-right ${x.dumpedAfterMin !== null ? "text-[#ff8a7e]" : x.graduated ? "text-white/85" : "text-white/50"}`}>
                      {x.dumpedAfterMin !== null ? t("dumped after {m} min", { m: x.dumpedAfterMin }) : x.graduated ? t("graduated") : t("dev holding")}
                    </span>
                  </button>
                ))}
              </div>
            </Box>
            <div className="space-y-4">
              <Box title="Who paid for this dev" note="traced on Solana">
                {!p.funding && <p className="text-[13px] font-light text-white/50">{t("Not traced yet. It is queued: open this again in a minute.")}</p>}
                {p.funding && !p.funding.funder && <p className="text-[13px] font-light text-white/50">{t("No funding transfer in the dev's recent history.")}</p>}
                {p.funding?.funder && (
                  <>
                    <div className="flex items-baseline justify-between gap-3 py-1">
                      <span className="text-[12.5px] font-light text-white/55">{t("funded by")}</span>
                      <WalletLink a={p.funding.funder} onWallet={onWallet} className="text-[13px] text-white/85" />
                    </div>
                    <p className="mt-1 text-[12.5px] font-light text-white/55">
                      {p.funding.funderIsHot ? t("An exchange or a router: it funds everyone, so it ties no one together.") : p.funding.siblings.length ? t("It paid for {n} other devs too, with {d} dumps between them in two days.", { n: p.funding.siblings.length, d: p.funding.siblingDumped48h }) : t("It paid for no other dev the zoo traced.")}
                    </p>
                  </>
                )}
              </Box>
              <Box title="Wallets that keep buying its launches" note="in their first 5 seconds">
                {!d.regulars.length ? (
                  <p className="text-[13px] font-light text-white/50">{t("No wallet bought two or more of its launches in the first seconds.")}</p>
                ) : (
                  <>
                    <p className="mb-2 text-[12px] font-light text-white/45">{t("A wallet in the first seconds of most of one dev's launches is usually that dev's own.")}</p>
                    {d.regulars.map((r) => (
                      <div key={r.wallet} className="flex items-baseline justify-between gap-3 border-t border-white/[0.05] py-1.5 text-[12px] first:border-t-0">
                        <WalletLink a={r.wallet} onWallet={onWallet} className="text-white/80" />
                        <span className={`font-mono ${r.launches >= Math.max(2, d.launches48h * 0.5) ? "text-[#ff8a7e]" : "text-white/55"}`}>{t("{n} of its {m} launches", { n: r.launches, m: d.launches48h })}</span>
                      </div>
                    ))}
                  </>
                )}
              </Box>
              {p.accounts.length > 0 && (
                <Box title="Accounts its tokens link to" note="from the tokens' metadata">
                  <p className="mb-2 text-[12px] font-light text-white/45">{t("Typed in by whoever launched the token: a lead to who is behind it, not proof.")}</p>
                  {p.accounts.map((a) => (
                    <div key={a.social.url} className="flex items-baseline justify-between gap-3 border-t border-white/[0.05] py-1.5 text-[12px] first:border-t-0">
                      <a href={a.social.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-white/80 hover:text-white">
                        {a.social.label} ↗
                      </a>
                      <span className={`font-mono shrink-0 ${a.fastDumps >= 2 ? "text-[#ff8a7e]" : "text-white/55"}`}>{t("{n} other launches · {d} fast dumps", { n: a.launches, d: a.fastDumps })}</span>
                    </div>
                  ))}
                </Box>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {p.sniper && (
            <Box title="As a first-second buyer" note="last 48 hours">
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06]">
                <Num k="launches sniped" v={String(p.sniper.snipes48h)} bad={p.sniper.snipes48h >= 10} />
                <Num k="sold out of" v={String(p.sniper.soldOut)} />
                <Num k="usually out after" v={secs(p.sniper.medianExitSec)} />
              </div>
              <p className="font-mono mb-1 mt-4 text-[10px] uppercase tracking-[0.14em] text-white/35">{t("whose launches it buys")}</p>
              {p.sniper.topCreators.map((c) => (
                <div key={c.creator} className="flex items-baseline justify-between gap-3 border-t border-white/[0.05] py-1.5 text-[12px] first:border-t-0">
                  <WalletLink a={c.creator} onWallet={onWallet} className="text-white/80" />
                  <span className="font-mono text-white/55">{c.launches === 1 ? t("1 launch") : t("{n} launches", { n: c.launches })}</span>
                </div>
              ))}
              <p className="font-mono mb-2 mt-4 text-[10px] uppercase tracking-[0.14em] text-white/35">{t("its latest snipes · tap to x-ray")}</p>
              <div className="flex flex-wrap gap-1.5">
                {p.sniper.recent.map((m) => (
                  <button key={m.mint} type="button" onClick={() => onToken(m.mint)} className="font-mono max-w-[10rem] truncate rounded-full px-2.5 py-1 text-[11px] text-white/70 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-white">
                    ${sym(m.symbol)}
                  </button>
                ))}
              </div>
            </Box>
          )}
          {(p.funded.creators.length > 0 || p.funded.hot) && (
            <Box title="Devs it paid for" note="traced on Solana">
              {p.funded.hot ? (
                <p className="text-[13px] font-light text-white/50">{t("An exchange or a router: it funds everyone, so it ties no one together.")}</p>
              ) : (
                p.funded.creators.map((c) => (
                  <div key={c.wallet} className="flex items-baseline justify-between gap-3 border-t border-white/[0.05] py-1.5 text-[12px] first:border-t-0">
                    <WalletLink a={c.wallet} onWallet={onWallet} className="text-white/80" />
                    <span className={`font-mono ${c.dumped >= 1 ? "text-[#ff8a7e]" : "text-white/55"}`}>{t("{l} launched · {d} dumped", { l: c.launches48h, d: c.dumped })}</span>
                  </div>
                ))
              )}
            </Box>
          )}
        </div>
        <p className="font-mono text-center text-[11px] text-white/40">
          {t("raw:")} <a href={`${NORTH}/v1/wallet/${wallet}`} className="underline decoration-white/25 underline-offset-4 hover:text-white">/v1/wallet/{short(wallet)}</a> · {t("Read from public chain data. Not financial advice.")}
        </p>
      </div>
    </motion.section>
  );
}
