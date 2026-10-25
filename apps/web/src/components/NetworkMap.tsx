import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { select } from "d3-selection";
import { zoom, type ZoomTransform, zoomIdentity } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { t } from "../i18n";
import type { XRayReport } from "./XRay";

/**
 * The network around a token: the dev, his crew and regulars, the launch block, the serial snipers, who paid for him
 * and who else that wallet paid for, and his last launches. Drawn like the home page's scene: each wallet a glowing
 * clump of dust sized by what it took or how often it shows up, links as thin arcs with money running along them,
 * each group named in plain words. Canvas + d3-force + d3-zoom.
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

// The brand's four: danger for the dev and his people, warn for the regulars and the block, moss for money's source, white for the rest.
const COLOR: Record<Kind, string> = { dev: "#ff8a7e", crew: "#ff8a7e", ring: "#ffc27a", bundle: "#ffc27a", serial: "#d9dddb", early: "#e6e9e7", funder: "#a6e3b4", sibling: "#ff8a7e", coin: "#ff8a7e" };
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function build(r: XRayReport, dev: DevProfile | null): { nodes: Node[]; links: Link[]; total: number; record: { launches: number; dumped: number } } {
  // A token older than the stream has no launch record: 0 here means "not known", and the pill says only DEV.
  const total = dev?.launches48h ?? r.creatorRecord?.launches48h ?? (r.outsideStream ? 0 : 1);
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

/** A wallet as the hero draws it: a soft core and a seeded spray of dust, pre-rendered once per colour and size. */
function sprite(col: string, r: number, seed: number, strong: boolean): HTMLCanvasElement {
  const S = 2;
  const size = Math.ceil(r * 3.2) * 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size * S;
  const g = cv.getContext("2d")!;
  g.scale(S, S);
  const c = size / 2;
  const glow = g.createRadialGradient(c, c, 0, c, c, r * 1.6);
  glow.addColorStop(0, rgba(col, strong ? 0.55 : 0.32));
  glow.addColorStop(0.45, rgba(col, strong ? 0.18 : 0.1));
  glow.addColorStop(1, rgba(col, 0));
  g.fillStyle = glow;
  g.beginPath();
  g.arc(c, c, r * 1.6, 0, Math.PI * 2);
  g.fill();
  let x = seed * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const n = Math.round(Math.min(520, 30 + r * r * 1.4));
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const u = rnd() || 1e-6, v = rnd();
    const rr = r * Math.sqrt(-2 * Math.log(u)) * 0.38;
    const a = v * Math.PI * 2;
    const px = c + Math.cos(a) * rr, py = c + Math.sin(a) * rr;
    const near = 1 - Math.min(1, rr / (r * 1.2));
    g.fillStyle = i % 9 === 0 ? `rgba(255,255,255,${0.55 + near * 0.4})` : rgba(col, 0.35 + near * 0.6);
    const d = rnd() < 0.85 ? 0.9 : 1.5;
    g.fillRect(px - d / 2, py - d / 2, d, d);
  }
  return cv;
}

