import { useState } from "react";
import { t } from "../i18n";

/** The contract address onto the clipboard, next to the ticker: one tap, then a quiet "copied". */
export default function CopyCa({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard: the address is on the page anyway */
    }
  };
  return (
    <button type="button" onClick={copy} title={t("copy CA")} aria-label={t("copy CA")} className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] px-1.5 py-0.5 align-middle text-[11px] text-fg-3 transition hover:border-white/30 hover:text-white">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {copied ? t("copied") : "CA"}
    </button>
  );
}
