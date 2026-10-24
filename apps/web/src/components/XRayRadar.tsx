import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";

/** One wallet that bought in the first five seconds, as /v1/xray reports it. */
export interface EarlyWallet {
  wallet: string;
  bought: number;
  held: number;
  afterSec: number;
  exitSec: number | null;
  bundle: boolean;
  snipes48h: number;
  crew: boolean;
  ring: boolean;
  serial: boolean;
}

export type Kind = "crew" | "ring" | "serial" | "bundle" | "early";
export const kindOf = (e: EarlyWallet): Kind => (e.crew ? "crew" : e.ring ? "ring" : e.serial ? "serial" : e.bundle ? "bundle" : "early");
export const KIND: Record<Kind, { color: string; label: string; what: string }> = {
  crew: { color: "#ff8a7e", label: "creator's crew", what: "snipes this creator's other launches too: the creator's own wallet" },
  ring: { color: "#ffc27a", label: "sniper ring", what: "has sniped launches together with other wallets here before: one operator" },
  serial: { color: "#c9b48a", label: "serial sniper", what: "buys launches in the first seconds to sell to whoever comes next" },
  bundle: { color: "#a3aaa6", label: "launch block", what: "bought in the same block the token was created" },
  early: { color: "#e6e9e7", label: "first 5 s", what: "bought before the token showed up anywhere" },
};
const ORDER: Kind[] = ["crew", "ring", "serial", "bundle", "early"];
/** A wallet can be several things at once (crew and in a ring); the legend counts and filters by each. */
const has = (e: EarlyWallet, k: Kind) => (k === "crew" ? e.crew : k === "ring" ? e.ring : k === "serial" ? e.serial : k === "bundle" ? e.bundle : kindOf(e) === "early");

export const share = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");
export const secs = (s: number | null) => (s === null ? "-" : s < 120 ? `${s}s` : `${Math.round(s / 60)}m`);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const W = 640;
const H = 600;
const CX = W / 2;
const CY = H / 2;
/** Distance from the dev by the second the wallet got in: the inner ring is the launch itself, the outer one second five. */
const rOf = (s: number) => 58 + Math.min(5, Math.max(0, s)) * 46;

interface Node {
  e: EarlyWallet;
  k: Kind;
  x: number;
  y: number;
  size: number;
  a: number;
}

/** Where every wallet sits: grouped by who it is around the dev, at the radius of the second it bought. */
function layout(list: EarlyWallet[]): Node[] {
  const groups = ORDER.map((k) => list.filter((e) => kindOf(e) === k).sort((a, b) => a.afterSec - b.afterSec || b.bought - a.bought));
  const total = Math.max(1, list.length);
  const nodes: Node[] = [];
  let a0 = -Math.PI / 2 - (groups[0]!.length / total) * Math.PI;
  for (const [gi, g] of groups.entries()) {
    const span = (g.length / total) * Math.PI * 2;
    g.forEach((e, i) => {
      const a = a0 + span * ((i + 0.5) / g.length);
      // neighbours that got in on the same second are nudged apart so they do not sit on each other
      const r = rOf(e.afterSec) + (i % 2 ? 13 : -6) * (g.length > 6 ? 1 : 0);
      nodes.push({ e, k: ORDER[gi]!, a, x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r, size: Math.min(26, 5 + Math.sqrt(Math.max(0, e.bought)) * 62) });
    });
    a0 += span;
  }
  return nodes;
}

/**
 * The first five seconds as a radar: the dev in the middle, a ring per second, every wallet at the second it got in.
 * Size is what it took, a filled dot still holds, a dashed one sold out. Crew wallets are tied to the dev, ring
 * members to each other. Tap a wallet to see who it is; tap the legend to show one kind only.
 */
