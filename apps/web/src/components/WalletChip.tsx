import { createPortal } from "react-dom";
import { pick } from "../i18n";
import { isMobile, resolvePicker, shortAddress, useGuardian, usePicker, walletAppLinks } from "../zoo";

const BTN = "inline-flex h-8 items-center rounded-[7px] border border-line-2 px-3 text-[12.5px] text-fg-2 transition-colors hover:border-white hover:text-white disabled:opacity-50";

/** The signed-in wallet with ways to switch it or sign out. Renders nothing when signed out. */
export function WalletChip({ className = "" }: { className?: string }) {
  const { session, signOut, switchWallet, busy } = useGuardian();
  if (!session) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="font-mono text-[12px] text-fg-2">{shortAddress(session.publicKey)}</span>
      <button type="button" className={BTN} disabled={busy} onClick={() => void switchWallet()}>
        {pick("Switch wallet", "切换钱包")}
      </button>
      <button type="button" className={BTN} onClick={() => void signOut()}>
        {pick("Sign out", "退出")}
      </button>
    </div>
  );
}

/** Mounted once (in the nav): lists the wallets on the page, or app links when there are none. */
export function WalletPicker() {
  const p = usePicker();
  if (!p || typeof document === "undefined") return null;
  const row = "flex h-11 w-full items-center justify-between rounded-[8px] border border-line px-3.5 text-[14px] text-white transition-colors hover:border-white";
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={() => resolvePicker(null)} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={pick("Choose a wallet", "选择钱包")} className="w-full max-w-[360px] rounded-[12px] border border-line bg-night p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[14px] font-medium text-white">{p.mode === "pick" ? pick("Choose a wallet", "选择钱包") : pick("No wallet found", "没有找到钱包")}</p>
          <button type="button" className="text-[12.5px] text-dim hover:text-white" onClick={() => resolvePicker(null)}>
            {pick("Close", "关闭")}
          </button>
        </div>
        {p.mode === "pick" ? (
          <div className="grid gap-2">
            {p.wallets.map((w) => (
              <button key={w.id} type="button" className={row} onClick={() => resolvePicker(w)}>
                <span>{w.name}</span>
                <span className="text-faint">→</span>
              </button>
            ))}
            <p className="mt-1 text-[12px] text-dim">{pick("To use another account, pick it inside the wallet when it asks.", "要换账户，请在钱包弹窗里选择。")}</p>
          </div>
        ) : isMobile() ? (
          <div className="grid gap-2">
            <p className="mb-1 text-[12.5px] text-fg-2">{pick("Open this page inside your wallet app:", "在钱包 App 里打开这个页面：")}</p>
            {walletAppLinks().map((l) => (
              <a key={l.name} href={l.href} className={row}>
                <span>{pick(`Open in ${l.name}`, `在 ${l.name} 中打开`)}</span>
                <span className="text-faint">↗</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="mb-1 text-[12.5px] text-fg-2">{pick("Install a Solana wallet such as Phantom, OKX, Solflare or Jupiter, then reload.", "请安装 Phantom、OKX、Solflare 或 Jupiter 等 Solana 钱包，然后刷新。")}</p>
            <a href="https://phantom.com/download" target="_blank" rel="noopener noreferrer" className={row}>
              <span>Phantom</span>
              <span className="text-faint">↗</span>
            </a>
            <a href="https://web3.okx.com/download" target="_blank" rel="noopener noreferrer" className={row}>
              <span>OKX Wallet</span>
              <span className="text-faint">↗</span>
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
