import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { polygonHull } from "d3-polygon";
import { select } from "d3-selection";
import { curveCatmullRomClosed, line } from "d3-shape";
import { zoom, type ZoomTransform, zoomIdentity } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { t } from "../i18n";
import type { XRayReport } from "./XRay";

/**
 * The network around a token, Bubblemaps-style: the dev, his crew and regulars, the launch block, the serial snipers,
 * who paid for him and who else that wallet paid for, and his last launches. Each group is a soft hull with its story
 * written on it; bubble size is what a wallet took or how often it shows up. Canvas, d3-force, no other renderer.
 */

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
type Kind = "dev" | "crew" | "ring" | "bundle" | "serial" | "early" | "funder" | "sibling" | "coin";
type Group = "crew" | "ring" | "bundle" | "serial" | "funder" | "coin";
interface Node extends SimulationNodeDatum {
  id: string;
  kind: Kind;
  group: Group | "dev";
  /** Share of supply bought here, 0..100. */
  pct: number;
  /** In how many of this dev's launches the wallet was there. */
  launches?: number;
  snipes?: number;
  held?: number;
  sec?: number;
  label?: string;
  outcome?: "dumped" | "graduated" | "open";
  dumped?: number;
}
interface Link extends SimulationLinkDatum<Node> {
  kind: "crew" | "sniped" | "bundle" | "launched" | "funded";
  w: number;
}
interface DevProfile {
  launches48h: number;
  dumped: number;
  regulars: Array<{ wallet: string; launches: number; snipes48h: number }>;
  launches: Array<{ mint: string; symbol: string; dumpedAfterMin: number | null; graduated: boolean }>;
}

const COLOR: Record<Kind, string> = { dev: "#ff6a5c", crew: "#ff8d7a", ring: "#f4b65f", bundle: "#5fc6f2", serial: "#cfc6ad", early: "#e9e9e9", funder: "#b6e3c6", sibling: "#ff8d7a", coin: "#ff6a5c" };
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function build(r: XRayReport, dev: DevProfile | null): { nodes: Node[]; links: Link[]; total: number; record: { launches: number; dumped: number } } {
  const total = dev?.launches48h ?? r.creatorRecord?.launches48h ?? 1;
  const nodes = new Map<string, Node>();
  const links: Link[] = [];
  const add = (n: Node) => {
    const had = nodes.get(n.id);
    if (!had) return void nodes.set(n.id, n);
    had.pct = Math.max(had.pct, n.pct);
    had.launches ??= n.launches;
    had.snipes ??= n.snipes;
    had.held ??= n.held;
    had.sec ??= n.sec;
  };
  // The dev's record as the rest of the report shows it, so the map and the sidebar say the same numbers.
  add({ id: r.creator, kind: "dev", group: "dev", pct: 0, dumped: r.creatorRecord?.dumped ?? dev?.dumped });
  for (const g of dev?.regulars ?? []) {
    const crew = g.launches >= total * 0.5;
    add({ id: g.wallet, kind: crew ? "crew" : "ring", group: crew ? "crew" : "ring", pct: 0, launches: g.launches, snipes: g.snipes48h });
    links.push({ source: r.creator, target: g.wallet, kind: "crew", w: Math.min(1, g.launches / total) });
  }
  for (const e of r.early) {
    const kind: Kind = e.crew ? "crew" : e.ring ? "ring" : e.bundle ? "bundle" : e.serial ? "serial" : "early";
    add({ id: e.wallet, kind, group: kind === "early" ? "serial" : (kind as Group), pct: Math.round(e.bought * 1000) / 10, snipes: e.snipes48h, held: e.held, sec: e.afterSec });
    if (!links.some((l) => l.target === e.wallet)) links.push({ source: r.creator, target: e.wallet, kind: "sniped", w: 0.3 });
  }
  const block = r.bundle?.wallets ?? [];
  for (const b of block) add({ id: b.wallet, kind: "bundle", group: nodes.get(b.wallet)?.group === "crew" ? "crew" : "bundle", pct: Math.round(b.share * 1000) / 10 });
  for (let i = 0; i < block.length - 1; i++) links.push({ source: block[i]!.wallet, target: block[i + 1]!.wallet, kind: "bundle", w: 0.6 });
  // Whoever paid for the launch-block wallets: one wallet funding several of them is one hand.
  for (const g of r.bundle?.funding?.groups ?? []) {
    add({ id: g.funder, kind: "funder", group: "funder", pct: 0 });
    for (const w of g.wallets) links.push({ source: g.funder, target: w, kind: "funded", w: 0.8 });
  }
  // Who paid for the dev, and the other devs that wallet paid for.
  const f = r.funding;
  if (f?.funder && !f.funderIsHot) {
    add({ id: f.funder, kind: "funder", group: "funder", pct: 0 });
    links.push({ source: f.funder, target: r.creator, kind: "funded", w: 1 });
    for (const s of f.siblings.slice(0, 12)) {
      add({ id: s.wallet, kind: "sibling", group: "funder", pct: 0, launches: s.launches48h, dumped: s.dumped });
      links.push({ source: f.funder, target: s.wallet, kind: "funded", w: 0.7 });
    }
  }
  for (const x of (dev?.launches ?? []).filter((x) => x.mint !== r.mint).slice(0, 14)) {
    add({ id: `c:${x.mint}`, kind: "coin", group: "coin", pct: 0, label: `$${x.symbol.replace(/^\$/, "").slice(0, 10)}`, outcome: x.dumpedAfterMin !== null ? "dumped" : x.graduated ? "graduated" : "open" });
    links.push({ source: r.creator, target: `c:${x.mint}`, kind: "launched", w: 0.2 });
  }
  const record = { launches: r.creatorRecord?.launches48h ?? total, dumped: r.creatorRecord?.dumped ?? dev?.dumped ?? 0 };
  return { record, nodes: [...nodes.values()], links: links.filter((l) => nodes.has(l.source as string) && nodes.has(l.target as string)), total };
}

