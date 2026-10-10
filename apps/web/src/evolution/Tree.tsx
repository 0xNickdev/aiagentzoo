import { useEffect, useMemo, useRef, useState } from "react";
import { type Creature, portrait } from "./data";

const ROW = 64;
const NODE = 40;
const PAD_X = 70;
const PAD_Y = 46;

interface Placed {
  c: Creature;
  x: number;
  y: number;
}

/** Generations run left to right; a child sits between its parents, nudged off anyone already there. */
function layout(creatures: Creature[], COL: number): { nodes: Placed[]; width: number; height: number } {
  const founders = creatures.filter((c) => !c.parents).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const pos = new Map<string, Placed>();
  founders.forEach((c, i) => pos.set(c.id, { c, x: PAD_X, y: PAD_Y + i * ROW }));
  const born = creatures.filter((c) => c.parents).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  for (const c of born) {
    const ps = c.parents!.map((p) => pos.get(p)).filter((p): p is Placed => Boolean(p));
    const x = PAD_X + c.generation * COL;
    let y = ps.length ? ps.reduce((s, p) => s + p.y, 0) / ps.length : PAD_Y;
    const taken = () => [...pos.values()].some((p) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < ROW * 0.8);
    for (let step = 1; taken() && step < 40; step++) y += (step % 2 ? 1 : -1) * step * (ROW / 2);
    pos.set(c.id, { c, x, y: Math.max(PAD_Y, y) });
  }
  const nodes = [...pos.values()];
  const width = Math.max(...nodes.map((n) => n.x)) + PAD_X + 40;
  const height = Math.max(...nodes.map((n) => n.y)) + PAD_Y + 20;
  return { nodes, width, height };
}

export interface NextBirth {
  /** Short date of the next turn. */
  on: string;
  /** The two creatures leading right now, who would breed if the turn came today. */
  parents: string[];
}

