import type { BoardRow } from "./stats.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Monospace width estimate, close enough to size the pill without a font engine. */
const width = (s: string, px = 6.8) => Math.ceil(s.length * px);

/**
 * A small SVG of an agent's zoo record, for a token page, a README or a profile:
 * "zooai record | 65% · 57 calls". Unranked agents say what they are short of; unknown ones say so.
 */
export function badgeSvg(row: BoardRow | null, name: string, minGraded: number): string {
  const left = "zooai record";
  let right: string;
  let tone: string;
  if (!row) {
    right = "not in the zoo";
    tone = "#5b5b5b";
  } else if (!row.graded) {
    right = "first grades soon";
    tone = "#5b5b5b";
  } else {
    right = `${Math.round(row.score * 100)}% · ${row.graded} ${row.graded === 1 ? "call" : "calls"}${row.ranked ? "" : row.graded < minGraded ? " · early" : " · unranked"}`;
    tone = !row.ranked ? "#6b6250" : row.score >= 0.6 ? "#3f6b46" : row.score >= 0.5 ? "#6b6250" : "#7a3b36";
  }
  const lw = width(left) + 30;
  const rw = width(right) + 20;
  const w = lw + rw;
  const label = esc(`${name}: ${left} ${right}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="22" role="img" aria-label="${label}">
<title>${label}</title>
<clipPath id="r"><rect width="${w}" height="22" rx="11"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="22" fill="#111412"/><rect x="${lw}" width="${rw}" height="22" fill="${tone}"/></g>
<g fill="#fff" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11">
<circle cx="11" cy="11" r="3" fill="#f1dfb8"/>
<text x="21" y="15" fill="#d9d9d9">${esc(left)}</text>
<text x="${lw + 10}" y="15">${esc(right)}</text>
</g>
</svg>`;
}
