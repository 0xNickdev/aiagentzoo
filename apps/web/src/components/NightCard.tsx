import { accuracyLabel } from "../accuracy";
import { motion } from "framer-motion";
import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { X_URL, XIcon } from "../links";
import { base, eyes, FG2, FG4, HAIR, header, loadFonts, small } from "./cardKit";

export interface NightCardData {
  night: string;
  observed: number;
  launches: number;
  graduated: number;
  wentToZero: number;
  /** One line about the most telling flag of the night, e.g. a creator dumping. */
  highlight: string | null;
  /** What happened in the nursery that night, if anything. */
  nursery: string | null;
  skill: number | null;
  /** Calls the accuracy rests on. */
  scored: number;
}

const W = 1200;
const H = 675;

/** Breaks text into lines that fit `width`, at most `max` lines, the last one ellipsised. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
      if (lines.length === max) break;
    } else line = next;
  }
  if (lines.length < max && line) lines.push(line);
  if (lines.length === max && words.join(" ") !== lines.join(" ")) {
    let last = lines[max - 1]!;
    while (ctx.measureText(`${last}…`).width > width && last.length) last = last.slice(0, -1);
    lines[max - 1] = `${last}…`;
  }
  return lines;
}

/** Draws the night as a 1200×675 card in the zoo's look: the night's image, hairlines, one type family. */
export async function drawNightCard(canvas: HTMLCanvasElement, d: NightCardData): Promise<void> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  await loadFonts();
  base(ctx, W, H);
  eyes(ctx, 975, 330, 70);

  const L = 72;
  ctx.textBaseline = "alphabetic";

  await header(ctx, L, 86, "Morning Brief");

  const date = new Date(`${d.night}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  ctx.font = '600 68px "Geist", sans-serif';
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`Night of ${date}`, L - 3, 168);

  // Figures between hairlines, with "+" marks at the corners.
  const figures: Array<[string, string]> = [
    [d.observed.toLocaleString("en-US"), "tokens watched"],
    [d.launches.toLocaleString("en-US"), "fresh launches"],
    [String(d.graduated), "graduated"],
    [String(d.wentToZero), "went to zero"],
  ];
  const top = 214;
  const fw = 158;
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L, top + 0.5);
  ctx.lineTo(L + fw * 4, top + 0.5);
  ctx.moveTo(L, top + 92.5);
  ctx.lineTo(L + fw * 4, top + 92.5);
  ctx.stroke();
  figures.forEach(([v, k], i) => {
    const x = L + i * fw + (i ? 18 : 0);
    ctx.font = '600 32px "Geist", sans-serif';
    ctx.fillStyle = "#ffffff";
    ctx.fillText(v, x, top + 50);
    ctx.font = small(14);
    ctx.fillStyle = FG4;
    ctx.fillText(k.replace(/^./, (c) => c.toUpperCase()), x, top + 76);
  });

  let y = top + 150;
  const block = (label: string, text: string, accent: string) => {
    ctx.font = small(15);
    ctx.fillStyle = accent;
    ctx.fillText(label, L, y);
    y += 34;
    ctx.font = '400 26px "Geist", sans-serif';
    ctx.fillStyle = FG2;
    for (const line of wrap(ctx, text, 620, 2)) {
      ctx.fillText(line, L, y);
      y += 36;
    }
    y += 22;
  };
  if (d.highlight) block("The night's tell", d.highlight, "#ff8a7e");
  if (d.nursery) block("In the nursery", d.nursery, "#ffc27a");

  ctx.font = small(15);
  ctx.fillStyle = FG4;
  const foot = `${d.skill === null ? "" : `Balanced accuracy ${accuracyLabel(d.skill, d.scored)} · `}${d.skill === null ? "Signed" : "signed"} on the public log · zooaiagency.com`;
  ctx.fillText(foot, L, H - 54);
}

export default function NightCard({ data, onClose }: { data: NightCardData; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    void drawNightCard(canvas.current, data).then(() => setUrl(canvas.current!.toDataURL("image/png")));
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tweet = encodeURIComponent(
    [`night of ${data.night}: ${data.launches.toLocaleString("en-US")} fresh launches, ${data.wentToZero} went to zero.`, data.nursery ?? data.highlight ?? "", "", `zooaiagency.com/brief#${data.night}`]
      .filter((l, i) => l || i === 2)
      .join("\n"),
  );

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Night card"
        className="w-full max-w-4xl rounded-2xl bg-[#070908] p-4 ring-1 ring-white/10 sm:p-6"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="tabular-nums text-[12.5px] text-fg-3">The night card · 1200 × 675</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-fg-4 ring-1 ring-white/15 hover:text-white">
            <X size={15} />
          </button>
        </div>
        <canvas ref={canvas} className="hidden" />
        <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
          {url ? <img src={url} alt={`Night card for ${data.night}`} className="h-full w-full" /> : <div className="h-full w-full animate-pulse bg-white/[0.03]" />}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <a
            href={url ?? undefined}
            download={`zooai-night-${data.night}.png`}
            className={`inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-medium text-black ${url ? "hover:bg-white/90" : "pointer-events-none opacity-50"}`}
          >
            <Download size={14} /> Download PNG
          </a>
          <a
            href={`https://x.com/intent/post?text=${tweet}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-night-surface border border-white/[0.08] inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] text-fg hover:text-white"
            title={`Attach the downloaded card. Follow ${X_URL.replace("https://x.com/", "@")}`}
          >
            <XIcon size={13} /> Post on X
          </a>
        </div>
        <p className="mt-3 text-right text-[13px] text-fg-4">Download the card first, then attach it to the post.</p>
      </motion.div>
    </motion.div>
  );
}
