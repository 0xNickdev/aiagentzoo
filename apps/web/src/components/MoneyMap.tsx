import type { Early, XRayReport } from "./XRay";
import { t } from "../i18n";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");

const RED = "#ff8a7e";
const AMBER = "#f2d39b";
const WHITE = "rgba(255,255,255,0.55)";

interface Group {
  key: string;
  label: string;
  note: string;
  color: string;
  wallets: Early[];
  took: number;
  held: number;
}

/** Who the first-seconds wallets were, the worst label first: one wallet counts in one group only. */
function groups(early: Early[]): Group[] {
  const pick = (e: Early) => (e.crew ? "crew" : e.serial || e.ring ? "snipers" : e.bundle ? "bundle" : "others");
  const meta: Record<string, Omit<Group, "wallets" | "took" | "held">> = {
    crew: { key: "crew", label: "The dev's own wallets", note: "they snipe the dev's other launches too", color: RED },
    snipers: { key: "snipers", label: "Serial snipers", note: "buy launches in the first seconds to sell", color: AMBER },
    bundle: { key: "bundle", label: "Bundled with the launch", note: "bought in the creation block", color: AMBER },
    others: { key: "others", label: "Everyone else", note: "no pattern we know", color: WHITE },
  };
  const out: Record<string, Group> = {};
  for (const e of early) {
    const k = pick(e);
    out[k] ??= { ...meta[k], wallets: [], took: 0, held: 0 };
    out[k].wallets.push(e);
    out[k].took += e.bought;
    out[k].held += e.held;
  }
  return ["crew", "snipers", "bundle", "others"].map((k) => out[k]).filter((g): g is Group => !!g && g.took > 0);
}

/** A ribbon from one box to the next, as thick as the share of supply it carries. */
function Ribbon({ x1, y1, x2, y2, w, color }: { x1: number; y1: number; x2: number; y2: number; w: number; color: string }) {
  const mx = (x1 + x2) / 2;
  return <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={w} strokeLinecap="butt" />;
}

function Box({ x, y, w, h, title, sub, sub2, color = "rgba(255,255,255,0.22)", href }: { x: number; y: number; w: number; h: number; title: string; sub?: string; sub2?: string; color?: string; href?: string }) {
  const body = (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} fill="#0b0f0c" stroke={color} strokeOpacity={0.9} />
      <text x={x + 16} y={y + 26} fill="#fff" fontSize={15} fontFamily="Geist, sans-serif">
        {title}
      </text>
      {sub && (
        <text x={x + 16} y={y + 46} fill="rgba(255,255,255,0.62)" fontSize={12.5} fontFamily="'Geist Mono', monospace">
          {sub}
        </text>
      )}
      {sub2 && (
        <text x={x + 16} y={y + 64} fill="rgba(255,255,255,0.62)" fontSize={12.5} fontFamily="'Geist Mono', monospace">
          {sub2}
        </text>
      )}
    </g>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    body
  );
}

/**
 * The money map: one look at the whole operation, left to right. Who paid the dev, the dev, the wallets that took the
 * first five seconds grouped by who they turned out to be, and how much of what they took is already sold. Where the
 * SOL went after the dump joins once the nodes trace outgoing transfers.
 */
