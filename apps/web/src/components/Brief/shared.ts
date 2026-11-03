import { loadDirectory } from "../../zoo";
import { DEXSCREENER_URL } from "../../links";
import type { Market } from "./types";

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`;
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);

export async function nodeUrl(agent: string): Promise<string | undefined> {
  return (await loadDirectory()).find((n) => n.agents.includes(agent))?.url;
}

export const clean = (t: string) => t.replace(/[\u2013\u2014]/g, "-");

/** The archivist's paragraph, lifted from the brief's markdown. */
export function reviewOf(markdown: string): string | null {
  const m = /## Night in review\n+([\s\S]*?)(?:\n## |$)/.exec(markdown);
  if (!m) return null;
  return clean(m[1]!.trim().replace(/^Night in review:\s*/i, "")) || null;
}

export const dex = (o: { mint: string; market?: Market | null }) => o.market?.url ?? `${DEXSCREENER_URL}/solana/${o.mint}`;

export type TabKey = "topVolume" | "wentToZero" | "graduated" | "suspicious" | "promoted";
export const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "topVolume", label: "Top volume" },
  { key: "wentToZero", label: "Went to zero" },
  { key: "graduated", label: "Graduated" },
  { key: "suspicious", label: "Suspicious" },
  { key: "promoted", label: "Freshly promoted" },
];
