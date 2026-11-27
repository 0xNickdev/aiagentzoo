import { useRef } from "react";
import { t } from "../../i18n";

const CERT = "/hackathon-winner.png";

function Logos({ h }: { h: number }) {
  return (
    <span className="flex shrink-0 items-center gap-4">
      <img src="/logos/encode.png" alt="Encode Club" height={h * 0.4} style={{ height: h * 0.4, width: "auto" }} />
      <img src="/logos/solana-foundation.png" alt="Solana Foundation" height={h * 0.6} style={{ height: h * 0.6, width: "auto" }} />
    </span>
  );
}

/** The certificate in a native modal dialog: Esc closes it, a click outside the image closes it, focus stays inside. */
function useCertificate() {
  const ref = useRef<HTMLDialogElement>(null);
  const dialog = (
    <dialog
      ref={ref}
      aria-label={t("Hackathon certificate")}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="m-auto max-h-[92vh] w-[min(1100px,94vw)] border border-line-2 bg-black p-0 text-white backdrop:bg-black/80"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[12px] text-dim">
        <span>{t("Encode Club x Solana Hackathon 2026, winner certificate")}</span>
        <button type="button" autoFocus onClick={() => ref.current?.close()} className="px-2 py-1 text-fg-2 hover:text-white">
          {t("Close")}
        </button>
      </div>
      <img src={CERT} alt={t("Winner certificate, Best Consumer App on Solana, Encode Club x Solana Hackathon 2026")} className="block h-auto w-full" />
    </dialog>
  );
  return { open: () => ref.current?.showModal(), dialog };
}

/** Proof where people decide: the win, the accelerator, the certificate one click away. */
export function RecognitionStrip({ className = "" }: { className?: string }) {
  const { open, dialog } = useCertificate();
  return (
    <div className={`flex flex-col gap-4 rounded-[10px] border border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-5 ${className}`}>
      <Logos h={36} />
      <p className="min-w-0 flex-1 text-[13px] leading-[1.5] text-fg-2 sm:text-[14px]">
        <span className="text-white">{t("Winner, Best Consumer App on Solana.")}</span>{" "}
        {t("Encode Club x Solana Hackathon 2026, final 8. Now in the Encode Club x Solana accelerator.")}
      </p>
      <button type="button" onClick={open} style={{ border: "1px solid rgba(255,255,255,.25)", borderRadius: 999 }} className="self-start whitespace-nowrap rounded-full border border-white/25 px-3.5 py-1.5 text-[13px] text-white transition-colors hover:border-white sm:self-auto">
        {t("See the certificate")}
      </button>
      {dialog}
    </div>
  );
}

export function RecognitionFooter() {
  const { open, dialog } = useCertificate();
  return (
    <>
      <button type="button" onClick={open} className="flex flex-wrap items-center gap-3 text-left text-[12px] text-dim hover:text-white">
        <Logos h={28} />
        <span>{t("Best Consumer App on Solana, Encode x Solana Hackathon 2026")}</span>
      </button>
      {dialog}
    </>
  );
}
