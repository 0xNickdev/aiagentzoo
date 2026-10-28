import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { t, tChain } from "../i18n";
import { landed, quote, SOL_MINT, swap, swapEnabled } from "../swap";
import { walletProvider } from "../zoo";
import { Section } from "./ui";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const EASE = [0.215, 0.61, 0.355, 1] as const;

interface Coin {
  mint: string;
  symbol: string;
  name: string;
  createdAt: number;
  image?: string;
  verdict: "pass" | "caution";
  score: number | null;
  reason: string | null;
  buyers: number;
  buys: number;
  sells: number;
  devSoldPct: number | null;
  curveSol: number | null;
  progress: number;
  capSol: number | null;
  poolSol: number | null;
  graduated: boolean;
}
interface FeedBody {
  stream: { live: boolean };
  solUsd: number | null;
  new: Coin[];
  soon: Coin[];
  migrated: Coin[];
}
type Board = "new" | "soon" | "migrated";

const BOARDS: Array<{ id: Board; title: string; note: string }> = [
  { id: "new", title: "New", note: "the last ten minutes" },
  { id: "soon", title: "Soon", note: "a third of the curve or more" },
  { id: "migrated", title: "Migrated", note: "on PumpSwap, 20+ SOL in the pool" },
];

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const age = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
const read = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const keep = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private window: the choice lasts the visit */
  }
};

