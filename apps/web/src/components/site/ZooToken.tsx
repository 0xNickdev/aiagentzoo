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

/** A small round mark for the token: a plain warm orb, no picture. */
export const TokenDot = ({ className = "" }: { className?: string }) => (
  <span aria-hidden className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffe2b0,#e08a3c_60%,#7a3a12)] ${className}`} />
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
        className={`h-[22px] min-w-[52px] shrink-0 rounded-[5px] border bg-night-raised px-2 text-[11.5px] ${ok ? "border-moss-edge text-moss" : "border-line-2 text-fg-2 hover:text-white"}`}
      >
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
      className={`btn-moss inline-flex h-8 items-center justify-center whitespace-nowrap rounded-[7px] px-3 text-[12.5px] font-medium ${className}`}
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

/** The bar's version: the ticker, the short address with copy, and the buy button. */
export function TokenChip() {
  const { copy, label, ok } = useCopy("bar-ca");
  return (
    <div className="flex items-center gap-2">
      <div className="hidden h-8 items-center gap-2 rounded-[8px] border border-line bg-night-surface pl-2.5 pr-1 xl:flex">
        <TokenDot className="!h-3 !w-3" />
        <span className="text-[12.5px] font-medium text-white">$ZOOAGENCY</span>
        <code id="bar-ca" className="font-mono text-[11.5px] text-dim" title={ZOOAGENCY_MINT}>
          <span className="sr-only">{ZOOAGENCY_MINT}</span>
          <span aria-hidden>
            {ZOOAGENCY_MINT.slice(0, 4)}…{ZOOAGENCY_MINT.slice(-4)}
          </span>
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={t("Copy the $ZOOAGENCY address")}
          className={`h-6 min-w-[52px] rounded-[5px] border bg-night-raised px-2 text-[11.5px] ${ok ? "border-moss-edge text-moss" : "border-line-2 text-fg-2 hover:text-white"}`}
        >
          {label}
        </button>
      </div>
      <BuyButton />
    </div>
  );
}
