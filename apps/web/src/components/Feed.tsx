import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { hue, initials, picOf } from "./home/live";
import { NODE_URLS } from "../sim/live";
import { t, tChain } from "../i18n";
import { FEE_BPS, landed, quote, SOL_MINT, swap, swapEnabled } from "../swap";
import { walletProvider } from "../zoo";
import { Page } from "./site/Panel";
import { oddsPct } from "./XRay/ui";
import NumberTicker from "./NumberTicker";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const EASE = [0.215, 0.61, 0.355, 1] as const;

interface Coin {
  mint: string;
  symbol: string;
  name: string;
  createdAt: number;
  image?: string;
  verdict: "pass" | "caution";
  /** Survival odds from the odds model, when the node sends them: the chance the coin is alive tomorrow. */
  odds?: { run: number } | null;
  reason: string | null;
  buyers: number;
  buys: number;
  sells: number;
  devSoldPct: number | null;
  curveSol: number | null;
  progress: number;
  capSol: number | null;
  /** The cap it had when the feed first showed it, and when. */
  shownCapSol?: number | null;
  shownAt?: number | null;
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
  { id: "migrated", title: "Migrated", note: "20+ buyers on the curve, 20+ SOL in the pool" },
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
/** A wallet step that never answers (a request left open in the wallet) ends here instead of hanging the button. */
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error("wallet-timeout")), ms))]);

