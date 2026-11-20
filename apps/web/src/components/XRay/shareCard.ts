import { chainName } from "../../chain";
import { t, tChain } from "../../i18n";
import { base, FG2, FG4, HAIR, header, loadFonts, small } from "../cardKit";
import { pctFine } from "../../format";
import type { XRayReport } from "./types";
import { TONE, venueLabel, VWORD } from "./shared";
import { oddsPct } from "./ui";

/** The x-ray as a 1200x675 picture worth posting: verdict, the first reason, three numbers and the map of the first seconds. */
export async function drawXRay(canvas: HTMLCanvasElement, r: XRayReport): Promise<void> {
  const W = 1200;
  const H = 675;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  await loadFonts();
  base(ctx, W, H);
  const c = r.check;
  const f = c.facts;
  const tone = TONE[c.verdict];
  const L = 72;

  // The first five seconds on the right: the dev in the middle, the early wallets around it.
  const cx = 930;
  const cy = 330;
  const early = r.early.slice(0, 14);
  early.forEach((e, i) => {
    const crew = e.crew;
    const ring = 120 + (i % 2) * 70 + (crew ? -60 : 0);
    const a = -Math.PI / 2 + (i / Math.max(1, early.length)) * Math.PI * 2;
    const x = cx + Math.cos(a) * ring * 1.15;
    const y = cy + Math.sin(a) * ring;
    const color = crew ? "#ff8a7e" : e.ring ? "#ffc27a" : e.serial ? "#c9b48a" : "#a6e3b4";
    if (crew) {
      ctx.strokeStyle = "rgba(255,138,126,0.45)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    const rad = 8 + Math.sqrt(Math.max(0, e.bought)) * 110;
    const held = e.bought > 0 ? e.held / e.bought : 0;
    // Flagged wallets fill by what they still hold; the rest stay open rings.
    ctx.globalAlpha = crew || e.ring || e.serial ? 0.12 + held * 0.5 : 0.06;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = "#030504";
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = small(14);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText("dev", cx, cy + 5);
  ctx.textAlign = "left";
  const shade = ctx.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, "rgba(3,5,4,0.98)");
  shade.addColorStop(0.55, "rgba(3,5,4,0.85)");
  shade.addColorStop(0.7, "rgba(3,5,4,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  await header(ctx, L, 86, `X-Ray · ${venueLabel(f)}`);
  ctx.font = '600 64px "Geist", sans-serif';
  ctx.fillStyle = "#fff";
  ctx.fillText(`$${r.symbol.replace(/^\$/, "")}`.slice(0, 16), L - 3, 166);
  ctx.font = small(15);
  ctx.fillStyle = FG4;
  ctx.fillText(`${r.mint.slice(0, 6)}…${r.mint.slice(-6)}`, L, 196);
  // The verdict in one word and the odds of a run, as the dashboard reads them; no 0-100 score.
  const word = t((VWORD[c.verdict] ?? VWORD.unknown!).w);
  const odds = c.odds ? t("{p}% alive tomorrow", { p: oddsPct(c.odds.run) }) : null;
  let size = 84;
  ctx.font = `600 ${size}px "Geist", sans-serif`;
  while (size > 48 && ctx.measureText(word).width > 640) ctx.font = `600 ${(size -= 4)}px "Geist", sans-serif`;
  ctx.fillStyle = tone.color;
  ctx.fillText(word, L - 4, 300);
  if (odds) {
    ctx.font = '500 30px "Geist", sans-serif';
    ctx.fillStyle = "#fff";
    ctx.fillText(odds, L, 348);
  }
  const reasonTop = odds ? 400 : 356;

  // The first reason, wrapped.
  ctx.font = '400 26px "Geist", sans-serif';
  ctx.fillStyle = FG2;
  const reason = c.reasons[0]
    ? tChain(c.reasons[0]).replace(/^./, (x) => x.toUpperCase())
    : r.outsideStream
      ? t("Launched before our stream. Who holds it now is what we read.")
      : t("No red flags on chain so far. Not a call that it goes up.");
  const zh = /[\u4e00-\u9fff]/.test(reason);
  const words = zh ? Array.from(reason) : reason.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line}${zh ? "" : " "}${w}` : w;
    if (ctx.measureText(next).width > 600 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(i === 2 && lines.length > 3 ? `${l}…` : l, L, reasonTop + i * 36));

  const took = r.early.reduce((n, e) => n + e.bought, 0);
  const h = c.holders;
  const facts: Array<[string, string, boolean]> = r.outsideStream
    ? [
        [t("top 10 hold"), h ? `${h.top10Pct}%` : "-", (h?.top10Pct ?? 0) >= 50],
        [t("largest wallet"), h ? `${h.topWalletPct}%` : "-", (h?.topWalletPct ?? 0) >= 20],
        [t("dev holds"), h?.creatorHoldsPct != null ? `${h.creatorHoldsPct}%` : "-", false],
      ]
    : [
    [t("wallets in the first 5 s"), String(r.early.length), r.early.length >= 5],
    [t("supply they took"), pctFine(took), took >= 0.25],
    f && (f.creatorCrew ?? 0) > 0 ? [t("the creator's own crew"), String(f.creatorCrew), true] : [t("serial snipers"), String(f?.serialSnipers ?? 0), (f?.serialSnipers ?? 0) >= 3],
  ];
  const top = 520;
  ctx.strokeStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(L, top + 0.5);
  ctx.lineTo(L + 620, top + 0.5);
  ctx.stroke();
  facts.forEach(([k, v, bad], i) => {
    const x = L + i * 210;
    ctx.font = '600 30px "Geist", sans-serif';
    ctx.fillStyle = bad ? "#ff8a7e" : "#fff";
    ctx.fillText(v, x, top + 50);
    ctx.font = small(14);
    ctx.fillStyle = FG4;
    ctx.fillText(k.replace(/^./, (x) => x.toUpperCase()), x, top + 76);
  });
  ctx.font = small(15);
  ctx.fillStyle = FG4;
  ctx.fillText(t("read straight from {chain} · zooaiagency.com/xray", { chain: chainName(r.mint) }).replace(/^./, (x) => x.toUpperCase()), L, H - 40);
}
