import { useState } from "react";

/** Set VITE_TOKEN_MINT in the deployment once the token is live; until then nothing renders. */
export const TOKEN_MINT: string = (import.meta.env.VITE_TOKEN_MINT ?? "").trim();
const TOKEN_SYMBOL: string = (import.meta.env.VITE_TOKEN_SYMBOL ?? "").trim();

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
        {TOKEN_SYMBOL ? `$${TOKEN_SYMBOL} · ` : ""}Solana · launched on ClawPump
      </p>
      <button type="button" onClick={copy} className="mt-3 w-full break-all font-mono text-sm text-white/90 hover:text-white sm:text-base">
        {TOKEN_MINT}
      </button>
      <p className="mt-1 text-[11px] font-light text-white/45">{copied ? "Copied" : "Tap to copy the contract address"}</p>
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
