/** Shared look of the share cards (X-Ray, Ask, Night card): the night with one moss glow, the wordmark, solid text in one family. */

export const FG2 = "#e6e9e7";
export const FG4 = "#a3aaa6";
export const HAIR = "rgba(255,255,255,0.14)";
/** Small text on the cards: Geist, never monospace. */
export const small = (n: number) => `500 ${n}px "Geist", -apple-system, sans-serif`;

export async function loadFonts(): Promise<void> {
  await Promise.all([document.fonts.load('600 64px "Geist"'), document.fonts.load('500 16px "Geist"'), document.fonts.load('400 24px "Geist"')]);
}

const image = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });

/** Night and a quiet moss glow behind the copy. */
export function base(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.fillStyle = "#030504";
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, a] of [[W * 0.18, H * 0.3, 620, 0.2], [W * 0.8, H * 0.5, 480, 0.14]] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(70,110,85,${a})`);
    g.addColorStop(1, "rgba(70,110,85,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

/** The wordmark at the top left, then what the card is, in quiet text. */
export async function header(ctx: CanvasRenderingContext2D, x: number, y: number, label: string): Promise<void> {
  let w = 0;
  try {
    const logo = await image("/logo.svg");
    const h = 26;
    w = (logo.width / logo.height) * h || 104;
    ctx.drawImage(logo, x, y - h + 4, w, h);
  } catch {
    ctx.font = '600 26px "Geist", sans-serif';
    ctx.fillStyle = "#fff";
    ctx.fillText("ZOOAI", x, y);
    w = ctx.measureText("ZOOAI").width;
  }
  ctx.font = small(15);
  ctx.fillStyle = FG4;
  ctx.fillText(label, x + w + 16, y);
}

/** The two eyes of the logo, large, where a portrait used to sit. */
export function eyes(ctx: CanvasRenderingContext2D, cx: number, cy: number, r = 76): void {
  ctx.strokeStyle = "#e8ece9";
  ctx.fillStyle = "#e8ece9";
  ctx.lineWidth = r * 0.4;
  for (const dx of [-r * 1.25, r * 1.25]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + dx, cy, r * 0.33, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 1;
}