function Buy({ coin, amount, onState }: { coin: Coin; amount: string; onState: (m: string | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sol = Number(amount);
    if (!Number.isFinite(sol) || sol <= 0) return onState(t("Set an amount in SOL first."));
    const w = walletProvider();
    if (!w) return onState(t("Install a Solana wallet such as Phantom, Jupiter or Solflare, then try again."));
    // Not connected: a wallet that already trusts the site reconnects silently (after a reload); otherwise the reader
    // connects first with the button at the top, and the buy works from then on.
    if (!w.publicKey) {
      try {
        await withTimeout((w.connect as (o?: { onlyIfTrusted: boolean }) => Promise<unknown>)({ onlyIfTrusted: true }), 3_000);
      } catch {
        /* not trusted yet */
      }
      if (!w.publicKey) return onState(t("Connect your wallet first: the button at the top right."));
    }
    setBusy(t("Routing…"));
    try {
      const owner = w.publicKey!.toString();
      setBusy(t("Routing…"));
      onState(t("Routing {s} SOL into ${sym}…", { s: amount, sym: coin.symbol }));
      const q = await quote(SOL_MINT, coin.mint, BigInt(Math.round(sol * 1e9)), 1500);
      setBusy(t("Confirm in wallet"));
      onState(t("Confirm the buy in your wallet."));
      const r = await withTimeout(swap(q, owner), 90_000);
      setBusy(t("Sent…"));
      onState(t("Sent. Waiting for the chain…"));
      const state = await landed(r.signature);
      onState(state === "confirmed" ? t("Bought ${sym}.", { sym: coin.symbol }) : state === "failed" ? t("The swap failed on chain. Nothing was bought.") : t("Sent, not confirmed yet. Check your wallet."));
    } catch (error) {
      const msg = (error as Error).message ?? "";
      onState(
        msg === "wallet-timeout"
          ? t("No answer from the wallet. Open it: a request may be waiting there.")
          : /reject|denied|cancel/i.test(msg)
            ? t("Cancelled in the wallet.")
            : /route|COULD_NOT_FIND|no route/i.test(msg)
              ? t("Jupiter has no route for this coin yet. Try again in a minute.")
              : t("The buy did not go through: {m}", { m: msg.slice(0, 80) }),
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <button type="button" onClick={go} disabled={busy !== null} className="btn-primary h-8 shrink-0 rounded-[7px] px-3 text-[12.5px] font-medium disabled:opacity-50">
      {busy ?? t("Buy {s}", { s: amount })}
    </button>
  );
}

/** The coin's picture, a small pump.fun thumbnail where there is one, over its first letters so a missing picture is never a blank square. */
function Pic({ c }: { c: Coin }) {
  const [broken, setBroken] = useState(false);
  const src = picOf(c.mint, c.image ?? undefined);
  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[13px] font-semibold text-white" style={{ background: `hsl(${hue(c.mint)} 14% 15%)` }}>
      {initials(c.symbol, c.mint)}
      {src && !broken && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full rounded-lg object-cover" />}
    </span>
  );
}

function Row({ c, solUsd, amount, onState }: { c: Coin; solUsd: number | null; amount: string; onState: (m: string | null) => void }) {
  const pass = c.verdict === "pass";
  const capUsd = c.capSol !== null && solUsd ? c.capSol * solUsd : null;
  // The cap it first showed up at: the reference once it has moved. Left out while it still reads the same.
  const shownUsd = c.shownCapSol != null && solUsd ? c.shownCapSol * solUsd : null;
  const moved = shownUsd !== null && (capUsd === null || usd(shownUsd) !== usd(capUsd));
  return (
    <motion.a
      layout
      href={`/xray?mint=${c.mint}`}
      onClick={() => {
        try {
          sessionStorage.setItem("zoo-back", "/feed");
        } catch {
          /* no back link then */
        }
      }}
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="group block border-b border-line px-3.5 py-3 transition last:border-b-0 hover:bg-night-raised"
    >
      <div className="flex items-center gap-3">
        <Pic c={c} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-white">
            ${c.symbol.replace(/^\$/, "")} <span className="text-[12.5px] font-normal text-dim">{c.name}</span>
          </p>
          <p className="mt-0.5 truncate text-[12px] text-dim">
            {age(c.createdAt)} · {capUsd !== null && (
              <>
                <NumberTicker value={capUsd} format={usd} className="text-white" />
                {" · "}
              </>
            )}
            {c.graduated && c.poolSol !== null ? `${t("pool {s} SOL", { s: c.poolSol < 10 ? c.poolSol.toFixed(1) : Math.round(c.poolSol) })} · ` : ""}
            {t("{n} buyers", { n: c.buyers })}
            {c.devSoldPct !== null ? ` · ${t("dev sold {p}%", { p: c.devSoldPct })}` : ""}
          </p>
        </div>
        {swapEnabled() && <Buy coin={c} amount={amount} onState={onState} />}
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <span className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[4px] border px-1.5 text-[11.5px] font-medium ${pass ? "border-lit-edge text-lit" : "border-[#4a3a22] text-warn"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${pass ? "bg-lit" : "bg-warn"}`} />
          {pass ? t("no red flags") : t("caution")}
          {c.odds && Number.isFinite(c.odds.run) ? <span className="font-normal text-fg-2">· {t("{p}% alive tomorrow", { p: oddsPct(c.odds.run) })}</span> : null}
        </span>
        {!c.graduated && (
          <span className="h-[3px] flex-1 overflow-hidden rounded-sm bg-night-raised" title={t("bonding curve")}>
            <span className="block h-full bg-[#59605c]" style={{ width: `${Math.round(c.progress * 100)}%` }} />
          </span>
        )}
        {c.graduated && <span className="flex-1 truncate text-[11.5px] text-dim">{t("graduated")}</span>}
        {moved && <span className="shrink-0 text-[11.5px] text-faint">{t("first seen at {c}", { c: usd(shownUsd!) })}</span>}
      </div>
      {!pass && c.reason && <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-fg-2">{tChain(c.reason)}</p>}
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

  const seg = (on: boolean) => `h-7 rounded-[5px] px-2.5 transition ${on ? "bg-night-raised text-white" : "text-dim hover:text-white"}`;
  return (
    <Page
      title={t("Every new coin. Minus the known scams.")}
      lead={t("New, almost graduated and migrated. Every coin is checked as it trades: the dev's record, the first-second wallets, bundles, who already sold. Anything the check calls avoid never makes it here.")}
      side={
        <>
          <span className="flex items-center gap-2 text-[12px] text-dim">
            <span className={`h-1.5 w-1.5 rounded-full ${data?.stream.live ? "animate-pulse bg-lit" : "bg-warn"}`} />
            {t("Live feed · fresh Solana launches · avoid is never shown")}
          </span>
          <div className="flex rounded-[7px] border border-line p-0.5 text-[12px]">
            <button type="button" onClick={() => (setStrict(false), keep("zoo-feed-strict", "0"))} className={seg(!strict)}>
              {t("no red flags + caution")}
            </button>
            <button type="button" onClick={() => (setStrict(true), keep("zoo-feed-strict", "1"))} className={seg(strict)}>
              {t("no red flags only")}
            </button>
          </div>
          {swapEnabled() && (
            <label className="flex h-8 items-center gap-2 rounded-[7px] border border-line px-2.5 text-[12px] text-dim focus-within:border-lit-edge">
              {t("quick buy")}
              <input
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, "").slice(0, 6);
                  setAmount(v);
                  keep("zoo-feed-amount", v);
                }}
                inputMode="decimal"
                aria-label={t("quick buy")}
                className="w-12 bg-transparent text-right text-white outline-none"
              />
              SOL
            </label>
          )}
        </>
      }
    >
      <div className="mb-3 flex gap-1 lg:hidden">
        {BOARDS.map((b) => (
          <button key={b.id} type="button" onClick={() => setTab(b.id)} className={`flex h-8 items-center gap-1.5 rounded-[7px] border px-3 text-[12.5px] transition ${tab === b.id ? "border-line-2 bg-night-raised text-white" : "border-line text-dim"}`}>
            {t(b.title)} <span className="text-faint">{data ? listOf(b.id).length : ""}</span>
          </button>
        ))}
      </div>

      {failed && !data && <p className="mb-3 text-[12.5px] text-warn">{t("The chain reader did not answer. Try again in a minute.")}</p>}

      <div className="grid gap-3 lg:grid-cols-3">
        {BOARDS.map((b) => {
          const list = listOf(b.id);
          return (
            <section key={b.id} className={`${tab === b.id ? "flex" : "hidden"} min-w-0 flex-col rounded-[12px] border border-line bg-night-surface lg:flex`}>
              <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
                <h2 className="text-[13px] font-medium text-white">{t(b.title)}</h2>
                <span className="text-[11.5px] text-faint">{data ? list.length : ""}</span>
                <span className="ml-auto min-w-0 truncate text-[11.5px] text-faint">{t(b.note)}</span>
              </div>
              <div className="flex max-h-[76vh] min-h-[200px] flex-col overflow-y-auto">
                <AnimatePresence initial={false}>
                  {list.map((c) => (
                    <Row key={c.mint} c={c} solUsd={data?.solUsd ?? null} amount={amount} onState={setState} />
                  ))}
                </AnimatePresence>
                {data && !list.length && <p className="px-3.5 py-8 text-center text-[12.5px] text-faint">{t("Nothing here right now that the check lets through.")}</p>}
                {!data && !failed && Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[78px] animate-pulse border-b border-line bg-night-raised/40" />)}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-3 max-w-[90ch] text-[12px] leading-[1.6] text-dim">{t("No red flags means the known rug signs are not there, not that the coin goes up. Most fresh coins die either way. The quick buy routes through Jupiter with your own wallet; a {p}% fee goes to the zoo. Not financial advice.", { p: (FEE_BPS / 100).toString() })}</p>

      <AnimatePresence>
        {state && (
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed bottom-5 left-1/2 z-50 max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-[9px] border border-line-2 bg-night-raised px-4 py-2.5 text-[12.5px] text-white shadow-lg">
            {state}
          </motion.p>
        )}
      </AnimatePresence>
    </Page>
  );
}
