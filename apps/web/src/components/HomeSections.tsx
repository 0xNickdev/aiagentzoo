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
            <p className="mt-3 text-[15px] leading-snug text-white/70">{k}</p>
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
        <p className="text-[15px] text-white/70">{t("A real one, from the last few hours")}</p>
        <h2 className="font-display mt-3 max-w-3xl text-[40px] font-semibold leading-[1.02] text-white sm:text-[64px]">
          {t("This is what the X-Ray sees.")} <span className="accent">{t("Before you buy.")}</span>
        </h2>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: EASE }}
          className="mt-12 overflow-hidden rounded-[28px] border border-white/[0.12] bg-[#0b0f0c]"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] px-6 py-5 sm:px-8">
            <div className="flex items-center gap-4">
              <span className="font-display text-[28px] text-white">${c.symbol || "?"}</span>
              <span className="font-mono hidden text-[13px] text-white/50 sm:inline">
                {c.mint.slice(0, 6)}…{c.mint.slice(-6)}
              </span>
            </div>
            <span className="rounded-full border border-[#ff8a7e]/40 bg-[#ff8a7e]/10 px-4 py-1.5 text-[14px] font-medium tracking-[0.08em] text-[#ff8a7e]">{t("AVOID")}</span>
          </div>
          <div className="grid grid-cols-2 border-b border-white/[0.08] lg:grid-cols-4">
            {stats.map(([v, k], i) => (
              <div key={k} className={`px-6 py-6 sm:px-8 ${i % 2 ? "border-l border-white/[0.08]" : ""} ${i > 1 ? "border-t border-white/[0.08] lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
                <p className="font-display text-[34px] font-medium tabular-nums text-white">{v}</p>
                <p className="mt-1 text-[14px] leading-snug text-white/65">{k}</p>
              </div>
            ))}
          </div>
          <ol className="divide-y divide-white/[0.08]">
            {c.reasons.slice(0, 4).map((r, i) => (
              <li key={r} className="flex gap-5 px-6 py-5 sm:px-8">
                <span className="font-mono mt-0.5 shrink-0 text-[14px] text-[#ff8a7e]">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[16px] leading-relaxed text-white/85">{tChain(r).replace(/^./, (x) => x.toUpperCase())}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.08] px-6 py-5 sm:px-8">
            <p className="text-[14px] text-white/60">{t("Every line is read from the chain. Nothing here is an opinion.")}</p>
            <a href={`/xray?mint=${c.mint}`} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-black hover:bg-white/90">
              {t("Open this X-Ray")} <ArrowRight size={15} />
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/** Three animals, three ways in: each one shows up once, big, with its job. */
export function Products() {
  const items = [
    { img: "/animals/builder.webp", who: t("The beaver"), name: t("X-Ray"), text: t("Paste any token on the site and read the dev, the first five seconds and the bundles in one page."), href: "/xray", cta: t("Open the X-Ray"), ext: false },
    { img: "/animals/sentinel.webp", who: t("The owl"), name: t("Telegram bot"), text: t("Paste a CA in any chat, or watch a token and get pinged when the dev dumps or the pool drains."), href: BOT_URL, cta: t("Open the bot"), ext: true },
    { img: "/animals/raven.webp", who: t("The raven"), name: t("Chrome extension"), text: t("The verdict right on gmgn, Axiom, pump.fun and DexScreener, and a tag next to every CA on X."), href: EXTENSION_URL, cta: t("Add to Chrome"), ext: true },
  ];
  return (
    <section className="relative px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-7xl">
        <h2 className="font-display max-w-3xl text-[40px] font-semibold leading-[1.02] text-white sm:text-[64px]">
          {t("Three ways in.")} <span className="accent">{t("Same answer.")}</span>
        </h2>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
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
              className="group relative flex flex-col overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#0b0f0c] p-7 transition-colors hover:border-white/25"
            >
              <div className="relative -mx-7 -mt-7 mb-6 flex h-56 items-end justify-center bg-[radial-gradient(60%_70%_at_50%_80%,rgba(120,160,130,0.16),transparent)]">
                <img src={p.img} alt={p.who} loading="lazy" className="max-h-[92%] w-auto max-w-[82%] object-contain transition-transform duration-700 group-hover:scale-[1.04]" />
              </div>
              <p className="text-[14px] text-white/60">{p.who}</p>
              <h3 className="font-display mt-1 text-[30px] font-medium text-white">{p.name}</h3>
              <p className="mt-2 flex-1 text-[16px] leading-relaxed text-white/75">{p.text}</p>
              <span className="mt-6 inline-flex items-center gap-2 text-[15px] text-white">
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
    { k: t("The radar"), v: t("Fresh coins with no red flags so far, and a ping the moment one turns. Coming in November.") },
    { k: t("A real vote"), v: t("Holders pick the order of what we build next. Signed votes, counted in public.") },
  ];
  return (
    <section className="relative px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-20">
        <div>
          <p className="text-[15px] text-white/70">$ZOOAGENCY</p>
          <h2 className="font-display mt-3 text-[40px] font-semibold leading-[1.02] text-white sm:text-[64px]">
            {t("The check is free.")} <span className="accent">{t("Holders see it first.")}</span>
          </h2>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-white/75">
            {t("61.5% of the token's creator fees buy it back and burn it, every buyback on the ClawPump page. From November, 10% of every swap fee joins them.")}
          </p>
          <div className="mt-7">
            <CAPill />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[14.5px]">
            <a href="https://dexscreener.com/solana/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B" target="_blank" rel="noopener noreferrer" className="text-white/75 hover:text-white">
              DexScreener ↗
            </a>
            <a href="https://solscan.io/token/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B" target="_blank" rel="noopener noreferrer" className="text-white/75 hover:text-white">
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
              <p className="text-[16px] leading-relaxed text-white/75">{p.v}</p>
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
        <span className="text-[14px] text-white/60">{t("Reads every launch and trade on")}</span>
        {reads.map((r) => (
          <span key={r} className="font-display text-[18px] font-medium text-white/85">
            {r}
          </span>
        ))}
        <span className="hidden h-5 w-px bg-white/15 md:block" />
        <a href="https://clawpump.tech" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-[14px] text-white/60 hover:text-white">
          {t("Launched on")}
          <img src="/clawpump.png" alt="ClawPump" className="h-6 w-auto" />
        </a>
        <span className="text-[14px] text-white/60">
          {t("Built on")} <span className="font-display text-[18px] font-medium text-white/85">Solana</span>
        </span>
      </div>
    </section>
  );
}
