import { animate } from "animejs/animation";
import { createTimeline } from "animejs/timeline";
import { stagger } from "animejs/utils";

/** Mints whose report already played its entrance, so a re-render or a section switch never replays it. */
const played = new Set<string>();

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The one entrance sequence of a report, as in the approved mockup: the verdict word, the gauge arc sweeping to the
 * odds, the reasons one by one, the tile numbers, the meters, the dev's squares filling, the time bars growing and
 * the trace edges drawing. Once per mint; nothing under prefers-reduced-motion.
 */
export function playIntro(root: HTMLElement, mint: string, odds: { to: number; fmt: (v: number) => string } | null) {
  if (played.has(mint)) return;
  played.add(mint);
  if (reduced()) return;
  const q = (s: string) => Array.from(root.querySelectorAll<HTMLElement | SVGElement>(s));
  const has = (s: string) => q(s).length > 0;
  try {
    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    if (has("[data-x=vword]")) tl.add(q("[data-x=vword]"), { opacity: [0, 1], translateY: [16, 0], duration: 800 });
    const fill = root.querySelector<SVGPathElement>("[data-x=gfill]");
    if (fill) {
      const len = fill.getTotalLength();
      fill.style.strokeDasharray = String(len);
      tl.add(fill, { strokeDashoffset: [len, 0], duration: 900 }, "-=600");
    }
    if (has("[data-x=reason]")) tl.add(q("[data-x=reason]"), { opacity: [0, 1], translateY: [5, 0], delay: stagger(55), duration: 500 }, "-=700");
    if (has(".x-tile .x-v")) tl.add(q(".x-tile .x-v"), { opacity: [0, 1], translateY: [5, 0], delay: stagger(40), duration: 500 }, "-=600");

    const num = root.querySelector<HTMLElement>("[data-x=oddsN]");
    if (num && odds) {
      const o = { v: Math.min(odds.to, 0.01) };
      animate(o, { v: odds.to, duration: 1200, ease: "outExpo", onUpdate: () => (num.textContent = odds.fmt(o.v)), onComplete: () => (num.textContent = odds.fmt(odds.to)) });
    }
    if (has(".x-meter i")) animate(q(".x-meter i"), { scaleX: [0, 1], delay: stagger(50, { start: 400 }), duration: 900, ease: "outExpo" });
    const squares = q(".x-strip span");
    if (squares.length) animate(squares, { opacity: [0, 1], delay: stagger(Math.max(0.4, 700 / squares.length), { start: 250 }), duration: 220, ease: "linear" });
    if (has(".x-track b")) animate(q(".x-track b"), { scaleX: [0, 1], delay: stagger(45, { start: 500 }), duration: 800, ease: "outExpo" });
    if (has(".x-t2 .x-seg")) animate(q(".x-t2 .x-seg"), { scaleX: [0, 1], delay: stagger(110, { start: 500 }), duration: 900, ease: "outExpo" });
    const ring = root.querySelector<SVGCircleElement>("[data-x=dring]");
    if (ring) {
      const to = ring.getAttribute("stroke-dasharray") ?? "0 100";
      animate(ring, { strokeDasharray: ["0 100", to], duration: 1100, delay: 400, ease: "outExpo" });
    }
    if (has("[data-x=edge]")) animate(q("[data-x=edge]"), { strokeDashoffset: [1, 0], strokeDasharray: ["1 1", "1 1"], delay: stagger(150, { start: 600 }), duration: 900, ease: "inOutQuad" });
  } catch {
    /* motion is a nicety: a failed animation leaves the page as rendered */
  }
}
