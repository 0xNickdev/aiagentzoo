import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { chainName, EVM, evmConnect, evmSend, quoteSol, sources, status, submitDeposit, toAtomic, type IntentQuote, type IntentStatus, type Token } from "../intents";
import { SOLSCAN_URL } from "../links";

type Phase = "idle" | "quoting" | "sending" | "waiting" | "done" | "refunded" | "failed";
const KEY = "zoo.fund.pending";
const PREVIEW_EVM = "0x742d35cc6634c0532925a3b844bc454e4438f44e";

const STATE: Record<IntentStatus, string> = {
  PENDING_DEPOSIT: "waiting for your deposit",
  KNOWN_DEPOSIT_TX: "deposit seen, confirming on the origin chain",
  INCOMPLETE_DEPOSIT: "deposit was less than quoted: send the rest or wait for the refund",
  PROCESSING: "swapping into SOL",
  SUCCESS: "SOL delivered to your wallet",
  REFUNDED: "refunded to your address on the origin chain",
  FAILED: "failed",
};

/**
 * "No SOL? Fund from another chain": Aurora Intents swaps USDC, ETH, BNB, BTC... into SOL delivered to the reader's
 * own Solana wallet, and the buy above is then filled with it. Nothing passes through us.
 */
export default function FundAnyChain({ wallet, onConnect, onFunded }: { wallet: string | null; onConnect: () => void; onFunded: (sol: number) => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Token[]>([]);
  const [asset, setAsset] = useState("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near");
  const [amount, setAmount] = useState("5");
  const [evmAddr, setEvmAddr] = useState<string | null>(null);
  const [refund, setRefund] = useState("");
  const [preview, setPreview] = useState<IntentQuote | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [deposit, setDeposit] = useState<{ address: string; memo?: string; amountIn: string; symbol: string; chain: string; tx?: string } | null>(null);
  const [st, setSt] = useState<IntentStatus | null>(null);
  const [outTx, setOutTx] = useState<string | null>(null);
  const [got, setGot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token = useMemo(() => list.find((x) => x.assetId === asset) ?? null, [list, asset]);
  const isEvm = !!token && !!EVM[token.blockchain];
  const atomic = token ? toAtomic(amount, token.decimals) : 0n;
  const usd = token ? Number(amount) * token.price : 0;

  useEffect(() => {
    if (!open || list.length) return;
    sources().then(setList).catch((e: Error) => setError(e.message));
  }, [open, list.length]);

  // A pending deposit survives a reload: pick it up and keep polling.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        setDeposit(JSON.parse(raw));
        setPhase("waiting");
        setOpen(true);
      }
    } catch {
      /* storage blocked: nothing to resume */
    }
  }, []);

  // A dry quote while the reader types: how much SOL arrives and how long it takes.
  useEffect(() => {
    setPreview(null);
    if (!open || !token || !wallet || atomic <= 0n || phase !== "idle") return;
    // A dry quote still needs a valid refund address on the origin chain: any real EVM address works for a preview.
    const refundTo = isEvm ? (evmAddr ?? PREVIEW_EVM) : refund;
    if (!refundTo) return;
    const id = setTimeout(() => {
      quoteSol(token, atomic, wallet, refundTo, true)
        .then((q) => (setPreview(q), setError(null)))
        .catch((e: Error) => setError(e.message));
    }, 450);
    return () => clearTimeout(id);
  }, [open, token, atomic, wallet, evmAddr, refund, phase, isEvm]);

  // Poll the intent until it lands or comes back.
  useEffect(() => {
    if (!deposit || phase !== "waiting") return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await status(deposit.address);
        if (stop) return;
        setSt(s.status);
        if (s.status === "SUCCESS") {
          const h = s.swapDetails?.destinationChainTxHashes?.[0]?.hash ?? null;
          setOutTx(h);
          setGot(s.swapDetails?.amountOutFormatted ?? null);
          setPhase("done");
          try { localStorage.removeItem(KEY); } catch { /* */ }
          const sol = Number(s.swapDetails?.amountOutFormatted ?? 0);
          if (sol > 0) onFunded(sol);
        } else if (s.status === "REFUNDED" || s.status === "FAILED") {
          setPhase(s.status === "REFUNDED" ? "refunded" : "failed");
          try { localStorage.removeItem(KEY); } catch { /* */ }
        }
      } catch {
        /* a missed poll is fine, the next one comes in a few seconds */
      }
    };
    void tick();
    const id = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(id); };
  }, [deposit, phase, onFunded]);

  const start = async () => {
    if (!token || !wallet || atomic <= 0n) return;
    setError(null);
    try {
      let from = evmAddr;
      if (isEvm && !from) {
        from = await evmConnect();
        setEvmAddr(from);
      }
      const refundTo = isEvm ? from! : refund.trim();
      if (!refundTo) return setError(t("Enter your {c} address for a refund if the swap cannot complete.", { c: chainName(token.blockchain) }));
      setPhase("quoting");
      const q = await quoteSol(token, atomic, wallet, refundTo, false);
      if (!q.depositAddress) throw new Error("no deposit address in the quote");
      const d = { address: q.depositAddress, memo: q.depositMemo, amountIn: amount, symbol: token.symbol, chain: token.blockchain };
      if (isEvm) {
        setPhase("sending");
        const tx = await evmSend(from!, token, q.depositAddress, atomic);
        await submitDeposit(tx, q.depositAddress);
        Object.assign(d, { tx });
      }
      setDeposit(d);
      try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* */ }
      setSt("PENDING_DEPOSIT");
      setPhase("waiting");
    } catch (e) {
      setPhase("idle");
      setError((e as Error).message || t("Cancelled."));
    }
  };

  // A new coin keeps the same dollar size (about $5 by default), not the same count: 5 USDC, not 5 BTC.
  const pick = (id: string) => {
    const next = list.find((x) => x.assetId === id);
    const dollars = token && Number(amount) > 0 ? Number(amount) * token.price : 5;
    setAsset(id);
    if (next) setAmount(String(Number((dollars / next.price).toPrecision(next.price > 100 ? 2 : 3))));
  };

  const reset = () => {
    setPhase("idle"); setDeposit(null); setSt(null); setOutTx(null); setGot(null); setError(null);
    try { localStorage.removeItem(KEY); } catch { /* */ }
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 w-full rounded-xl border border-white/[0.1] px-3 py-2 text-left text-[12px] text-fg-3 transition hover:border-white/25 hover:text-white">
        {t("No SOL? Fund this buy from another chain")} <span className="text-fg-4">· USDC, ETH, BNB, BTC…</span>
      </button>
    );

  const row = "mt-2 flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2";
  return (
    <div className="mt-3 rounded-xl border border-white/[0.1] p-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-fg-2">{t("Fund from another chain")}</p>
        <button type="button" onClick={() => (phase === "waiting" ? null : (reset(), setOpen(false)))} className="text-[11px] text-fg-4 hover:text-white">
          {phase === "waiting" ? "" : t("close")}
        </button>
      </div>

      {phase === "idle" || phase === "quoting" || phase === "sending" ? (
        <>
          <select value={asset} onChange={(e) => pick(e.target.value)} aria-label={t("Pay with")} className={`${row} w-full text-[13px] text-white outline-none`}>
            {!list.length && <option>{t("loading…")}</option>}
            {list.map((x) => (
              <option key={x.assetId} value={x.assetId} className="bg-[#0d110f]">
                {x.symbol} · {chainName(x.blockchain)}
              </option>
            ))}
          </select>
          <div className={row}>
            <input inputMode="decimal" size={1} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label={t("Amount")} className="tabular-nums w-full min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none" />
            <span className="text-[12.5px] text-fg-3">{token?.symbol ?? ""}</span>
          </div>
          {token && !isEvm && (
            <input value={refund} onChange={(e) => setRefund(e.target.value.trim())} placeholder={t("your {c} address, for a refund", { c: chainName(token.blockchain) })} className={`${row} w-full text-[12.5px] text-white outline-none placeholder:text-fg-4`} />
          )}
          <p className="tabular-nums mt-2 min-h-[2.6em] text-[12px] leading-relaxed text-fg-3">
            {!wallet
              ? t("Connect your Solana wallet first: the SOL arrives there.")
              : preview
                ? t("≈ {sol} SOL to your wallet in about {s} s (${u} in)", { sol: Number(preview.amountOutFormatted).toFixed(4), s: preview.timeEstimate ?? 60, u: usd.toFixed(2) })
                : atomic > 0n
                  ? !isEvm && !refund ? t("Enter a refund address to see the quote.") : t("quoting…")
                  : ""}
          </p>
          <button
            type="button"
            onClick={() => (wallet ? void start() : onConnect())}
            disabled={!!wallet && (!preview || phase !== "idle")}
            className="mt-1 w-full rounded-xl bg-white px-4 py-2.5 text-[13.5px] font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {!wallet
              ? t("Connect Solana wallet")
              : phase === "quoting"
                ? t("Getting a deposit address…")
                : phase === "sending"
                  ? t("Confirm in your {c} wallet…", { c: chainName(token?.blockchain ?? "") })
                  : isEvm
                    ? t("Pay {a} {s} from {c}", { a: amount, s: token?.symbol ?? "", c: chainName(token?.blockchain ?? "") })
                    : t("Get a deposit address")}
          </button>
        </>
      ) : (
        deposit && (
          <div className="mt-2 text-[12px] leading-relaxed text-fg-3">
            {!deposit.tx && phase === "waiting" && (
              <div className="rounded-lg border border-white/[0.1] p-2.5">
                <p className="text-fg-2">{t("Send exactly {a} {s} on {c} to:", { a: deposit.amountIn, s: deposit.symbol, c: chainName(deposit.chain) })}</p>
                <button type="button" onClick={() => void navigator.clipboard?.writeText(deposit.address)} className="mt-1 break-all text-left font-mono text-[12px] text-white underline decoration-white/20 underline-offset-4" title={t("copy")}>
                  {deposit.address}
                </button>
                {deposit.memo && <p className="mt-1">{t("memo")}: <span className="font-mono text-white">{deposit.memo}</span></p>}
              </div>
            )}
            {deposit.tx && EVM[deposit.chain] && (
              <p>
                {t("Sent on {c}", { c: chainName(deposit.chain) })}:{" "}
                <a href={EVM[deposit.chain].explorer + deposit.tx} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                  {deposit.tx.slice(0, 10)}… ↗
                </a>
              </p>
            )}
            <p className={`mt-1.5 ${phase === "done" ? "text-[#a6e3b4]" : phase === "failed" ? "text-[#ff8a7e]" : "text-fg-2"}`}>
              {phase === "waiting" && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#f3c97a] align-middle" />}
              {phase === "done" ? t("{n} SOL delivered to your wallet. The buy above is filled with it.", { n: got ?? "" }) : t(STATE[st ?? "PENDING_DEPOSIT"])}
            </p>
            {outTx && (
              <a href={`${SOLSCAN_URL}/tx/${outTx}`} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                Solscan ↗
              </a>
            )}
            {phase !== "waiting" && (
              <button type="button" onClick={reset} className="mt-2 block text-[11.5px] text-fg-4 hover:text-white">
                {t("Fund again")}
              </button>
            )}
          </div>
        )
      )}
      {error && <p className="mt-2 text-[12px] leading-relaxed text-[#ff8a7e]">{error}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-fg-4">{t("Swapped by Aurora Intents into SOL sent straight to your Solana wallet. If it cannot complete, it is refunded on the chain you paid from.")}</p>
    </div>
  );
}