/** The 1-click buy: a Jupiter route for the amount set above the boards, signed by the reader's wallet. */
function Buy({ coin, amount, onState }: { coin: Coin; amount: string; onState: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const go = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sol = Number(amount);
    if (!Number.isFinite(sol) || sol <= 0) return onState(t("Set an amount in SOL first."));
    const w = walletProvider();
    if (!w) return onState(t("Install a Solana wallet such as Phantom, Jupiter or Solflare, then try again."));
    setBusy(true);
    try {
      const owner = w.publicKey?.toString() ?? (await w.connect()).publicKey.toString();
      onState(t("Routing {s} SOL into ${sym}…", { s: amount, sym: coin.symbol }));
      const q = await quote(SOL_MINT, coin.mint, BigInt(Math.round(sol * 1e9)), 1500);
      const r = await swap(q, owner);
      onState(t("Sent. Waiting for the chain…"));
      const state = await landed(r.signature);
      onState(state === "confirmed" ? t("Bought ${sym}.", { sym: coin.symbol }) : state === "failed" ? t("The swap failed on chain. Nothing was bought.") : t("Sent, not confirmed yet. Check your wallet."));
    } catch (error) {
      const msg = (error as Error).message ?? "";
      onState(/reject|denied|cancel/i.test(msg) ? t("Cancelled in the wallet.") : t("No route right now. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={go} disabled={busy} className="tabular-nums shrink-0 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-black transition hover:bg-white/90 disabled:opacity-50">
      {busy ? "…" : t("Buy {s}", { s: amount })}
    </button>
  );
}

function Row({ c, solUsd, amount, onState }: { c: Coin; solUsd: number | null; amount: string; onState: (m: string | null) => void }) {
  const pass = c.verdict === "pass";
  const cap = c.capSol !== null && solUsd ? usd(c.capSol * solUsd) : null;
  return (
    <motion.a
      layout
      href={`/xray?mint=${c.mint}`}
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="group block rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 transition hover:border-white/[0.16] hover:bg-white/[0.04]"
    >
      <div className="flex items-center gap-3">
        {c.image ? (
          <img src={c.image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-lg bg-white/[0.06]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] text-white">
            ${c.symbol.replace(/^\$/, "")} <span className="text-[12.5px] text-fg-4">{c.name}</span>
          </p>
          <p className="tabular-nums mt-0.5 truncate text-[12px] text-fg-3">
            {age(c.createdAt)} · {cap ? `${cap} · ` : ""}
            {c.graduated && c.poolSol !== null ? `${t("pool {s} SOL", { s: c.poolSol < 10 ? c.poolSol.toFixed(1) : Math.round(c.poolSol) })} · ` : ""}
            {t("{n} buyers", { n: c.buyers })}
            {c.devSoldPct !== null ? ` · ${t("dev sold {p}%", { p: c.devSoldPct })}` : ""}
          </p>
        </div>
        {swapEnabled() && <Buy coin={c} amount={amount} onState={onState} />}
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <span className={`tabular-nums shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${pass ? "bg-[#a6e3b4]/[0.12] text-[#a6e3b4]" : "bg-[#ffc27a]/[0.12] text-[#ffc27a]"}`}>
          {pass ? t("no red flags") : t("caution")}
          {c.score !== null ? ` · ${c.score}` : ""}
        </span>
        {!c.graduated && (
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <span className="block h-full rounded-full bg-white/50" style={{ width: `${Math.round(c.progress * 100)}%` }} />
          </span>
        )}
        {c.graduated && <span className="flex-1 truncate text-[11.5px] text-fg-4">{t("graduated")}</span>}
      </div>
      {!pass && c.reason && <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-fg-3">{tChain(c.reason)}</p>}
    </motion.a>
  );
}

/**
 * pump.fun's three boards, new, soon and migrated, with every coin the check calls avoid taken out. Coins come and
 * go as the tape reads them; a tap opens the full x-ray, the button buys through Jupiter with the reader's wallet.
 */
export default function Feed() {
  const [data, setData] = useState<FeedBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [strict, setStrict] = useState(() => read("zoo-feed-strict", "0") === "1");
  const [amount, setAmount] = useState(() => read("zoo-feed-amount", "0.1"));
  const [tab, setTab] = useState<Board>("new");
  const [state, setState] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`${NORTH}/v1/chain/feed`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((b: FeedBody) => live && (setData(b), setFailed(false)))
        .catch(() => live && setFailed(true));
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 4_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!state) return;
    const h = window.setTimeout(() => setState(null), 6_000);
    return () => window.clearTimeout(h);
  }, [state]);

  const listOf = (b: Board) => (data?.[b] ?? []).filter((c) => !strict || c.verdict === "pass");

  return (
    <Section className="!pt-28 sm:!pt-36">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="tabular-nums flex items-center gap-2 text-[12.5px] text-fg-3">
            <span className={`h-[7px] w-[7px] rounded-full ${data?.stream.live ? "animate-pulse bg-[#a6e3b4]" : "bg-[#ffc27a]"}`} />
            {t("Live feed · pump.fun · avoid is never shown")}
          </p>
          <h1 className="font-display mt-4 text-4xl leading-[1.05] sm:text-5xl">{t("pump.fun, without the known scams.")}</h1>
          <p className="mt-4 text-[15px] font-normal leading-relaxed text-fg-3">{t("The same three boards as pump.fun. Every coin is checked as it trades: the dev's record, the first-second wallets, bundles, who already sold. Anything the check calls avoid never makes it here.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-full border border-white/[0.12] p-1 text-[13px]">
            <button type="button" onClick={() => (setStrict(false), keep("zoo-feed-strict", "0"))} className={`rounded-full px-3.5 py-1.5 transition ${!strict ? "bg-white text-black" : "text-fg-3 hover:text-white"}`}>
              {t("no red flags + caution")}
            </button>
            <button type="button" onClick={() => (setStrict(true), keep("zoo-feed-strict", "1"))} className={`rounded-full px-3.5 py-1.5 transition ${strict ? "bg-white text-black" : "text-fg-3 hover:text-white"}`}>
              {t("no red flags only")}
            </button>
          </div>
          {swapEnabled() && (
            <label className="tabular-nums flex items-center gap-2 rounded-full border border-white/[0.12] px-3.5 py-1.5 text-[13px] text-fg-3">
              {t("quick buy")}
              <input
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, "").slice(0, 6);
                  setAmount(v);
                  keep("zoo-feed-amount", v);
                }}
                inputMode="decimal"
                className="w-12 bg-transparent text-right text-white outline-none"
              />
              SOL
            </label>
          )}
        </div>
      </div>

      <div className="mt-8 flex gap-2 lg:hidden">
        {BOARDS.map((b) => (
          <button key={b.id} type="button" onClick={() => setTab(b.id)} className={`tabular-nums rounded-full px-4 py-2 text-[13.5px] transition ${tab === b.id ? "bg-white text-black" : "border border-white/[0.12] text-fg-3"}`}>
            {t(b.title)} {data ? listOf(b.id).length : ""}
          </button>
        ))}
      </div>

      {failed && !data && <p className="mt-10 text-[14px] text-fg-3">{t("The chain reader did not answer. Try again in a minute.")}</p>}

      <div className="mt-6 grid gap-5 lg:mt-10 lg:grid-cols-3">
        {BOARDS.map((b) => {
          const list = listOf(b.id);
          return (
            <div key={b.id} className={`${tab === b.id ? "block" : "hidden"} min-w-0 lg:block`}>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <p className="text-[16px] text-white">
                  {t(b.title)} <span className="tabular-nums text-fg-4">{data ? list.length : ""}</span>
                </p>
                <p className="text-[12px] text-fg-4">{t(b.note)}</p>
              </div>
              <div className="flex max-h-[78vh] flex-col gap-2 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {list.map((c) => (
                    <Row key={c.mint} c={c} solUsd={data?.solUsd ?? null} amount={amount} onState={setState} />
                  ))}
                </AnimatePresence>
                {data && !list.length && <p className="px-1 py-6 text-[13px] text-fg-4">{t("Nothing here right now that the check lets through.")}</p>}
                {!data && !failed && Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[86px] animate-pulse rounded-xl bg-white/[0.03]" />)}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-8 max-w-3xl text-[12.5px] leading-relaxed text-fg-4">{t("No red flags means the known rug signs are not there, not that the coin goes up. Most fresh coins die either way. The quick buy routes through Jupiter with your own wallet; a 1% fee goes to the zoo. Not financial advice.")}</p>

      <AnimatePresence>
        {state && (
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/[0.12] bg-[#0b0f0d] px-5 py-2.5 text-[13px] text-white shadow-lg">
            {state}
          </motion.p>
        )}
      </AnimatePresence>
    </Section>
  );
}
