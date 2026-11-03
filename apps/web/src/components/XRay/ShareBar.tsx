import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { BOT_URL } from "../../links";
import type { XRayReport } from "./types";
import { TONE } from "./shared";
import { drawXRay } from "./shareCard";

/** Post it, keep watching it, or ask the beaver for its call. */
export function ShareBar({ r }: { r: XRayReport }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [png, setPng] = useState<string | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    setPng(null);
    void drawXRay(canvas.current, r).then(() => setPng(canvas.current!.toDataURL("image/png")));
  }, [r]);
  const c = r.check;
  const label = TONE[c.verdict].label.toLowerCase();
  const tweet = encodeURIComponent(
    [`x-rayed $${r.symbol}: ${label}.`, c.reasons[0] ?? "", "", `see who you're buying from: zooaiagency.com/xray?mint=${r.mint}`].filter((x, i) => i !== 1 || x).join("\n"),
  );
  const btn = "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px]";
  return (
    <div className="bg-night-surface border border-white/[0.08] grid gap-5 rounded-2xl p-5 sm:p-6 lg:grid-cols-[1fr_minmax(0,22rem)] lg:items-center">
      <div>
        <h3 className="font-display text-xl text-fg">{t("Share it, or keep an eye on it")}</h3>
        <p className="mt-1.5 text-[13px] font-normal leading-relaxed text-fg-4">
          {t("Watch it in Telegram and the bot tells you the moment the dev sells, the pool is drained or it graduates.")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`${BOT_URL}?start=w-${r.mint}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-white font-medium text-black hover:bg-white/90`}>
            {t("Watch it in Telegram")}
          </a>
          <a href={`https://x.com/intent/post?text=${tweet}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-night-surface border border-white/[0.08] text-fg hover:text-white`}>
            {t("Post on X")}
          </a>
          <a
            href={png ?? undefined}
            download={`xray-${r.symbol}-${r.mint.slice(0, 6)}.png`}
            className={`${btn} bg-night-surface border border-white/[0.08] text-fg hover:text-white ${png ? "" : "pointer-events-none opacity-50"}`}
          >
            {t("Download the card")}
          </a>
          <a href={`/ask?mint=${r.mint}`} className={`${btn} text-fg-4 hover:text-white`}>
            {t("Ask the beaver for its call →")}
          </a>
        </div>
      </div>
      <canvas ref={canvas} className="hidden" />
      <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        {png ? <img src={png} alt={t("X-ray card")} className="h-full w-full" /> : <div className="h-full w-full animate-pulse bg-white/[0.03]" />}
      </div>
    </div>
  );
}
