import { useState } from "react";
import { t } from "../../i18n";
import { ZOOAGENCY_CLAWPUMP_URL, ZOOAGENCY_MINT } from "../../links";

/** Copies the $ZOOAGENCY address; without a clipboard it selects the address so it can be copied by hand. */
function useCopy(targetId: string) {
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  const copy = () => {
    const done = (s: "copied" | "selected") => {
      setState(s);
      window.setTimeout(() => setState("idle"), 1600);
    };
    const select = () => {
      const el = document.getElementById(targetId);
      if (!el) return;
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      done("selected");
    };
    try {
      void navigator.clipboard.writeText(ZOOAGENCY_MINT).then(() => done("copied"), select);
    } catch {
      select();
    }
  };
  const label = state === "copied" ? t("Copied") : state === "selected" ? t("Selected") : t("Copy");
  return { copy, label, ok: state === "copied" };
}

/** The token's own mark (the owl), small and round. */
export const TokenDot = ({ className = "" }: { className?: string }) => (
  <img src="/token-64.png" alt="" aria-hidden width={16} height={16} className={`inline-block h-4 w-4 shrink-0 rounded-full ring-1 ring-white/10 ${className}`} />
);

const CopyIcon = ({ ok }: { ok: boolean }) =>
  ok ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m5 12 5 5 9-10" /></svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
  );

/** The address on one line with a copy button, as in the dashboard's sidebar card. */
export function CaRow({ id, className = "" }: { id: string; className?: string }) {
  const { copy, label, ok } = useCopy(id);
  return (
    <div className={`flex h-[30px] min-w-0 items-center gap-1.5 rounded-[7px] border border-line bg-night pl-[9px] pr-1 ${className}`}>
      <code id={id} className="min-w-0 flex-1 truncate font-mono text-[11.5px] tracking-[-0.01em] text-fg-2">
        {ZOOAGENCY_MINT}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={t("Copy the $ZOOAGENCY address")}
        className={`inline-flex h-[22px] min-w-[52px] shrink-0 items-center justify-center gap-1 rounded-[5px] border border-line-2 bg-transparent px-2 text-[11.5px] ${ok ? "text-white" : "text-fg-2 hover:text-white"}`}
      >
        {ok && <CopyIcon ok />}
        {label}
      </button>
    </div>
  );
}

export function BuyButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={ZOOAGENCY_CLAWPUMP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`btn-primary inline-flex h-8 items-center justify-center whitespace-nowrap rounded-[7px] px-3 text-[12.5px] font-medium ${className}`}
    >
      {t("Buy on ClawPump")}
    </a>
  );
}

/** The full $ZOOAGENCY card: what holding it gets you, the address with copy, and where to buy. */
export function TokenCard({ id, className = "" }: { id: string; className?: string }) {
  return (
    <div className={`rounded-[10px] border border-line-2 bg-night-surface p-3 ${className}`}>
      <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
        <TokenDot />
        $ZOOAGENCY
      </div>
      <p className="mb-2.5 mt-1.5 text-[12px] leading-[1.45] text-dim">{t("Hold 500k: Pro at half price and the weekly contest.")}</p>
      <CaRow id={id} />
      <BuyButton className="mt-2 w-full" />
    </div>
  );
}

/** The bar's version: one capsule - mark, ticker, short address with a copy icon, and a quiet buy link. */
export function TokenChip() {
  const { copy, ok } = useCopy("bar-ca");
  return (
    <div className="hidden h-8 items-center rounded-full border border-line-2 bg-night-surface/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] lg:flex">
      <button
        type="button"
        onClick={copy}
        title={ok ? t("Copied") : t("Copy the $ZOOAGENCY address")}
        aria-label={t("Copy the $ZOOAGENCY address")}
        className="group flex h-full items-center gap-2 rounded-l-full pl-1.5 pr-3 hover:bg-white/[0.03]"
      >
        <TokenDot className="!h-5 !w-5" />
        <span className="text-[12.5px] font-medium text-white">$ZOOAGENCY</span>
        <code id="bar-ca" className="font-mono text-[11.5px] text-dim group-hover:text-fg-2">
          <span className="sr-only">{ZOOAGENCY_MINT}</span>
          <span aria-hidden>{ZOOAGENCY_MINT.slice(0, 4)}…{ZOOAGENCY_MINT.slice(-4)}</span>
        </code>
        <span className={ok ? "text-white" : "text-faint group-hover:text-fg-2"}><CopyIcon ok={ok} /></span>
      </button>
      <span aria-hidden className="h-4 w-px bg-line-2" />
      <a
        href={ZOOAGENCY_CLAWPUMP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-full items-center gap-1 rounded-r-full pl-3 pr-3.5 text-[12.5px] font-medium text-white hover:bg-white/[0.03]"
      >
        {t("Buy")}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M7 17 17 7M8 7h9v9" /></svg>
      </a>
    </div>
  );
}