export default function XRayRadar({ early, selected, onSelect, compact = false }: { early: EarlyWallet[]; selected?: string | null; onSelect?: (wallet: string | null) => void; compact?: boolean }) {
  const list = useMemo(() => early.slice(0, 40), [early]);
  const nodes = useMemo(() => layout(list), [list]);
  const [hover, setHover] = useState<string | null>(null);
  const [only, setOnly] = useState<Kind | null>(null);
  const [clock, setClock] = useState(5);
  const [own, setOwn] = useState<string | null>(null);
  const sel = selected !== undefined ? selected : own;
  const pick = (w: string | null) => (onSelect ? onSelect(w) : setOwn(w));
  const raf = useRef(0);

  /** Plays the five seconds back: wallets light up as the clock reaches the second they bought. */
  const replay = () => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = () => {
      const s = Math.min(5, ((performance.now() - t0) / 3200) * 5);
      setClock(s);
      if (s < 5) raf.current = requestAnimationFrame(step);
    };
    setClock(0);
    raf.current = requestAnimationFrame(step);
  };
  useEffect(() => {
    replay();
    return () => cancelAnimationFrame(raf.current);
  }, [list]);

  const present = new Set(ORDER.filter((k) => nodes.some((n) => has(n.e, k))));
  const ring = nodes.filter((n) => n.e.ring).sort((a, b) => a.a - b.a);
  const focus = hover ?? sel;
  const dimmed = (n: Node) => (only && !has(n.e, only)) || (sel && n.e.wallet !== sel && !hover);
  // ring members tied to their nearest ring neighbour around the circle, never across it
  const ties: Array<[Node, Node]> = [];
  for (let i = 0; i + 1 < ring.length; i++) if (Math.abs(ring[i + 1]!.a - ring[i]!.a) < 0.9 && Math.hypot(ring[i + 1]!.x - ring[i]!.x, ring[i + 1]!.y - ring[i]!.y) < 120) ties.push([ring[i]!, ring[i + 1]!]);
  const tip = nodes.find((n) => n.e.wallet === focus);
  const playing = clock < 5;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label={t("Wallets in the first 5 seconds")} onClick={() => pick(null)}>
        <defs>
          <radialGradient id="xr-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,236,200,0.07)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.015)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <filter id="xr-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={CX} cy={CY} r={rOf(5) + 22} fill="url(#xr-bg)" />
        {/* a ring per second, the one the replay has reached a little brighter */}
        {[0, 1, 2, 3, 4, 5].map((s) => (
          <g key={s}>
            <circle cx={CX} cy={CY} r={rOf(s)} fill="none" stroke="white" strokeOpacity={playing && Math.floor(clock) === s ? 0.22 : s === 5 ? 0.12 : 0.06} strokeDasharray={s === 0 ? "2 5" : undefined} />
            <text x={CX + 4} y={CY - rOf(s) - 5} className="tabular-nums" fontSize="10" fill="white" fillOpacity="0.32">
              {s === 0 ? t("launch") : `${s}s`}
            </text>
          </g>
        ))}
        <line x1={CX - rOf(5) - 10} y1={CY} x2={CX + rOf(5) + 10} y2={CY} stroke="white" strokeOpacity="0.04" />
        <line x1={CX} y1={CY - rOf(5) - 10} x2={CX} y2={CY + rOf(5) + 10} stroke="white" strokeOpacity="0.04" />
        {playing && <circle cx={CX} cy={CY} r={rOf(clock)} fill="none" stroke="#ffc27a" strokeOpacity="0.55" strokeWidth="1.2" />}

        {/* ring members tied around their circle, crew tied to the dev */}
        {ties
          .filter(([a, b]) => a.e.afterSec <= clock && b.e.afterSec <= clock)
          .map(([a, b]) => {
            return <path key={`r${a.e.wallet}${b.e.wallet}`} d={`M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`} fill="none" stroke={KIND.ring.color} strokeOpacity={only && only !== "ring" ? 0.05 : 0.55} strokeWidth="1.4" />;
          })}
        {nodes
          .filter((n) => n.e.crew && n.e.afterSec <= clock)
          .map((n) => {
            const mx = (CX + n.x) / 2 + Math.cos(n.a + Math.PI / 2) * 18;
            const my = (CY + n.y) / 2 + Math.sin(n.a + Math.PI / 2) * 18;
            return <path key={`c${n.e.wallet}`} d={`M${CX},${CY} Q${mx.toFixed(1)},${my.toFixed(1)} ${n.x.toFixed(1)},${n.y.toFixed(1)}`} fill="none" stroke={KIND.crew.color} strokeOpacity={only && only !== "crew" ? 0.04 : focus === n.e.wallet ? 0.9 : focus ? 0.08 : 0.24} strokeWidth="1" />;
          })}

        {nodes.map((n) => {
          const k = KIND[n.k];
          const on = n.e.afterSec <= clock;
          const holds = n.e.bought > 0 ? n.e.held / n.e.bought : 0;
          const isSel = sel === n.e.wallet;
          return (
            <g
              key={n.e.wallet}
              style={{ cursor: "pointer", transition: "opacity .3s", opacity: on ? (dimmed(n) ? 0.18 : 1) : 0 }}
              onMouseEnter={() => setHover(n.e.wallet)}
              onMouseLeave={() => setHover(null)}
              onClick={(ev) => {
                ev.stopPropagation();
                pick(isSel ? null : n.e.wallet);
              }}
            >
              {/* a wide invisible target so small wallets are easy to tap */}
              <circle cx={n.x} cy={n.y} r={Math.max(16, n.size + 6)} fill="transparent" />
              {holds > 0.05 ? (
                <circle cx={n.x} cy={n.y} r={n.size} fill={k.color} fillOpacity={0.25 + holds * 0.6} stroke={k.color} strokeOpacity="0.95" strokeWidth="1" filter="url(#xr-glow)" />
              ) : (
                <circle cx={n.x} cy={n.y} r={n.size} fill={k.color} fillOpacity="0.05" stroke={k.color} strokeOpacity="0.75" strokeWidth="1" strokeDasharray="3 3" />
              )}
              <circle cx={n.x} cy={n.y} r={1.8} fill={k.color} />
              {hover === n.e.wallet && !isSel && <circle cx={n.x} cy={n.y} r={n.size + 6} fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="1" />}
              {isSel && (
                <>
                  <circle cx={n.x} cy={n.y} r={n.size + 7} fill="none" stroke="#ffc27a" strokeWidth="1.6" />
                  <circle cx={n.x} cy={n.y} r={n.size + 7} fill="none" stroke="#ffc27a" strokeOpacity="0.5" strokeWidth="1">
                    <animate attributeName="r" from={n.size + 7} to={n.size + 20} dur="1.4s" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" from="0.5" to="0" dur="1.4s" repeatCount="indefinite" />
                  </circle>
                </>
              )}
            </g>
          );
        })}

        <circle cx={CX} cy={CY} r="20" fill="#050807" stroke="white" strokeOpacity="0.85" />
        <circle cx={CX} cy={CY} r="26" fill="none" stroke="white" strokeOpacity="0.12" />
        <text x={CX} y={CY + 4} textAnchor="middle" className="tabular-nums" fontSize="11" fill="white" fillOpacity="0.9">
          dev
        </text>
        <text x={W - 14} y={24} textAnchor="end" className="tabular-nums" fontSize="12" fill="#ffc27a" fillOpacity={playing ? 0.95 : 0.5}>
          {`t+${clock.toFixed(1)}s`}
        </text>
      </svg>

      {/* what a wallet is, right where you point at it */}
      <AnimatePresence>
        {tip && !compact && !(onSelect && sel) && (
          <motion.div
            key={tip.e.wallet}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute z-10 w-[220px] rounded-xl border border-white/10 bg-[#070a09]/95 px-3.5 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.6)]"
            style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%`, transform: `translate(${tip.x > W * 0.6 ? "-108%" : "12%"}, -50%)` }}
          >
            <p className="tabular-nums text-[12.5px] text-fg-2">{short(tip.e.wallet)}</p>
            <p className="tabular-nums mt-0.5 text-[12px]" style={{ color: KIND[tip.k].color }}>
              {t(KIND[tip.k].label)}
            </p>
            <div className="tabular-nums mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
              <span className="text-fg-3">{t("in at")}</span>
              <span className="text-right text-fg-2">{tip.e.afterSec}s</span>
              <span className="text-fg-3">{t("took")}</span>
              <span className="text-right text-fg-2">{share(tip.e.bought)}</span>
              <span className="text-fg-3">{t("holds")}</span>
              <span className={`text-right ${tip.e.held >= 0.05 ? "text-[#ff8a7e]" : "text-fg-2"}`}>{share(tip.e.held)}</span>
              <span className="text-fg-3">{t("sold out")}</span>
              <span className="text-right text-fg-2">{tip.e.exitSec === null ? t("not yet") : t("after {s}", { s: secs(tip.e.exitSec) })}</span>
              <span className="text-fg-3">{t("snipes 48h")}</span>
              <span className="text-right text-fg-2">{tip.e.snipes48h}</span>
            </div>
            {!onSelect && <p className="mt-2 text-[12px] font-normal text-fg-4">{t(KIND[tip.k].what)}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="tabular-nums mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
        {ORDER.filter((k) => present.has(k)).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setOnly(only === k ? null : k)}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 transition ${only === k ? "bg-white/10 text-white ring-white/25" : only ? "text-fg-4 ring-white/[0.06]" : "text-fg-4 ring-white/[0.08] hover:text-white"}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: KIND[k].color }} />
            {t(KIND[k].label)} {nodes.filter((n) => has(n.e, k)).length}
          </button>
        ))}
        <button type="button" onClick={replay} className="ml-auto rounded-full px-2.5 py-1 text-[#ffc27a]/80 ring-1 ring-[#ffc27a]/20 hover:text-[#ffc27a]">
          ↻ {t("replay the 5 seconds")}
        </button>
      </div>
      <p className="tabular-nums mt-2 text-[11.5px] text-fg-4">{t("ring = the second it bought · size = what it took · filled = still holds · dashed = sold out")}</p>
    </div>
  );
}