export default function MoneyMap({ r }: { r: XRayReport }) {
  const f = r.check.facts;
  const fund = r.funding;
  const rec = r.creatorRecord;
  const gs = groups(r.early);
  const took = gs.reduce((n, g) => n + g.took, 0);
  const held = gs.reduce((n, g) => n + g.held, 0);
  const sold = Math.max(0, took - held);

  const W = 1000;
  const COL = [20, 270, 540, 810];
  const BW = 210;
  const BH = 64;
  const GAP = 18;
  const H = Math.max(360, 60 + gs.length * (BH + GAP));
  const midY = H / 2;
  const thick = (share: number) => Math.max(2, Math.min(34, share * 90));

  const funderTitle = fund?.funder ? (fund.funderIsHot ? t("An exchange") : short(fund.funder)) : t("No transfer found");
  const funderSub = fund?.funder && !fund.funderIsHot && fund.siblings.length ? t("also funded {n} other devs", { n: fund.siblings.length }) : fund?.funderIsHot ? t("hot wallet, many users") : t("who paid the dev");
  const devSold = f?.creatorSoldPct != null ? t("sold {p}% of their bag", { p: f.creatorSoldPct }) : "";
  const devRecord = rec ? t("{d} of {n} dumped, 48h", { d: rec.dumped, n: rec.launches48h }) : "";
  const devSub = [devSold, devRecord].filter(Boolean).join(" · ");

  const gy = (i: number) => midY - (gs.length * (BH + GAP) - GAP) / 2 + i * (BH + GAP);
  const soldY = midY - BH - 12;
  const heldY = midY + 12;

  return (
    <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-6 sm:p-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-2xl text-fg">{t("Money map")}</h3>
        <span className="tabular-nums text-[12.5px] text-fg-4">{t("who paid · the dev · the first 5 seconds · sold or held")}</span>
      </div>

      {gs.length === 0 ? (
        <p className="text-[15px] text-fg-3">{t("Nobody bought in the first five seconds, so there is no operation to draw.")}</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="hidden w-full md:block" role="img" aria-label={t("Money map")}>
            <Ribbon x1={COL[0] + BW} y1={midY} x2={COL[1]} y2={midY} w={6} color={fund?.funder && !fund.funderIsHot ? RED : WHITE} />
            {gs.map((g, i) => (
              <Ribbon key={`d${g.key}`} x1={COL[1] + BW} y1={midY} x2={COL[2]} y2={gy(i) + BH / 2} w={thick(g.took)} color={g.color} />
            ))}
            {gs.map((g, i) => {
              const s = Math.max(0, g.took - g.held);
              return (
                <g key={`o${g.key}`}>
                  {s > 0 && <Ribbon x1={COL[2] + BW} y1={gy(i) + BH / 2} x2={COL[3]} y2={soldY + BH / 2} w={thick(s)} color={g.color} />}
                  {g.held > 0 && <Ribbon x1={COL[2] + BW} y1={gy(i) + BH / 2} x2={COL[3]} y2={heldY + BH / 2} w={thick(g.held)} color={WHITE} />}
                </g>
              );
            })}
            <Box x={COL[0]} y={midY - BH / 2} w={BW} h={BH} title={funderTitle} sub={funderSub} href={fund?.funder ? `https://solscan.io/account/${fund.funder}` : undefined} />
            <Box x={COL[1]} y={midY - (BH + 18) / 2} w={BW} h={BH + 18} title={t("The dev {w}", { w: short(r.creator) })} sub={devSold || devRecord} sub2={devSold ? devRecord : undefined} color={(f?.creatorSoldPct ?? 0) >= 50 ? RED : undefined} href={`https://solscan.io/account/${r.creator}`} />
            {gs.map((g, i) => (
              <Box key={g.key} x={COL[2]} y={gy(i)} w={BW} h={BH} title={t(g.label)} sub={t("{n} wallets · took {p}", { n: g.wallets.length, p: pct(g.took) })} color={g.color} />
            ))}
            <Box x={COL[3]} y={soldY} w={BW - 40} h={BH} title={t("Already sold")} sub={pct(sold)} color={sold > held ? RED : undefined} />
            <Box x={COL[3]} y={heldY} w={BW - 40} h={BH} title={t("Still holding")} sub={pct(held)} />
          </svg>

          {/* On a phone the same story reads top to bottom. */}
          <ol className="grid gap-3 md:hidden">
            <li className="rounded-2xl border border-white/15 p-4">
              <p className="text-[15px] text-white">{funderTitle}</p>
              <p className="tabular-nums mt-1 text-[12.5px] text-fg-4">{funderSub}</p>
            </li>
            <li className="rounded-2xl border p-4" style={{ borderColor: (f?.creatorSoldPct ?? 0) >= 50 ? RED : "rgba(255,255,255,0.15)" }}>
              <p className="text-[15px] text-white">{t("The dev {w}", { w: short(r.creator) })}</p>
              <p className="tabular-nums mt-1 text-[12.5px] text-fg-4">{devSub}</p>
            </li>
            {gs.map((g) => (
              <li key={g.key} className="rounded-2xl border p-4" style={{ borderColor: g.color }}>
                <p className="text-[15px] text-white">{t(g.label)}</p>
                <p className="tabular-nums mt-1 text-[12.5px] text-fg-4">
                  {t("{n} wallets · took {p}", { n: g.wallets.length, p: pct(g.took) })} · {t("sold {p}", { p: pct(Math.max(0, g.took - g.held)) })}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-6 grid gap-x-8 gap-y-2 text-[14px] leading-relaxed text-fg-3 md:grid-cols-2">
            {gs.map((g) => (
              <p key={g.key}>
                <span style={{ color: g.color === WHITE ? "#fff" : g.color }}>{t(g.label)}</span>: {t(g.note)}.
              </p>
            ))}
          </div>
          <p className="mt-5 text-[13px] text-fg-4">
            {t("Thickness is the share of supply. Where the SOL went after the sell comes once our nodes trace outgoing transfers.")}
          </p>
        </>
      )}
    </div>
  );
}