export default function NetworkMap({ r, onPick, onWallet }: { r: XRayReport; onPick: (mint: string) => void; onWallet: (wallet: string) => void }) {
  const [dev, setDev] = useState<DevProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<{ n: Node; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const controls = useRef<{ zoomBy: (k: number) => void; fit: () => void } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reticle = useRef<HTMLDivElement>(null);

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
    const ret = reticle.current;
    if (!graph || !el || !cv || !ret) return;
    const { nodes, links, total, record } = graph;
    const ctx = cv.getContext("2d")!;
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    let W = el.clientWidth;
    let H = el.clientHeight;
    const mobile = W < 640;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Each group has a home; on a phone they stack closer.
    const s = mobile ? 0.62 : 1;
    const home: Record<string, [number, number]> = { dev: [0, 0], crew: [-60, -20], ring: [190, -130], bundle: [-320, 40], serial: [350, 110], funder: [-230, -210], coin: [10, 290] };
    const R = (n: Node) => radius(n, total) * (mobile ? 0.8 : 1) * (n.kind === "dev" ? 0.7 : 0.85);
    const sim = forceSimulation<Node>(nodes)
      .force("link", forceLink<Node, Link>(links).id((d) => d.id).distance((l) => ({ crew: 70, sniped: 260, bundle: 30, launched: 240, funded: 60 })[l.kind] * s).strength((l) => (l.kind === "bundle" || l.kind === "funded" ? 0.7 : l.kind === "crew" ? 0.25 : 0.01)))
      .force("charge", forceManyBody<Node>().strength((d) => (d.kind === "dev" ? -300 : -40)))
      .force("x", forceX<Node>((d) => home[d.group]![0] * s).strength((d) => (d.kind === "dev" ? 1 : 0.14)))
      .force("y", forceY<Node>((d) => home[d.group]![1] * s).strength((d) => (d.kind === "dev" ? 1 : 0.14)))
      .force("collide", forceCollide<Node>((d) => R(d) * 1.25 + (d.kind === "coin" ? 22 : 4)).strength(1).iterations(3))
      .stop();
    for (let i = 0; i < 500; i++) sim.tick();

    const count = (g: Group) => nodes.filter((n) => n.group === g).length;
    const top = nodes.filter((n) => n.launches && n.group === "crew").sort((a, b) => (b.launches ?? 0) - (a.launches ?? 0))[0];
    const blockPct = nodes.filter((n) => n.group === "bundle").reduce((a, n) => a + n.pct, 0);
    const sibs = nodes.filter((n) => n.kind === "sibling");
    const GROUPS: Record<Group, { color: string; title: string; sub: string }> = {
      crew: { color: COLOR.crew, title: t("His crew"), sub: top ? t("{n} wallets · in {a} of his {b} launches in 48h", { n: count("crew"), a: top.launches ?? 0, b: total }) : t("{n} of his own wallets", { n: count("crew") }) },
      ring: { color: COLOR.ring, title: t("Regulars"), sub: t("{n} wallets · back in launch after launch", { n: count("ring") }) },
      bundle: { color: COLOR.bundle, title: t("Launch block"), sub: t("{n} wallets · {p}% bought in one slot", { n: count("bundle"), p: blockPct.toFixed(1) }) },
      serial: { color: COLOR.serial, title: t("Serial snipers"), sub: t("{n} wallets · first seconds of everything", { n: count("serial") }) },
      funder: { color: COLOR.funder, title: t("Same funder"), sub: sibs.length ? t("paid for {n} other devs · {d} dumps", { n: sibs.length, d: sibs.reduce((a, x) => a + (x.dumped ?? 0), 0) }) : t("one wallet paid for these") },
      coin: { color: COLOR.coin, title: t("His last launches"), sub: t("{n} shown · {d} of {b} dumped", { n: count("coin"), d: record.dumped, b: record.launches }) },
    };
    const colOf = (n: Node) => (n.kind === "coin" ? (n.outcome === "graduated" ? "#a6e3b4" : n.outcome === "dumped" ? "#ff8a7e" : "#e6e9e7") : COLOR[n.kind]);
    const sprites = new Map<Node, HTMLCanvasElement>();
    nodes.forEach((n, i) => sprites.set(n, sprite(colOf(n), R(n), i + 1, n.kind === "dev")));
    // where each group's name goes: above its highest member
    const groupLabels = (Object.keys(GROUPS) as Group[])
      .map((g) => {
        const m = nodes.filter((n) => n.group === g);
        if (!m.length) return null;
        const x = m.reduce((a, n) => a + n.x!, 0) / m.length;
        const y = Math.min(...m.map((n) => n.y! - R(n)));
        return { g, x, y };
      })
      .filter((x): x is { g: Group; x: number; y: number } => !!x);
    // money running along the links: a few dots per link, each at its own phase
    const flows = links.flatMap((l, i) => Array.from({ length: l.kind === "sniped" ? 1 : 2 }, (_, k) => ({ l, ph: ((i * 0.37 + k * 0.5) % 1), sp: 0.08 + ((i * 13) % 7) * 0.012 })));

    let tr: ZoomTransform = zoomIdentity;
    let hot: Node | null = null;
    let pin: Node | null = null;
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
      const [x0, x1, y0, y1] = [Math.min(...xs) - 70, Math.max(...xs) + 70, Math.min(...ys) - 90, Math.max(...ys) + 50];
      const k = Math.min(W / (x1 - x0), H / (y1 - y0), 1.3);
      return zoomIdentity.translate((W - k * (x1 + x0)) / 2, (H - k * (y1 + y0)) / 2).scale(k);
    };
    const curvePt = (a: Node, b: Node, u: number) => {
      // a gentle arc: the control point sits off the middle, always to the same side
      const mx = (a.x! + b.x!) / 2, my = (a.y! + b.y!) / 2;
      const dx = b.x! - a.x!, dy = b.y! - a.y!;
      const cx = mx - dy * 0.12, cy = my + dx * 0.12;
      const v = 1 - u;
      return [v * v * a.x! + 2 * v * u * cx + u * u * b.x!, v * v * a.y! + 2 * v * u * cy + u * u * b.y!] as const;
    };

    let time = 0;
    const draw = () => {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(tr.x, tr.y);
      ctx.scale(tr.k, tr.k);
      const focus = pin ?? hot;
      // links: hairline arcs, brighter for the focused node
      for (const l of links) {
        const a = l.source as Node, b = l.target as Node;
        const on = focus && (a === focus || b === focus);
        const mx = (a.x! + b.x!) / 2, my = (a.y! + b.y!) / 2;
        const dx = b.x! - a.x!, dy = b.y! - a.y!;
        ctx.beginPath();
        ctx.moveTo(a.x!, a.y!);
        ctx.quadraticCurveTo(mx - dy * 0.12, my + dx * 0.12, b.x!, b.y!);
        const base = { crew: 0.28, bundle: 0.34, sniped: 0.07, launched: 0.12, funded: 0.34 }[l.kind];
        ctx.strokeStyle = on ? "rgba(255,255,255,0.75)" : rgba(colOf(b.kind === "coin" ? b : a), focus ? base * 0.45 : base);
        ctx.lineWidth = (on ? 1.4 : l.kind === "crew" ? 0.6 + 1.4 * l.w : 0.7) / Math.sqrt(tr.k);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "lighter";
      for (const f of flows) {
        const a = f.l.source as Node, b = f.l.target as Node;
        const u = (f.ph + time * f.sp) % 1;
        const [x, y] = curvePt(a, b, u);
        const on = focus && (a === focus || b === focus);
        ctx.fillStyle = on ? "rgba(255,255,255,0.95)" : rgba(colOf(b.kind === "coin" ? b : a), focus ? 0.25 : 0.7);
        const d = 1.6 / Math.sqrt(tr.k);
        ctx.fillRect(x - d / 2, y - d / 2, d, d);
      }
      // wallets as glowing dust
      for (const n of [...nodes].sort((x, y) => R(x) - R(y))) {
        const sp = sprites.get(n)!;
        const size = sp.width / 2;
        const dim = focus && n !== focus && !links.some((l) => (l.source === focus && l.target === n) || (l.target === focus && l.source === n));
        ctx.globalAlpha = dim ? 0.35 : n.held === 0 && n.kind !== "dev" ? 0.6 : 1;
        ctx.drawImage(sp, n.x! - size / 2, n.y! - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();
      // names: the dev's pill, the coins, the groups
      ctx.textBaseline = "middle";
      for (const n of nodes) {
        const [x, y] = tr.apply([n.x!, n.y!]);
        const rad = R(n) * tr.k;
        if (n.kind === "dev") {
          const label = record.launches > 0 ? `${t("DEV")} · ${t("{d}/{n} dumped", { d: record.dumped, n: record.launches })}` : t("DEV");
          ctx.font = "600 11px Geist, system-ui, sans-serif";
          const w = ctx.measureText(label).width + 16;
          const lx = x + rad + 10, ly = y;
          ctx.fillStyle = "rgba(20,8,7,0.8)";
          ctx.strokeStyle = "rgba(255,138,126,0.55)";
          ctx.beginPath();
          ctx.roundRect(lx, ly - 11, w, 22, 11);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#ffb3aa";
          ctx.textAlign = "left";
          ctx.fillText(label, lx + 8, ly + 0.5);
        } else if (n.kind === "coin" && n.label && (tr.k > 0.95 || n === focus)) {
          ctx.font = "500 11px Geist, system-ui, sans-serif";
          ctx.fillStyle = n === focus ? "#ffffff" : "#d9dddb";
          ctx.textAlign = "left";
          ctx.fillText(n.label, x + rad + 6, y);
        } else if ((n.kind === "crew" || n.kind === "ring") && n.launches && rad > 9) {
          ctx.font = "600 10.5px Geist, system-ui, sans-serif";
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText(`${n.launches}×`, x, y);
        }
      }
      for (const l of groupLabels) {
        const [x, y] = tr.apply([l.x, l.y]);
        const g = GROUPS[l.g];
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.font = "600 12px Geist, system-ui, sans-serif";
        ctx.fillStyle = g.color;
        ctx.fillText(g.title, x, y - 28);
        ctx.font = `400 ${mobile ? 11 : 12}px Geist, system-ui, sans-serif`;
        ctx.fillStyle = "#d9dddb";
        ctx.fillText(g.sub, x, y - 12);
      }
      // the scanner's reticle on the focused node
      if (focus) {
        const [x, y] = tr.apply([focus.x!, focus.y!]);
        const sc = Math.max(0.6, (R(focus) * tr.k * 2 + 18) / 40);
        ret.style.opacity = "1";
        ret.style.transform = `translate(${x}px, ${y}px) scale(${sc.toFixed(3)})`;
      } else ret.style.opacity = "0";
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
        if (pin) setPicked(null);
        pin = null;
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
      for (const n of nodes) if (Math.hypot(n.x! - x, n.y! - y) <= R(n) + 6 / tr.k && (!best || R(n) < R(best))) best = n;
      return best;
    };
    const move = (ev: MouseEvent) => {
      const n = pick(ev);
      cv.style.cursor = n ? "pointer" : "grab";
      if (hot !== n) {
        hot = n;
        draw();
      }
    };
    const click = (ev: MouseEvent) => {
      const n = pick(ev);
      pin = n;
      setPicked(n ? { n, x: ev.offsetX, y: ev.offsetY } : null);
      draw();
    };
    cv.addEventListener("mousemove", move);
    cv.addEventListener("click", click);
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(el);
    // animate only while the map is on screen
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(el);
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (visible && !reduce) {
        time += dt;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    void document.fonts?.ready.then(draw);
    draw();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      cv.removeEventListener("mousemove", move);
      cv.removeEventListener("click", click);
      sel.on(".zoom", null);
    };
  }, [graph, onPick, onWallet, dev]);

  const n = picked?.n;
  const total = graph?.total ?? 1;
  const kindName: Record<Kind, string> = { crew: t("His crew"), ring: t("Regular"), bundle: t("Launch block"), serial: t("Serial sniper"), early: t("First 5 seconds"), funder: t("Funder"), sibling: t("Another dev, same funder"), coin: t("His launch"), dev: t("The dev") };
  return (
    <div ref={wrap} className="relative h-[560px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[radial-gradient(60%_60%_at_50%_45%,rgba(70,110,85,0.10),transparent_70%)] bg-night sm:h-[640px]">
      <canvas ref={canvas} className="block" style={{ touchAction: "pan-y" }} />
      <div ref={reticle} aria-hidden className="pointer-events-none absolute left-0 top-0 -ml-5 -mt-5 h-10 w-10 opacity-0 transition-opacity duration-150">
        {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((c) => {
          const [v, h] = c.split("-") as ["top" | "bottom", "left" | "right"];
          const edge = "1.5px solid rgba(255,255,255,0.95)";
          return <i key={c} className="absolute h-[9px] w-[9px] drop-shadow-[0_0_4px_rgba(255,255,255,0.5)]" style={{ [v]: 0, [h]: 0, [`border${v === "top" ? "Top" : "Bottom"}`]: edge, [`border${h === "left" ? "Left" : "Right"}`]: edge }} />;
        })}
      </div>
      {!graph && <p className="absolute inset-0 grid place-items-center text-[13px] text-fg-4">{t("Drawing the network…")}</p>}
      {n && picked && (
        <div
          role="dialog"
          className="absolute z-10 w-[260px] rounded-xl border border-white/[0.14] bg-night-surface/95 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl"
          style={{ left: Math.max(8, Math.min(picked.x + 18, (wrap.current?.clientWidth ?? 0) - 276)), top: Math.max(8, Math.min(picked.y - 24, (wrap.current?.clientHeight ?? 0) - 230)) }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium" style={{ color: COLOR[n.kind] }}>{kindName[n.kind]}</p>
              <p className="mt-0.5 truncate text-[15px] font-semibold text-white">{n.kind === "coin" ? n.label : n.kind === "dev" ? short(r.creator) : short(n.id)}</p>
            </div>
            <button type="button" onClick={() => setPicked(null)} aria-label={t("Close")} className="-mr-1 -mt-1 rounded-md px-1.5 text-[18px] leading-none text-fg-4 hover:text-white">
              ×
            </button>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-white/[0.08] pt-3 text-[13px] text-fg-3">
            {n.kind === "dev" && <p>{t("{d} of {n} launches dumped in 48h", { d: graph?.record.dumped ?? 0, n: graph?.record.launches ?? 0 })}</p>}
            {n.launches !== undefined && n.kind !== "sibling" && <p>{t("in {a} of his {b} launches in 48h", { a: n.launches, b: total })}</p>}
            {n.kind === "sibling" && <p>{t("{a} launches · {d} dumped in 48h", { a: n.launches ?? 0, d: n.dumped ?? 0 })}</p>}
            {!!n.pct && <p>{t("bought {p}% of supply", { p: n.pct })}{n.sec !== undefined ? t(", {s}s after launch", { s: n.sec }) : ""}</p>}
            {n.held === 0 && <p className="text-danger">{t("already sold out")}</p>}
            {n.snipes !== undefined && <p>{t("{n} snipes in 48h", { n: n.snipes })}</p>}
            {n.kind === "coin" && <p className={n.outcome === "dumped" ? "text-danger" : ""}>{n.outcome === "dumped" ? t("dev dumped it") : n.outcome === "graduated" ? t("graduated") : t("dev still holding")}</p>}
          </div>
          {n.kind !== "dev" && (
            <button type="button" onClick={() => (n.kind === "coin" ? onPick(n.id.slice(2)) : onWallet(n.id))} className="mt-3 text-[13.5px] font-medium text-white hover:underline">
              {n.kind === "coin" ? t("Open X-Ray") : t("Open the wallet")} →
            </button>
          )}
        </div>
      )}
      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-night-surface/90">
        {[
          ["+", () => controls.current?.zoomBy(1.4), t("zoom in")],
          ["−", () => controls.current?.zoomBy(1 / 1.4), t("zoom out")],
          ["⤢", () => controls.current?.fit(), t("fit the map")],
        ].map(([label, fn, title]) => (
          <button key={label as string} type="button" title={title as string} onClick={fn as () => void} className="h-9 w-9 border-b border-white/[0.08] text-[15px] text-fg-3 transition last:border-b-0 hover:bg-white/[0.06] hover:text-white">
            {label as string}
          </button>
        ))}
      </div>
      <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[12px] text-fg-4">{t("Drag to move · pinch or ⌘ scroll to zoom · click a dot")}</p>
    </div>
  );
}