const radius = (n: Node, total: number) => {
  if (n.kind === "dev") return 30;
  if (n.kind === "coin") return 8;
  if (n.kind === "funder") return 14;
  const a = n.launches ? 7 + 20 * Math.min(1, n.launches / total) : 0;
  const b = n.pct ? 6 + Math.sqrt(n.pct) * 8 : 6;
  return Math.max(a, b);
};

export default function NetworkMap({ r, onPick, onWallet }: { r: XRayReport; onPick: (mint: string) => void; onWallet: (wallet: string) => void }) {
  const [dev, setDev] = useState<DevProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hover, setHover] = useState<{ n: Node; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const lit = useRef<Node | null>(null);
  const controls = useRef<{ zoomBy: (k: number) => void; fit: () => void } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`${NORTH}/v1/wallet/${r.creator}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((b: { dev?: DevProfile } | null) => live && setDev(b?.dev ?? null))
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [r.creator]);

  const graph = useMemo(() => (loaded ? build(r, dev) : null), [loaded, r, dev]);

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!graph || !el || !cv) return;
    const { nodes, links, total, record } = graph;
    const ctx = cv.getContext("2d")!;
    const DPR = window.devicePixelRatio || 1;
    let W = el.clientWidth;
    let H = el.clientHeight;
    const mobile = W < 640;
    // Each group has a home; on a phone they stack closer.
    const s = mobile ? 0.62 : 1;
    const home: Record<string, [number, number]> = { dev: [0, 0], crew: [-60, -20], ring: [190, -130], bundle: [-320, 40], serial: [350, 110], funder: [-230, -210], coin: [10, 290] };
    const R = (n: Node) => radius(n, total) * (mobile ? 0.8 : 1);
    const sim = forceSimulation<Node>(nodes)
      .force("link", forceLink<Node, Link>(links).id((d) => d.id).distance((l) => ({ crew: 70, sniped: 260, bundle: 30, launched: 240, funded: 60 })[l.kind] * s).strength((l) => (l.kind === "bundle" || l.kind === "funded" ? 0.7 : l.kind === "crew" ? 0.25 : 0.01)))
      .force("charge", forceManyBody<Node>().strength((d) => (d.kind === "dev" ? -300 : -40)))
      .force("x", forceX<Node>((d) => home[d.group]![0] * s).strength((d) => (d.kind === "dev" ? 1 : 0.14)))
      .force("y", forceY<Node>((d) => home[d.group]![1] * s).strength((d) => (d.kind === "dev" ? 1 : 0.14)))
      .force("collide", forceCollide<Node>((d) => R(d) + 2.5).strength(1).iterations(3))
      .stop();
    for (let i = 0; i < 500; i++) sim.tick();

    const count = (g: Group) => nodes.filter((n) => n.group === g).length;
    const top = nodes.filter((n) => n.launches && n.group === "crew").sort((a, b) => (b.launches ?? 0) - (a.launches ?? 0))[0];
    const blockPct = nodes.filter((n) => n.group === "bundle").reduce((a, n) => a + n.pct, 0);
    const sibs = nodes.filter((n) => n.kind === "sibling");
    const GROUPS: Record<Group, { color: string; title: string; sub: string }> = {
      crew: { color: COLOR.crew, title: t("HIS CREW"), sub: top ? t("{n} wallets · in {a} of his {b} launches in 48h", { n: count("crew"), a: top.launches ?? 0, b: total }) : t("{n} of his own wallets", { n: count("crew") }) },
      ring: { color: COLOR.ring, title: t("REGULARS"), sub: t("{n} wallets · back in launch after launch", { n: count("ring") }) },
      bundle: { color: COLOR.bundle, title: t("LAUNCH BLOCK"), sub: t("{n} wallets · {p}% bought in one slot", { n: count("bundle"), p: blockPct.toFixed(1) }) },
      serial: { color: COLOR.serial, title: t("SERIAL SNIPERS"), sub: t("{n} wallets · first seconds of everything", { n: count("serial") }) },
      funder: { color: COLOR.funder, title: t("SAME FUNDER"), sub: sibs.length ? t("paid for {n} other devs · {d} dumps", { n: sibs.length, d: sibs.reduce((a, x) => a + (x.dumped ?? 0), 0) }) : t("one wallet paid for these") },
      coin: { color: COLOR.coin, title: t("HIS LAST LAUNCHES"), sub: t("{n} shown · {d} of {b} dumped", { n: count("coin"), d: record.dumped, b: record.launches }) },
    };

    let tr: ZoomTransform = zoomIdentity;
    const resize = () => {
      W = el.clientWidth;
      H = el.clientHeight;
      cv.width = W * DPR;
      cv.height = H * DPR;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
    };
    const fit = () => {
      const xs = nodes.map((n) => n.x!);
      const ys = nodes.map((n) => n.y!);
      const [x0, x1, y0, y1] = [Math.min(...xs) - 60, Math.max(...xs) + 60, Math.min(...ys) - 90, Math.max(...ys) + 40];
      const k = Math.min(W / (x1 - x0), H / (y1 - y0), 1.3);
      return zoomIdentity.translate((W - k * (x1 + x0)) / 2, (H - k * (y1 + y0)) / 2).scale(k);
    };

    const draw = () => {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      for (let x = 13; x < W; x += 26) for (let y = 13; y < H; y += 26) ctx.fillRect(x, y, 1, 1);
      ctx.save();
      ctx.translate(tr.x, tr.y);
      ctx.scale(tr.k, tr.k);
      const labels: Array<{ g: Group; x: number; y: number }> = [];
      const curve = line().curve(curveCatmullRomClosed.alpha(0.9)).context(ctx);
      for (const g of Object.keys(GROUPS) as Group[]) {
        const members = nodes.filter((n) => n.group === g || (g === "crew" && n.kind === "dev"));
        if (members.length < 2 && g !== "funder") continue;
        if (!members.length) continue;
        const pts: Array<[number, number]> = [];
        for (const p of members) for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) pts.push([p.x! + Math.cos(a) * (R(p) + 16), p.y! + Math.sin(a) * (R(p) + 16)]);
        const h = polygonHull(pts);
        if (!h) continue;
        ctx.beginPath();
        curve(h);
        ctx.fillStyle = rgba(GROUPS[g].color, 0.055);
        ctx.fill();
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = rgba(GROUPS[g].color, 0.35);
        ctx.lineWidth = 1 / tr.k;
        ctx.stroke();
        ctx.setLineDash([]);
        const topPt = h.reduce((a, b) => (b[1] < a[1] ? b : a));
        labels.push({ g, x: h.reduce((a, p) => a + p[0], 0) / h.length, y: topPt[1] });
      }
      const hot = lit.current;
      for (const l of links) {
        const a = l.source as Node;
        const b = l.target as Node;
        const lit = hot && (a === hot || b === hot);
        ctx.beginPath();
        ctx.moveTo(a.x!, a.y!);
        ctx.lineTo(b.x!, b.y!);
        ctx.strokeStyle = lit ? "rgba(255,255,255,0.85)" : { crew: "rgba(255,141,122,0.35)", bundle: "rgba(95,198,242,0.5)", sniped: "rgba(255,255,255,0.05)", launched: "rgba(255,106,92,0.12)", funded: "rgba(182,227,198,0.45)" }[l.kind];
        ctx.lineWidth = lit ? 1.8 : l.kind === "crew" ? 0.6 + 2 * l.w : 0.8;
        ctx.stroke();
      }
      for (const n of [...nodes].sort((a, b) => R(a) - R(b))) {
        const col = n.kind === "coin" ? (n.outcome === "graduated" ? "#8fe3a5" : COLOR.coin) : COLOR[n.kind];
        const rad = R(n);
        const gone = n.held === 0;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, rad, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, n.kind === "dev" ? 0.9 : n.kind === "coin" ? 0.14 : gone ? 0.18 : 0.32);
        ctx.fill();
        ctx.lineWidth = n.kind === "dev" ? 2 : 1.3;
        ctx.strokeStyle = n === hot ? "#fff" : rgba(col, gone && n.kind !== "dev" ? 0.55 : 0.95);
        ctx.stroke();
        if (n.kind === "dev") {
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, rad + 8, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(col, 0.25);
          ctx.lineWidth = 6;
          ctx.stroke();
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (n.kind === "dev") {
          ctx.font = '600 11px "Geist Mono", monospace';
          ctx.fillStyle = "#170807";
          ctx.fillText(t("DEV"), n.x!, n.y! - (n.dumped !== undefined ? 6 : 0));
          if (n.dumped !== undefined) {
            ctx.font = '500 8.5px "Geist Mono", monospace';
            ctx.fillText(t("{d}/{n} dumped", { d: record.dumped, n: record.launches }), n.x!, n.y! + 7);
          }
        } else if (rad * tr.k >= 15 && n.kind !== "coin") {
          ctx.font = '500 9px "Geist Mono", monospace';
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.fillText(n.launches ? `${n.launches}×` : n.pct ? `${n.pct}%` : "", n.x!, n.y! - 5);
          ctx.font = '400 7px "Geist Mono", monospace';
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.fillText(short(n.id), n.x!, n.y! + 6);
        }
      }
      ctx.restore();
      for (const l of labels) {
        const [x, y] = tr.apply([l.x, l.y]);
        const g = GROUPS[l.g];
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.font = '500 10px "Geist Mono", monospace';
        ctx.fillStyle = rgba(g.color, 0.95);
        ctx.fillText(g.title, x, y - 24);
        ctx.font = `400 ${mobile ? 11 : 12}px Geist, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(g.sub, x, y - 9);
      }
    };

    resize();
    tr = fit();
    // The page keeps its scroll: the wheel zooms only with Ctrl or Cmd held (a trackpad pinch sends Ctrl too).
    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.3, 4])
      .filter((e: Event) => {
        if (e.type === "wheel") return (e as WheelEvent).ctrlKey || (e as WheelEvent).metaKey;
        // On a phone one finger scrolls the page; two fingers move and zoom the map.
        if (e.type.startsWith("touch")) return (e as TouchEvent).touches.length > 1;
        return !(e as MouseEvent).button;
      })
      .on("zoom", (e) => {
        tr = e.transform;
        lit.current = null;
        setHover(null);
        draw();
      });
    const sel = select(cv).call(z).call(z.transform, tr);
    controls.current = {
      zoomBy: (k: number) => z.scaleBy(sel, k),
      fit: () => z.transform(sel, fit()),
    };
    const pick = (ev: { offsetX: number; offsetY: number }) => {
      const [x, y] = tr.invert([ev.offsetX, ev.offsetY]);
      let best: Node | null = null;
      for (const n of nodes) if (Math.hypot(n.x! - x, n.y! - y) <= R(n) + 3 && (!best || R(n) < R(best))) best = n;
      return best;
    };
    const move = (ev: MouseEvent) => {
      const n = pick(ev);
      cv.style.cursor = n && n.kind !== "dev" ? "pointer" : "grab";
      if (lit.current !== n) {
        lit.current = n;
        draw();
      }
      setHover(n ? { n, x: ev.offsetX, y: ev.offsetY } : null);
    };
    const click = (ev: MouseEvent) => {
      const n = pick(ev);
      if (!n) return;
      if (n.kind === "coin") onPick(n.id.slice(2));
      else onWallet(n.id);
    };
    cv.addEventListener("mousemove", move);
    cv.addEventListener("click", click);
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(el);
    void document.fonts?.ready.then(draw);
    draw();
    return () => {
      ro.disconnect();
      cv.removeEventListener("mousemove", move);
      cv.removeEventListener("click", click);
      sel.on(".zoom", null);
    };
  }, [graph, onPick, onWallet, dev]);

  const n = hover?.n;
  const total = graph?.total ?? 1;
  return (
    <div ref={wrap} className="relative h-[560px] overflow-hidden rounded-2xl bg-black/30 ring-1 ring-white/[0.06] sm:h-[640px]">
      <canvas ref={canvas} className="block" style={{ touchAction: "pan-y" }} />
      {!graph && <p className="absolute inset-0 grid place-items-center text-[13px] text-white/55">{t("Drawing the network…")}</p>}
      {n && n.kind !== "dev" && (
        <div className="pointer-events-none absolute z-10 w-[240px] rounded-xl bg-[#0d0f10]/95 p-3.5 ring-1 ring-white/10" style={{ left: Math.min(hover!.x + 14, (wrap.current?.clientWidth ?? 0) - 254), top: Math.max(8, hover!.y - 20) }}>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em]" style={{ color: COLOR[n.kind] }}>
            {{ crew: t("his crew"), ring: t("regular"), bundle: t("launch block"), serial: t("serial sniper"), early: t("first 5 seconds"), funder: t("funder"), sibling: t("another dev, same funder"), coin: t("his launch"), dev: "" }[n.kind]}
          </p>
          <p className="font-mono mt-1 text-[13px] text-white">{n.kind === "coin" ? n.label : short(n.id)}</p>
          <div className="mt-2 space-y-1 text-[12px] text-white/65">
            {n.launches !== undefined && n.kind !== "sibling" && <p>{t("in {a} of his {b} launches in 48h", { a: n.launches, b: total })}</p>}
            {n.kind === "sibling" && <p>{t("{a} launches · {d} dumped in 48h", { a: n.launches ?? 0, d: n.dumped ?? 0 })}</p>}
            {!!n.pct && <p>{t("bought {p}% of supply", { p: n.pct })}{n.sec !== undefined ? t(", {s}s after launch", { s: n.sec }) : ""}</p>}
            {n.held === 0 && <p>{t("already sold out")}</p>}
            {n.snipes !== undefined && <p>{t("{n} snipes in 48h", { n: n.snipes })}</p>}
            {n.kind === "coin" && <p>{n.outcome === "dumped" ? t("dev dumped it") : n.outcome === "graduated" ? t("graduated") : t("dev still holding")}</p>}
          </div>
          <p className="mt-2 text-[11px] text-white/40">{n.kind === "coin" ? t("tap to x-ray it") : t("tap to open the wallet")}</p>
        </div>
      )}
      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-xl bg-[#0d0f10]/90 ring-1 ring-white/10">
        {[
          ["+", () => controls.current?.zoomBy(1.4), t("zoom in")],
          ["−", () => controls.current?.zoomBy(1 / 1.4), t("zoom out")],
          ["⤢", () => controls.current?.fit(), t("fit the map")],
        ].map(([label, fn, title]) => (
          <button key={label as string} type="button" title={title as string} onClick={fn as () => void} className="font-mono h-9 w-9 border-b border-white/[0.06] text-[15px] text-white/70 transition last:border-b-0 hover:bg-white/[0.06] hover:text-white">
            {label as string}
          </button>
        ))}
      </div>
      <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-white/35">{t("ctrl + scroll or two fingers to zoom · drag to move · tap a bubble")}</p>
    </div>
  );
}