export default function Tree({ creatures, onOpen, next }: { creatures: Creature[]; onOpen: (id: string) => void; next?: NextBirth }) {
  // Generations spread over the panel's width; past a few dozen they scroll instead of squeezing.
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(1100);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const leaders = (next?.parents ?? []).map((id) => creatures.find((c) => c.id === id)).filter((c): c is Creature => Boolean(c));
  const ghostGen = leaders.length ? Math.max(...leaders.map((c) => c.generation)) + 1 : Math.max(0, ...creatures.map((c) => c.generation)) + 1;
  const gens = Math.max(1, ...creatures.map((c) => c.generation), next ? ghostGen : 0);
  const COL = Math.min(260, Math.max(120, (avail - PAD_X * 2) / gens));
  const laid = useMemo(() => layout(creatures, COL), [creatures, COL]);
  const { nodes, height } = laid;
  // Where the next child will be born: between today's leaders, or mid-tree before anyone is graded.
  const ghost = next
    ? (() => {
        const at = leaders.map((l) => laid.nodes.find((n) => n.c.id === l.id)!).filter(Boolean);
        const ys = laid.nodes.map((n) => n.y);
        const x = PAD_X + ghostGen * COL;
        let y = at.length ? at.reduce((sum, n) => sum + n.y, 0) / at.length : (Math.min(...ys) + Math.max(...ys)) / 2;
        // Its label sits underneath, so keep clear of anyone near this column, the label's width included.
        const taken = () => laid.nodes.some((n) => Math.abs(n.x - x) < COL * 0.75 && Math.abs(n.y - y) < ROW * 1.1);
        for (let step = 1; taken() && step < 40; step++) y += (step % 2 ? 1 : -1) * step * (ROW / 2);
        return { x, y: Math.max(PAD_Y, y), from: at };
      })()
    : null;
  const width = Math.max(laid.width, ghost ? ghost.x + 120 : 0);
  const svgHeight = Math.max(height, ghost ? ghost.y + 60 : 0);
  const byId = new Map(nodes.map((n) => [n.c.id, n]));

  return (
    <div ref={box} className="tree-scroll overflow-x-auto pb-4">
      <svg width={Math.max(width, Math.min(avail, 640))} height={svgHeight} className="block" role="img" aria-label="Family tree of the nursery">
        <defs>
          <clipPath id="node-clip">
            <circle cx={NODE / 2} cy={NODE / 2} r={NODE / 2} />
          </clipPath>
          <filter id="fallen">
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>

        {/* generation rulers */}
        {Array.from({ length: Math.max(...nodes.map((n) => n.c.generation)) + 1 }, (_, g) => (
          <g key={g}>
            <line x1={PAD_X + g * COL} x2={PAD_X + g * COL} y1={14} y2={svgHeight - 8} className="stroke-white/[0.05]" strokeDasharray="2 6" />
            <text x={PAD_X + g * COL} y={12} textAnchor="middle" className="fill-white/30 font-mono text-[9.5px] tracking-[0.12em]">
              {g === 0 ? "FOUNDERS" : `GEN ${g}`}
            </text>
          </g>
        ))}

        {ghost && (
          <g className="ghost">
            {ghost.from.map((p, i) => {
              const mx = (p.x + ghost.x) / 2;
              return (
                <path
                  key={p.c.id}
                  d={`M ${p.x} ${p.y} C ${mx} ${p.y}, ${mx} ${ghost.y}, ${ghost.x} ${ghost.y}`}
                  fill="none"
                  strokeDasharray="3 5"
                  strokeWidth={1}
                  className={i === 0 ? "ghost-thread stroke-amber-200/45" : "ghost-thread stroke-white/25"}
                />
              );
            })}
            <circle cx={ghost.x} cy={ghost.y} r={NODE / 2 + 3} className="ghost-node fill-[#030504] stroke-white/30" strokeDasharray="3 4" />
            <text x={ghost.x} y={ghost.y + 5} textAnchor="middle" className="fill-white/50 font-mono text-[14px]">
              ?
            </text>
            <text x={ghost.x} y={ghost.y + NODE / 2 + 17} textAnchor="middle" className="fill-white/75 font-mono text-[10px] tracking-[0.1em]">
              {next!.on.toUpperCase()} · NEXT BIRTH
            </text>
            <text x={ghost.x} y={ghost.y + NODE / 2 + 31} textAnchor="middle" className="fill-white/40 font-mono text-[9.5px]">
              {ghost.from.length === 2 ? `if it were today: ${ghost.from[0]!.c.name} × ${ghost.from[1]!.c.name}` : "parents: the two best after the first grades"}
            </text>
          </g>
        )}

        {/* bloodlines */}
        {nodes.flatMap((n) =>
          (n.c.parents ?? []).map((p, i) => {
            const from = byId.get(p);
            if (!from) return null;
            const alive = n.c.diedNight === null;
            const mx = (from.x + n.x) / 2;
            return (
              <path
                key={`${p}-${n.c.id}`}
                d={`M ${from.x} ${from.y} C ${mx} ${from.y}, ${mx} ${n.y}, ${n.x} ${n.y}`}
                fill="none"
                strokeWidth={i === 0 ? 1.4 : 1}
                className={i === 0 ? (alive ? "stroke-amber-200/55" : "stroke-white/15") : alive ? "stroke-white/30" : "stroke-white/10"}
              />
            );
          }),
        )}

        {nodes.map(({ c, x, y }) => {
          const dead = c.diedNight !== null;
          return (
            <g
              key={c.id}
              transform={`translate(${x - NODE / 2} ${y - NODE / 2})`}
              className="tree-node cursor-pointer"
              onClick={() => onOpen(c.id)}
              role="button"
              tabIndex={0}
              aria-label={`${c.name}${dead ? ", fallen" : ""}`}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(c.id)}
            >
              <circle cx={NODE / 2} cy={NODE / 2} r={NODE / 2 + 3} className={dead ? "fill-[#030504] stroke-white/10" : "fill-[#030504] stroke-white/25"} />
              <image
                href={portrait(c.house)}
                width={NODE}
                height={NODE}
                clipPath="url(#node-clip)"
                filter={dead ? "url(#fallen)" : undefined}
                opacity={dead ? 0.35 : 1}
              />
              {dead && <line x1={8} y1={NODE - 8} x2={NODE - 8} y2={8} className="stroke-white/40" strokeWidth={1} />}
              <text x={NODE / 2} y={NODE + 15} textAnchor="middle" className={`font-mono text-[9.5px] ${dead ? "fill-white/25" : "fill-white/70"}`}>
                {c.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
