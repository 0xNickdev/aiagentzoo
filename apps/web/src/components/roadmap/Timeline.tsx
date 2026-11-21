import { pick, t } from "../../i18n";
import { STOPS, type Stop } from "./data";

/** Four corner brackets that step outward when the frame is hovered. */
export function Corners() {
  return (
    <>
      <span className="rm-c rm-c-tl" aria-hidden="true" />
      <span className="rm-c rm-c-tr" aria-hidden="true" />
      <span className="rm-c rm-c-bl" aria-hidden="true" />
      <span className="rm-c rm-c-br" aria-hidden="true" />
    </>
  );
}

function Dot({ s }: { s: Stop }) {
  if (s.status === "now")
    return (
      <span className="relative flex h-[15px] w-[15px] items-center justify-center rounded-full border-[1.5px] border-white bg-night">
        <span className="orbit-ping absolute -inset-[5px] rounded-full border border-white" />
        <span className="h-[5px] w-[5px] rounded-full bg-white" />
      </span>
    );
  if (s.status === "shipped") return <span className="h-[11px] w-[11px] rounded-full bg-white" />;
  return <span className="h-[11px] w-[11px] rounded-full border-[1.5px] border-dashed border-[#7d8681] bg-night" />;
}

function Body({ s }: { s: Stop }) {
  const done = s.status === "shipped";
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em]">
        <span className={`whitespace-nowrap ${s.status === "next" ? "text-faint" : "text-fg-3"}`}>{pick(s.date, s.dateZh)}</span>
        {s.status === "now" && <span className="whitespace-nowrap rounded-[3px] bg-white px-1.5 leading-[16px] text-night">{t("We are here")}</span>}
      </p>
      <h3 className={`mt-2 text-[19px] font-semibold leading-[1.1] tracking-[-0.03em] ${s.status === "next" ? "text-fg-3" : "text-white"} group-hover:text-white`}>{pick(s.title, s.titleZh)}</h3>
      {s.count != null && <p className="mt-1.5 font-mono text-[11px] text-dim">{pick(s.count, s.countZh ?? s.count)}</p>}
      <ul className="mt-3 grid gap-1.5">
        {s.points.map((p) => (
          <li key={p.en} className="flex gap-2 text-[12.5px] leading-[1.45] text-fg-4">
            <span className={`mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full ${done ? "bg-white" : "bg-faint"}`} />
            {pick(p.en, p.zh)}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The whole road on one line, left to right: what is done, where we are, what is next.
 * The line is solid up to today and dashed after it. Every stop links to its part of the page.
 * Under 1024px the same line runs down the left edge.
 */
export default function Timeline() {
  const here = STOPS.findIndex((s) => s.status === "now");
  const n = STOPS.length;
  // The solid part ends at the centre of the "now" column.
  const done = ((here + 0.5) / n) * 100;
  return (
    <nav aria-label={t("Roadmap")} className="rm-frame">
      <Corners />
      <div className="rounded-[2px] border border-line-2 bg-night-surface">
        <div className="flex h-10 items-center justify-between border-b border-line px-4 font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint sm:px-5">
          <span>{t("The road so far")}</span>
          <span className="hidden gap-5 sm:flex">
            <span className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full bg-white" />
              {t("Shipped")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full border border-white" />
              {t("Now")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full border border-dashed border-[#7d8681]" />
              {t("Next")}
            </span>
          </span>
        </div>

        {/* wide: seven columns under one line */}
        <div className="relative hidden lg:block">
          <span className="absolute left-0 top-[35px] h-px bg-white" style={{ width: `${done}%` }} />
          <span className="absolute right-0 top-[35px] h-px border-t border-dashed border-[#4a524e]" style={{ width: `${100 - done}%` }} />
          <ol className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {STOPS.map((s, i) => (
              <li key={s.id} className={i ? "border-l border-line" : ""}>
                <a href={s.href} className={`group flex h-full flex-col px-4 pb-5 transition-colors hover:bg-night-raised xl:px-5 ${s.status === "now" ? "bg-night-raised" : ""}`}>
                  <span className="relative flex h-[71px] items-center justify-center">
                    <span className="absolute left-1/2 top-[9px] -translate-x-1/2 font-mono text-[10px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                    <Dot s={s} />
                  </span>
                  <Body s={s} />
                </a>
              </li>
            ))}
          </ol>
        </div>

        {/* narrow: the same line down the left edge */}
        <ol className="lg:hidden">
          {STOPS.map((s, i) => (
            <li key={s.id} className={i ? "border-t border-line" : ""}>
              <a href={s.href} className={`group relative grid grid-cols-[44px_minmax(0,1fr)] py-5 pr-4 ${s.status === "now" ? "bg-night-raised" : ""}`}>
                <span className={`absolute bottom-0 left-[21.5px] top-0 w-px ${i <= here ? "bg-white" : "border-l border-dashed border-[#4a524e]"}`} style={i === here ? { bottom: "auto", height: 30 } : undefined} />
                {i === here && <span className="absolute bottom-0 left-[21.5px] top-[30px] w-px border-l border-dashed border-[#4a524e]" />}
                <span className="relative flex h-5 items-center justify-center">
                  <Dot s={s} />
                </span>
                <div className="min-w-0">
                  <Body s={s} />
                </div>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
