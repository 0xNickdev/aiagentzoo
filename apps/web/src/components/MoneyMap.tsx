import { useEffect, useRef } from "react";
import type { Early, XRayReport } from "./XRay";
import { t } from "../i18n";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");

const RED = "#ff8a7e";
const AMBER = "#ffc27a";
const WHITE = "#d9dddb";
const MOSS = "#a6e3b4";

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

/** A band from one node to the next, as thick as the share it carries; dust runs along its centre line. */
function Ribbon({ id, x1, y1, x2, y2, w, color, speed }: { id: string; x1: number; y1: number; x2: number; y2: number; w: number; color: string; speed: number }) {
  const mx = (x1 + x2) / 2;
  const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  return (
    <g>
      <defs>
        <linearGradient id={`g-${id}`} x1={x1} x2={x2} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={color} stopOpacity={0.34} />
          <stop offset="1" stopColor={color} stopOpacity={0.12} />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={`url(#g-${id})`} strokeWidth={w} strokeLinecap="butt" />
      <path d={d} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={0.8} data-flow={id} data-color={color} data-speed={speed} data-w={w} />
    </g>
  );
}

/** A node: a thin bar in its colour with its name beside it, instead of a box. */
function Node({ x, y, h, title, sub, sub2, color = WHITE, href, right, left }: { x: number; y: number; h: number; title: string; sub?: string; sub2?: string; color?: string; href?: string; right?: boolean; left?: boolean }) {
  // names sit above the bar, clear of the bands that leave it
  const tx = right ? x + 2 : left ? x - 2 : x;
  const anchor = right ? "end" : left ? "start" : "middle";
  const top = y - 10 - (sub2 ? 34 : sub ? 17 : 0);
  const body = (
    <g>
      <rect x={x - 2} y={y} width={4} height={h} rx={2} fill={color} />
      <rect x={x - 6} y={y - 4} width={12} height={h + 8} rx={6} fill={color} opacity={0.12} />
      <text x={tx} y={top} fill="#ffffff" fontSize={15} fontWeight={600} fontFamily="Geist, sans-serif" textAnchor={anchor}>
        {title}
      </text>
      {sub && (
        <text x={tx} y={top + 17} fill="#d9dddb" fontSize={13} fontFamily="Geist, sans-serif" textAnchor={anchor} style={{ fontVariantNumeric: "tabular-nums" }}>
          {sub}
        </text>
      )}
      {sub2 && (
        <text x={tx} y={top + 34} fill="#a3aaa6" fontSize={12.5} fontFamily="Geist, sans-serif" textAnchor={anchor} style={{ fontVariantNumeric: "tabular-nums" }}>
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

/** Dust running along every band: more where the band is thick, faster where it was sold. */
function useFlow(svg: React.RefObject<SVGSVGElement | null>, key: string) {
  useEffect(() => {
    const el = svg.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = el.querySelector("g[data-dust]") as SVGGElement | null;
    if (!layer) return;
    const NS = "http://www.w3.org/2000/svg";
    const dots: Array<{ p: SVGPathElement; len: number; c: SVGCircleElement; ph: number; sp: number; off: number }> = [];
    el.querySelectorAll<SVGPathElement>("path[data-flow]").forEach((p, i) => {
      const len = p.getTotalLength();
      const w = Number(p.dataset.w ?? 4);
      const n = Math.max(3, Math.round(w * 1.4));
      for (let k = 0; k < n; k++) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("r", String(0.9 + (k % 3) * 0.35));
        c.setAttribute("fill", k % 5 === 0 ? "#ffffff" : p.dataset.color ?? "#fff");
        c.setAttribute("opacity", String(0.55 + (k % 4) * 0.12));
        layer.appendChild(c);
        dots.push({ p, len, c, ph: (k / n + i * 0.13) % 1, sp: Number(p.dataset.speed ?? 0.1) * (0.8 + ((k * 7) % 5) * 0.1), off: ((k * 37) % 11) / 11 - 0.5 });
      }
    });
    let raf = 0;
    let t = 0;
    let last = performance.now();
    const loop = (now: number) => {
      t += Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const d of dots) {
        const u = (d.ph + t * d.sp) % 1;
        const pt = d.p.getPointAtLength(u * d.len);
        const w = Number(d.p.dataset.w ?? 4);
        d.c.setAttribute("cx", pt.x.toFixed(1));
        d.c.setAttribute("cy", (pt.y + d.off * w * 0.8).toFixed(1));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      for (const d of dots) d.c.remove();
    };
  }, [svg, key]);
}

/**
 * The money map: one look at the whole operation, left to right. Who paid the dev, the dev, the wallets that took the
 * first five seconds grouped by who they turned out to be, and how much of what they took is already sold. Where the
 * SOL went after the dump joins once the nodes trace outgoing transfers.
 */
export default function MoneyMap({ r }: { r: XRayReport }) {
  const svg = useRef<SVGSVGElement>(null);
  useFlow(svg, r.mint);
  const f = r.check.facts;
  const fund = r.funding;
  const rec = r.creatorRecord;
  const gs = groups(r.early);
  const took = gs.reduce((n, g) => n + g.took, 0);
  const held = gs.reduce((n, g) => n + g.held, 0);
  const sold = Math.max(0, took - held);

  const W = 1000;
  // bars sit at these x; names read to the right of each, the last column's to the left
  const COL = [24, 290, 560, 976];
  const BW = 210;
  const BH = 44;
  const GAP = 56;
  const H = Math.max(380, 110 + gs.length * (BH + GAP));
  const midY = H / 2 + 24;
  const thick = (share: number) => Math.max(3, Math.min(40, share * 100));

  const funderTitle = fund?.funder ? (fund.funderIsHot ? t("An exchange") : short(fund.funder)) : t("No transfer found");
  const funderSub = fund?.funder && !fund.funderIsHot && fund.siblings.length ? t("also funded {n} other devs", { n: fund.siblings.length }) : fund?.funderIsHot ? t("hot wallet, many users") : t("who paid the dev");
  const devSold = f?.creatorSoldPct != null ? t("sold {p}% of their bag", { p: f.creatorSoldPct }) : "";
  const devRecord = rec ? t("{d} of {n} dumped, 48h", { d: rec.dumped, n: rec.launches48h }) : "";
  const devSub = [devSold, devRecord].filter(Boolean).join(" · ");

  const gy = (i: number) => midY - (gs.length * (BH + GAP) - GAP) / 2 + i * (BH + GAP);
  const soldY = midY - BH - 40;
  const heldY = midY + 40;

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
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="hidden w-full md:block" role="img" aria-label={t("Money map")}>
            <Ribbon id="fund" x1={COL[0] + 2} y1={midY} x2={COL[1] - 2} y2={midY} w={6} color={fund?.funder && !fund.funderIsHot ? MOSS : WHITE} speed={0.12} />
            {gs.map((g, i) => (
              <Ribbon key={`d${g.key}`} id={`d${g.key}`} x1={COL[1] + 2} y1={midY} x2={COL[2] - 2} y2={gy(i) + BH / 2} w={thick(g.took)} color={g.color} speed={0.1} />
            ))}
            {gs.map((g, i) => {
              const s = Math.max(0, g.took - g.held);
              return (
                <g key={`o${g.key}`}>
                  {s > 0 && <Ribbon id={`s${g.key}`} x1={COL[2] + 2} y1={gy(i) + BH / 2} x2={COL[3] - 2} y2={soldY + BH / 2} w={thick(s)} color={RED} speed={0.22} />}
                  {g.held > 0 && <Ribbon id={`h${g.key}`} x1={COL[2] + 2} y1={gy(i) + BH / 2} x2={COL[3] - 2} y2={heldY + BH / 2} w={thick(g.held)} color={WHITE} speed={0.05} />}
                </g>
              );
            })}
            <g data-dust style={{ mixBlendMode: "screen" }} />
            <Node x={COL[0]} y={midY - BH / 2} h={BH} title={funderTitle} sub={funderSub} left color={fund?.funder && !fund.funderIsHot ? MOSS : WHITE} href={fund?.funder ? `https://solscan.io/account/${fund.funder}` : undefined} />
            <Node x={COL[1]} y={midY - (BH + 18) / 2} h={BH + 18} title={t("The dev {w}", { w: short(r.creator) })} sub={devSold || devRecord} sub2={devSold ? devRecord : undefined} color={(f?.creatorSoldPct ?? 0) >= 50 ? RED : WHITE} href={`https://solscan.io/account/${r.creator}`} />
            {gs.map((g, i) => (
              <Node key={g.key} x={COL[2]} y={gy(i)} h={BH} title={t(g.label)} sub={t("{n} wallets · took {p}", { n: g.wallets.length, p: pct(g.took) })} color={g.color} />
            ))}
            <Node x={COL[3]} y={soldY} h={BH} title={t("Already sold")} sub={pct(sold)} color={RED} right />
            <Node x={COL[3]} y={heldY} h={BH} title={t("Still holding")} sub={pct(held)} color={WHITE} right />
          </svg>

          {/* On a phone the same story reads top to bottom. */}
          <ol className="grid gap-3 md:hidden">
            <li className="rounded-xl border border-white/[0.08] border-l-2 p-4" style={{ borderLeftColor: fund?.funder && !fund.funderIsHot ? MOSS : WHITE }}>
              <p className="text-[15px] text-white">{funderTitle}</p>
              <p className="tabular-nums mt-1 text-[12.5px] text-fg-4">{funderSub}</p>
            </li>
            <li className="rounded-xl border border-white/[0.08] border-l-2 p-4" style={{ borderLeftColor: (f?.creatorSoldPct ?? 0) >= 50 ? RED : WHITE }}>
              <p className="text-[15px] text-white">{t("The dev {w}", { w: short(r.creator) })}</p>
              <p className="tabular-nums mt-1 text-[12.5px] text-fg-4">{devSub}</p>
            </li>
            {gs.map((g) => (
              <li key={g.key} className="rounded-xl border border-white/[0.08] border-l-2 p-4" style={{ borderLeftColor: g.color }}>
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
                <span className="font-medium" style={{ color: g.color === WHITE ? "#fff" : g.color }}>{t(g.label)}</span>: {t(g.note)}.
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
