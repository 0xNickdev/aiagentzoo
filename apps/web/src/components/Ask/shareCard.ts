import { lang, t } from "../../i18n";
import { base, eyes, FG2, FG4, HAIR, header, loadFonts, small } from "../cardKit";
import type { Ask } from "./types";
import { evidence, gradeDue, TONE, when } from "./shared";

/* ---------- the shareable card ---------- */

export const W = 1200;
export const H = 675;

export async function drawCard(canvas: HTMLCanvasElement, a: Ask): Promise<void> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  await loadFonts();
  base(ctx, W, H);
  eyes(ctx, 975, 330, 70);

  const L = 72;
  const tone = TONE[a.verdict];
  await header(ctx, L, 86, t("Ask"));

  ctx.font = '600 64px "Geist", sans-serif';
  ctx.fillStyle = "#fff";
  ctx.fillText(`$${a.symbol}`.slice(0, 18), L - 3, 166);
  ctx.font = small(15);
  ctx.fillStyle = FG4;
  ctx.fillText(`${a.mint.slice(0, 6)}…${a.mint.slice(-6)}`, L, 196);

  ctx.font = '600 92px "Geist", sans-serif';
  ctx.fillStyle = tone.color;
  ctx.fillText(t(tone.label), L - 4, 310);
  ctx.font = small(15);
  ctx.fillStyle = FG4;
  ctx.fillText(t("confidence {c}% · playbook v{v}", { c: Math.round(a.confidence * 100), v: a.playbookVersion }), L, 344);

  // The reason, wrapped to two lines.
  ctx.font = '400 27px "Geist", sans-serif';
  ctx.fillStyle = FG2;
  const words = lang() === "zh" && a.whyZh ? Array.from(a.whyZh) : a.why.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    // Chinese wraps by character, with no spaces between.
    const next = line ? `${line}${lang() === "zh" && a.whyZh ? "" : " "}${w}` : w;
    if (ctx.measureText(next).width > 640 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(i === 2 && lines.length > 3 ? `${l}…` : l, L, 402 + i * 38));

  // Three facts across the bottom, between hairlines.
  const ev = evidence(a).filter(([, , bad]) => bad).concat(evidence(a).filter(([, , bad]) => !bad)).slice(0, 3);
  const top = 528;
  ctx.strokeStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(L, top + 0.5);
  ctx.lineTo(L + 660, top + 0.5);
  ctx.stroke();
  ev.forEach(([k, v, bad], i) => {
    const x = L + i * 220;
    ctx.font = '600 28px "Geist", sans-serif';
    ctx.fillStyle = bad ? "#ff8a7e" : "#fff";
    ctx.fillText(v, x, top + 42);
    ctx.font = small(14);
    ctx.fillStyle = FG4;
    ctx.fillText(t(k).replace(/^./, (x) => x.toUpperCase()), x, top + 68);
  });

  ctx.font = small(15);
  ctx.fillStyle = FG4;
  ctx.fillText(t("graded against reality on {when} · zooaiagency.com/ask", { when: when(gradeDue(a)) }).replace(/^./, (x) => x.toUpperCase()), L, H - 40);
}
