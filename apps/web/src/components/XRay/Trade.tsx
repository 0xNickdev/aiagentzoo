import { chainOf } from "../../chain";
import { t } from "../../i18n";
import { DEXSCREENER_URL } from "../../links";

/** The trade terminals people actually use, each opening this mint straight away. Icons: their own favicons. */
export const TERMINALS = (mint: string): Array<{ k: string; icon: string; href: string; copies?: boolean }> => chainOf(mint) === "base" ? [
  { k: "GMGN", icon: "/terminals/gmgn.png", href: `https://gmgn.ai/base/token/${mint}` },
  { k: "BullX", icon: "/terminals/bullx.png", href: `https://neo.bullx.io/terminal?chainId=8453&address=${mint}` },
  { k: "clanker.world", icon: "/terminals/clanker.png", href: `https://www.clanker.world/clanker/${mint}` },
  { k: "Uniswap", icon: "/terminals/uniswap.png", href: `https://app.uniswap.org/swap?chain=base&outputCurrency=${mint}` },
  { k: "DexScreener", icon: "/terminals/dexscreener.png", href: `${DEXSCREENER_URL}/base/${mint}` },
] : chainOf(mint) === "bsc" ? [
  { k: "GMGN", icon: "/terminals/gmgn.png", href: `https://gmgn.ai/bsc/token/${mint}` },
  { k: "BullX", icon: "/terminals/bullx.png", href: `https://neo.bullx.io/terminal?chainId=56&address=${mint}` },
  { k: "four.meme", icon: "/terminals/fourmeme.png", href: `https://four.meme/token/${mint}` },
  { k: "Flap", icon: "/terminals/flap.png", href: `https://flap.sh/bnb/${mint}` },
  { k: "PancakeSwap", icon: "/terminals/pancake.png", href: `https://pancakeswap.finance/swap?outputCurrency=${mint}&chain=bsc` },
  { k: "DexScreener", icon: "/terminals/dexscreener.png", href: `${DEXSCREENER_URL}/bsc/${mint}` },
] : [
  { k: "Axiom", icon: "/terminals/axiom.png", href: `https://axiom.trade/t/${mint}` },
  { k: "GMGN", icon: "/terminals/gmgn.png", href: `https://gmgn.ai/sol/token/${mint}` },
  { k: "BullX", icon: "/terminals/bullx.png", href: `https://neo.bullx.io/terminal?chainId=1399811149&address=${mint}` },
  { k: "Padre", icon: "/terminals/padre.png", href: `https://trade.padre.gg/trade/solana/${mint}` },
  { k: "pump.fun", icon: "/terminals/pump.png", href: `https://pump.fun/coin/${mint}` },
  { k: "FOMO", icon: "/terminals/fomo.png", href: `https://fomo.family/coin?address=${mint}&chainId=1399811149&r=ZOOClawAgency` },
];

/** On BNB Chain the swap lives on PancakeSwap and four.meme, on Base on Uniswap and clanker.world; the zoo does not route either yet. */
export function TradeOnEvm({ mint, flap }: { mint: string; flap?: boolean }) {
  const base = chainOf(mint) === "base";
  return (
    <div>
      <p className="text-[12.5px] text-fg-4">{t("trade it here")}</p>
      <div className="mt-2 flex flex-col gap-2">
        <a href={base ? `https://www.clanker.world/clanker/${mint}` : flap ? `https://flap.sh/bnb/${mint}` : `https://four.meme/token/${mint}`} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white px-5 py-2.5 text-center text-[13.5px] font-semibold text-black transition hover:bg-white/90">
          {base ? t("Buy on clanker.world ↗") : flap ? t("Buy on Flap ↗") : t("Buy on four.meme ↗")}
        </a>
        <a href={base ? `https://app.uniswap.org/swap?chain=base&outputCurrency=${mint}` : `https://pancakeswap.finance/swap?outputCurrency=${mint}&chain=bsc`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-white/[0.12] px-5 py-2.5 text-center text-[13.5px] text-fg-2 transition hover:text-white">
          {base ? t("Uniswap ↗") : t("PancakeSwap ↗")}
        </a>
      </div>
      <p className="mt-3 text-[13px] font-normal leading-relaxed text-fg-4">{base ? t("Trading on Base is not routed through the zoo yet: a Clanker token lives in its Uniswap pool from the first second. Not financial advice.") : flap ? t("Trading on BNB Chain is not routed through the zoo yet: Flap while it is on the curve, PancakeSwap after it graduates. Not financial advice.") : t("Trading on BNB Chain is not routed through the zoo yet: four.meme while it is on the curve, PancakeSwap after it graduates. Not financial advice.")}</p>
    </div>
  );
}

export function Terminals({ mint }: { mint: string }) {
  return (
    <div className="mt-4 border-t border-white/[0.08] pt-3">
      <p className="text-[12.5px] text-fg-4">{t("open in your terminal")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {TERMINALS(mint).map((x) => (
          <a
            key={x.k}
            href={x.href}
            target="_blank"
            rel="noopener noreferrer"
            title={x.copies ? t("{x}: copies the CA, paste it in the app", { x: x.k }) : x.k}
            aria-label={x.k}
            onClick={x.copies ? () => void navigator.clipboard?.writeText(mint).catch(() => null) : undefined}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.03] transition hover:border-white/30 hover:bg-white/[0.07]"
          >
            <img src={x.icon} alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-md" loading="lazy" />
          </a>
        ))}
      </div>
    </div>
  );
}
