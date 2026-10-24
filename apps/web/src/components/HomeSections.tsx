import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { t, tChain } from "../i18n";
import { CAPill } from "./TokenAddress";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
export const EXTENSION_URL = "https://chromewebstore.google.com/detail/zooai-x-ray/jbkieaokkiiajaeclogolieicogbkndl";
const BOT_URL = "https://t.me/zooaiagency_bot";
const EASE = [0.215, 0.61, 0.355, 1] as const;

const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString("en-US"));

function useNorth<T>(path: string): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (!NORTH) return;
    const load = () =>
      fetch(`${NORTH}${path}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: T | null) => b && setV(b))
        .catch(() => {});
    load();
    const id = window.setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [path]);
  return v;
}

/** Four numbers straight from the nodes, set big: the chain we read, and what people do with it. */
export function NumbersBand() {
  const chain = useNorth<{ seen: { launches: number; trades: number; launchlab?: number; dbc?: number } }>("/v1/chain");
  const usage = useNorth<{ days: Array<{ xrays: number; checks: number }> }>("/v1/usage");
  const rec = useNorth<{ flaggedAvoid: { n: number } }>("/v1/check/record");
  const sum = (k: "xrays" | "checks") => (usage ? usage.days.reduce((s, d) => s + d[k], 0) : null);
  const cells: Array<[string | null, string]> = [
    [chain ? compact(chain.seen.trades) : null, t("trades read from Solana")],
    [chain ? compact(chain.seen.launches + (chain.seen.launchlab ?? 0) + (chain.seen.dbc ?? 0)) : null, t("launches watched")],
    [rec ? compact(rec.flaggedAvoid.n) : null, t("launches flagged avoid, last 24h")],
    [sum("checks") != null ? compact((sum("checks") ?? 0) + (sum("xrays") ?? 0)) : null, t("checks people ran this week")],
  ];
  return (
    <section className="relative border-y border-white/[0.08] bg-[#070a08] px-5 sm:px-8">
      <div className="mx-auto grid max-w-7xl grid-cols-2 lg:grid-cols-4">
        {cells.map(([v, k], i) => (
          <motion.div
            key={k}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: i * 0.08, ease: EASE }}
            className={`py-10 pr-4 sm:py-14 ${i % 2 ? "pl-5 sm:pl-8" : ""} ${i > 0 ? "lg:border-l lg:border-white/[0.08] lg:pl-8" : ""} ${i > 1 ? "border-t border-white/[0.08] lg:border-t-0" : ""}`}
          >
            <p className="font-display text-[44px] font-medium leading-none tabular-nums text-white sm:text-[64px]">{v ?? "-"}</p>
            <p className="mt-3 text-[15px] leading-snug text-fg-3">{k}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

interface CheckResult {
  mint: string;
  symbol?: string;
  verdict: string;
  reasons: string[];
  facts: { buyers?: number; creatorLaunches24h?: number; creatorDumped48h?: number; bundlersPeakPct?: number; curveSol?: number; poolSol?: number | null };
}

/** A real rug from the last hours, laid out as the x-ray reads it: the verdict, the numbers, and why, line by line. */
export function XRayShowcase() {
  const [c, setC] = useState<CheckResult | null>(null);
  useEffect(() => {
    if (!NORTH) return;
    (async () => {
      try {
        const r = await fetch(`${NORTH}/v1/chain/moments?kind=drained&limit=12`);
        const { moments } = (await r.json()) as { moments: Array<{ mint: string }> };
        const seen = new Set<string>();
        for (const m of moments) {
          if (seen.has(m.mint)) continue;
          seen.add(m.mint);
          const x = (await (await fetch(`${NORTH}/v1/check/${m.mint}`)).json()) as CheckResult;
          // A rug with real people on the other side, not a dev trading with themselves.
          if (x.verdict === "avoid" && (x.facts.buyers ?? 0) >= 40 && x.reasons.length >= 3) return setC({ ...x, mint: m.mint });
        }
      } catch {
        /* the section stays empty rather than showing a made-up example */
      }
    })();
  }, []);
  if (!c) return null;
  const f = c.facts;
  const stats: Array<[string, string]> = [
    [f.buyers != null ? f.buyers.toLocaleString("en-US") : "-", t("people bought it")],
    [f.creatorDumped48h != null ? String(f.creatorDumped48h) : "-", t("launches this dev dumped, 48h")],
    [f.bundlersPeakPct != null ? `${Math.round(f.bundlersPeakPct)}%` : "-", t("of supply held by bundles at the peak")],
    [f.poolSol != null && f.curveSol ? `${Math.round(f.curveSol)} → ${f.poolSol < 1 ? f.poolSol.toFixed(2) : Math.round(f.poolSol)}` : "-", t("SOL in the pool, graduation to now")],
  ];
  return (
    <section className="relative px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-7xl">
        <p className="text-[15px] text-fg-3">{t("A real one, from the last few hours")}</p>
        <h2 className="font-display mt-3 max-w-3xl text-[40px] font-semibold leading-[1.02] text-white sm:text-[64px]">
          {t("This is what the X-Ray sees.")} <span className="accent">{t("Before you buy.")}</span>
        </h2>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: EASE }}
          className="mt-12 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0b0f0c]"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] px-6 py-5 sm:px-8">
            <div className="flex items-center gap-4">
              <span className="font-display text-[28px] text-white">${c.symbol || "?"}</span>
              <span className="tabular-nums hidden text-[13px] text-fg-4 sm:inline">
                {c.mint.slice(0, 6)}…{c.mint.slice(-6)}
              </span>
            </div>
            <span className="rounded-full border border-[#ff8a7e]/40 bg-[#ff8a7e]/10 px-4 py-1.5 text-[14px] font-medium tracking-[0.08em] text-[#ff8a7e]">{t("AVOID")}</span>
          </div>
          <div className="grid grid-cols-2 border-b border-white/[0.08] lg:grid-cols-4">
            {stats.map(([v, k], i) => (
              <div key={k} className={`px-6 py-6 sm:px-8 ${i % 2 ? "border-l border-white/[0.08]" : ""} ${i > 1 ? "border-t border-white/[0.08] lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
                <p className="font-display text-[34px] font-medium tabular-nums text-white">{v}</p>
                <p className="mt-1 text-[14px] leading-snug text-fg-3">{k}</p>
              </div>
            ))}
          </div>
          <ol className="divide-y divide-white/[0.08]">
            {c.reasons.slice(0, 4).map((r, i) => (
              <li key={r} className="flex gap-5 px-6 py-5 sm:px-8">
                <span className="tabular-nums mt-0.5 shrink-0 text-[14px] text-[#ff8a7e]">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[16px] leading-relaxed text-fg-2">{tChain(r).replace(/^./, (x) => x.toUpperCase())}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.08] px-6 py-5 sm:px-8">
            <p className="text-[14px] text-fg-4">{t("Every line is read from the chain. Nothing here is an opinion.")}</p>
            <a href={`/xray?mint=${c.mint}`} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-black hover:bg-white/90">
              {t("Open this X-Ray")} <ArrowRight size={15} />
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

const ICONS = {
  xray: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[21px] w-[21px]">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="1.2" fill="#fff" />
      <path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0" />
    </svg>
  ),
  telegram: (
    <svg viewBox="0 0 24 24" fill="#fff" className="h-[21px] w-[21px]">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  ),
  chrome: (
    <svg viewBox="0 0 24 24" fill="#fff" className="h-[21px] w-[21px]">
      <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z" />
    </svg>
  ),
};

/** Three ways in, same answer: the site, the bot, the extension. */
export function Products() {
  const items = [
    { icon: ICONS.xray, name: t("X-Ray on the site"), text: t("The full record: the dev's launches and dumps, early wallets, bundles, who funded them, the network map."), href: "/xray", cta: t("Open the X-Ray"), ext: false },
    { icon: ICONS.telegram, name: t("Telegram bot"), text: t("Send a contract, get the verdict and the reasons. Works in groups with /xray and /dev, and pings you when a coin you watch turns."), href: BOT_URL, cta: t("Open the bot"), ext: true },
    { icon: ICONS.chrome, name: t("Chrome extension"), text: t("The verdict right on gmgn, Axiom, pump.fun and DexScreener, and a tag next to every CA on X."), href: EXTENSION_URL, cta: t("Add to Chrome"), ext: true },
  ];
  return (
    <section className="relative px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-7xl">
        <p className="text-[15px] text-[#a3aaa6]">{t("Same check, wherever you trade")}</p>
        <h2 className="font-display mt-3 max-w-3xl text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-[60px]">
          {t("One X-Ray. Three places to run it.")}
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {items.map((p, i) => (
            <motion.a
              key={p.name}
              href={p.href}
              target={p.ext ? "_blank" : undefined}
              rel={p.ext ? "noopener noreferrer" : undefined}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: i * 0.1, ease: EASE }}
              className="group flex flex-col rounded-2xl border border-white/[0.08] bg-[#0a0e0c] p-6 transition-colors hover:border-white/25"
            >
              <div className="flex items-center gap-3.5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.12] bg-[linear-gradient(180deg,#1b211e,#0c100e)] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_20px_rgba(0,0,0,0.4)]">
                  {p.icon}
                </span>
                <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-white">{p.name}</h3>
              </div>
              <p className="mt-4 flex-1 text-[15.5px] leading-relaxed text-[#d9dddb]">{p.text}</p>
              <span className="mt-5 inline-flex items-center gap-2 text-[14.5px] font-medium text-white">
                {p.cta} <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
              </span>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Why hold: the check stays free for everyone; holders hear first and decide what gets built. */
export function Holders() {
  const perks = [
    { k: t("Hear it first"), v: t("Alerts on the coins you watch land at once for holders, later for everyone else.") },
    { k: t("The radar"), v: t("Fresh coins with no red flags so far, re-checked all the time, and the moment one turns it goes red. Open now at /radar.") },
    { k: t("A real vote"), v: t("Holders pick the order of what we build next. Signed votes, counted in public.") },
  ];
  return (
    <section className="relative px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-20">
        <div>
          <p className="text-[15px] text-fg-3">$ZOOAGENCY</p>
          <h2 className="font-display mt-3 text-[40px] font-semibold leading-[1.02] text-white sm:text-[64px]">
            {t("The check is free.")} <span className="accent">{t("Holders see it first.")}</span>
          </h2>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-fg-3">
            {t("61.5% of the token's creator fees buy it back and burn it, every buyback on the ClawPump page. From November, 10% of every swap fee joins them.")}
          </p>
          <div className="mt-7">
            <CAPill />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[14.5px]">
            <a href="https://dexscreener.com/solana/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B" target="_blank" rel="noopener noreferrer" className="text-fg-3 hover:text-white">
              DexScreener ↗
            </a>
            <a href="https://solscan.io/token/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B" target="_blank" rel="noopener noreferrer" className="text-fg-3 hover:text-white">
              Solscan ↗
            </a>
          </div>
          <a
            href="https://clawpump.tech/tokens/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-7 inline-flex items-center gap-2 text-[15px] text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
          >
            {t("See every buyback")} <ArrowRight size={15} />
          </a>
        </div>
        <div className="border-t border-white/[0.12]">
          {perks.map((p) => (
            <div key={p.k} className="grid gap-2 border-b border-white/[0.12] py-7 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-8">
              <p className="font-display text-[22px] text-white">{p.k}</p>
              <p className="text-[16px] leading-relaxed text-fg-3">{p.v}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** What the zoo reads and where it lives, said plainly under the hero. */
export function TrustStrip() {
  const reads = ["pump.fun", "PumpSwap", "Raydium LaunchLab", "Meteora"];
  return (
    <section className="relative border-t border-white/[0.08] bg-[#050706] px-5 py-6 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-10 gap-y-4">
        <span className="text-[14px] text-fg-4">{t("Reads every launch and trade on")}</span>
        {reads.map((r) => (
          <span key={r} className="font-display text-[18px] font-medium text-fg-2">
            {r}
          </span>
        ))}
        <span className="hidden h-5 w-px bg-white/15 md:block" />
        <a href="https://clawpump.tech" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-[14px] text-fg-4 hover:text-white">
          {t("Launched on")}
          <img src="/clawpump.png" alt="ClawPump" className="h-6 w-auto" />
        </a>
        <span className="text-[14px] text-fg-4">
          {t("Built on")} <span className="font-display text-[18px] font-medium text-fg-2">Solana</span>
        </span>
      </div>
    </section>
  );
}
