import { useState } from "react";
import { t } from "../i18n";

/** The live token; VITE_TOKEN_MINT can override it per deployment. */
export const TOKEN_MINT: string = (import.meta.env.VITE_TOKEN_MINT ?? "").trim() || "2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B";
const TOKEN_SYMBOL: string = (import.meta.env.VITE_TOKEN_SYMBOL ?? "").trim();

/** The contract address as a small pill: click to copy. */
export function CAPill({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_MINT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the address stays selectable.
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={t("Copy the contract address")}
      className={`liquid-glass font-mono inline-flex max-w-full items-center gap-2 rounded-full px-4 py-1.5 text-[11.5px] text-white/80 transition hover:text-white ${className}`}
    >
      <span className="text-white/45">CA</span>
      <span className="truncate sm:hidden">{TOKEN_MINT.slice(0, 6)}…{TOKEN_MINT.slice(-6)}</span>
      <span className="hidden sm:inline">{TOKEN_MINT}</span>
      <span className={copied ? "text-emerald-300" : "text-white/45"}>{copied ? t("copied") : t("copy")}</span>
    </button>
  );
}

export function TokenAddress() {
  const [copied, setCopied] = useState(false);
  if (!TOKEN_MINT) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_MINT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the address is still selectable on the page.
    }
  };

  const links = [
    ["pump.fun", `https://pump.fun/coin/${TOKEN_MINT}`],
    ["DexScreener", `https://dexscreener.com/solana/${TOKEN_MINT}`],
    ["Solscan", `https://solscan.io/token/${TOKEN_MINT}`],
  ];

  return (
    <div className="liquid-glass mx-auto mb-12 max-w-3xl rounded-3xl bg-black/45 p-6 text-center backdrop-blur-md">
      <p className="text-[10px] font-light uppercase tracking-[0.3em] text-white/50">
        {TOKEN_SYMBOL ? `$${TOKEN_SYMBOL} · ` : ""}{t("Solana · launched on ClawPump")}
      </p>
      <button type="button" onClick={copy} className="mt-3 w-full break-all font-mono text-sm text-white/90 hover:text-white sm:text-base">
        {TOKEN_MINT}
      </button>
      <p className="mt-1 text-[11px] font-light text-white/45">{copied ? t("Copied") : t("Tap to copy the contract address")}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {links.map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/15 transition hover:bg-white/10 hover:text-white"
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
