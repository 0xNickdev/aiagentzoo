import { useEffect, useState } from "react";
import { t } from "../i18n";
import { balanceOf, decimalsOf, FEE_BPS, feeLamports, landed, quote, SOL_MINT, swap, swapEnabled, type Quote } from "../swap";
import { walletProvider } from "../zoo";

/**
 * Buy or sell the coin under its verdict, through Jupiter, signed by the reader's own wallet. A fee of FEE_BPS of
 * the SOL side goes to the zoo's treasury in the same transaction; a tenth of it buys $ZOOAGENCY back.
 */
export default function Swap({ mint, symbol }: { mint: string; symbol: string }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.1");
  const [q, setQ] = useState<Quote | null>(null);
  const [dec, setDec] = useState(6);
  const [wallet, setWallet] = useState<string | null>(walletProvider()?.publicKey?.toString() ?? null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<"quote" | "sign" | "wait" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sig: string; state: "confirmed" | "failed" | "unknown" | "sent" } | null>(null);

  const inMint = side === "buy" ? SOL_MINT : mint;
  const outMint = side === "buy" ? mint : SOL_MINT;
  const sym = symbol.replace(/^\$/, "") || "token";

  useEffect(() => {
    void decimalsOf(mint).then(setDec).catch(() => null);
  }, [mint]);
  useEffect(() => {
    if (!wallet) return void setBalance(null);
    void balanceOf(wallet, inMint).then(setBalance).catch(() => setBalance(null));
  }, [wallet, inMint, done]);

  // A fresh quote whenever the side or the amount changes, a moment after typing stops.
  useEffect(() => {
    const n = Number(amount);
    setQ(null);
    setError(null);
    if (!Number.isFinite(n) || n <= 0) return;
    const raw = BigInt(Math.round(n * 10 ** (side === "buy" ? 9 : dec)));
    const id = setTimeout(() => {
      setBusy("quote");
      quote(inMint, outMint, raw)
        .then((r) => setQ(r))
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(null));
    }, 350);
    return () => clearTimeout(id);
  }, [amount, side, inMint, outMint, dec]);

  const fmt = (raw: string, d: number) => {
    const v = Number(raw) / 10 ** d;
    return v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toLocaleString("en-US", { maximumFractionDigits: v >= 1 ? 3 : 5 });
  };

  const connect = async () => {
    const p = walletProvider();
    if (!p) {
      window.open("https://phantom.com/download", "_blank", "noopener");
      return setError(t("Install a Solana wallet such as Phantom, then try again."));
    }
    try {
      const { publicKey } = await p.connect();
      setWallet(publicKey.toString());
    } catch (e) {
      setError((e as Error).message || t("Connection was cancelled."));
    }
  };

  const go = async () => {
    if (!q) return;
    if (!wallet) return void connect();
    setError(null);
    setDone(null);
    try {
      setBusy("sign");
      const { signature } = await swap(q, wallet);
      setDone({ sig: signature, state: "sent" });
      setBusy("wait");
      const state = await landed(signature);
      setDone({ sig: signature, state });
    } catch (e) {
      setError((e as Error).message || t("The wallet did not sign."));
    } finally {
      setBusy(null);
    }
  };

  if (!swapEnabled()) return null;
  const fee = q ? Number(feeLamports(q)) / 1e9 : 0;
  const tab = (k: "buy" | "sell", label: string) => (
    <button key={k} type="button" onClick={() => setSide(k)} className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] transition ${side === k ? "bg-white/[0.1] text-white" : "text-fg-3 hover:text-white"}`}>
      {label}
    </button>
  );
  return (
    <div className="mt-4 min-w-0 max-w-full border-t border-white/[0.08] pt-3">
      <p className="text-[11.5px] text-fg-4">{t("trade it here")}</p>
      <div className="mt-2 flex gap-1 rounded-xl border border-white/[0.08] p-1">{[tab("buy", t("Buy")), tab("sell", t("Sell"))]}</div>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2">
        <input
          inputMode="decimal"
          size={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-label={side === "buy" ? t("SOL to spend") : t("{s} to sell", { s: sym })}
          className="tabular-nums w-full min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none"
        />
        <span className="text-[12.5px] text-fg-3">{side === "buy" ? "SOL" : sym}</span>
      </div>
      {side === "buy" ? (
        <div className="mt-1.5 flex gap-1.5">
          {["0.1", "0.5", "1"].map((v) => (
            <button key={v} type="button" onClick={() => setAmount(v)} className="rounded-md border border-white/[0.1] px-2 py-0.5 text-[11.5px] text-fg-3 transition hover:border-white/30 hover:text-white">
              {v}
            </button>
          ))}
          {balance !== null && <span className="tabular-nums ml-auto self-center text-[11.5px] text-fg-4">{t("balance {n}", { n: balance.toLocaleString("en-US", { maximumFractionDigits: 3 }) })}</span>}
        </div>
      ) : (
        balance !== null && (
          <div className="mt-1.5 flex gap-1.5">
            {[25, 50, 100].map((p) => (
              <button key={p} type="button" onClick={() => setAmount(String(Math.floor((balance * p) / 100 * 10 ** dec) / 10 ** dec))} className="rounded-md border border-white/[0.1] px-2 py-0.5 text-[11.5px] text-fg-3 transition hover:border-white/30 hover:text-white">
                {p}%
              </button>
            ))}
            <span className="tabular-nums ml-auto self-center text-[11.5px] text-fg-4">{t("balance {n}", { n: balance.toLocaleString("en-US", { maximumFractionDigits: 0 }) })}</span>
          </div>
        )
      )}
      <div className="tabular-nums mt-2 min-h-[2.6em] text-[12px] leading-relaxed text-fg-3">
        {busy === "quote" && t("quoting…")}
        {q && busy !== "quote" && (
          <>
            <span className="text-fg-2">
              {t("you get about {n} {s}", { n: fmt(q.outAmount, side === "buy" ? dec : 9), s: side === "buy" ? sym : "SOL" })}
            </span>
            {" · "}
            {t("fee {p}% ({n} SOL)", { p: (FEE_BPS / 100).toString(), n: fee.toLocaleString("en-US", { maximumFractionDigits: 5 }) })}
            {Number(q.priceImpactPct) >= 0.02 && <span className="text-[#ff8a7e]">{" · "}{t("price impact {p}%", { p: (Number(q.priceImpactPct) * 100).toFixed(1) })}</span>}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => void go()}
        disabled={!q || busy === "sign" || busy === "wait"}
        className="mt-1 w-full rounded-xl bg-white px-4 py-2.5 text-[13.5px] font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!wallet ? t("Connect wallet to trade") : busy === "sign" ? t("Sign in your wallet…") : busy === "wait" ? t("Landing…") : side === "buy" ? t("Buy {s}", { s: sym }) : t("Sell {s}", { s: sym })}
      </button>
      {error && <p className="mt-2 text-[12px] leading-relaxed text-[#ff8a7e]">{error}</p>}
      {done && (
        <p className="mt-2 text-[12px] leading-relaxed text-fg-3">
          {done.state === "confirmed" ? t("Landed.") : done.state === "failed" ? t("The transaction failed on chain.") : done.state === "sent" ? t("Sent, waiting for the chain…") : t("Sent; the chain has not confirmed it yet.")}{" "}
          <a href={`https://solscan.io/tx/${done.sig}`} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
            Solscan ↗
          </a>
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-fg-4">{t("Routed by Jupiter, signed by your wallet, nothing held by us. {p}% fee: a tenth buys $ZOOAGENCY back, the rest runs the zoo. Not financial advice.", { p: (FEE_BPS / 100).toString() })}</p>
    </div>
  );
}
