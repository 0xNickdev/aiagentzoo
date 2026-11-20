import { useCallback, useEffect, useState } from "react";
import { nodeOf } from "../../zoo";

/** The contests live on the node that hosts the judges; null until it answers, and it stays null if it never does. */
export function useContestApi<T>(path: string | null, everyMs = 60_000): { data: T | null; failed: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const load = async () => {
      try {
        const node = await nodeOf("beaver");
        if (!node) throw new Error("no node");
        const r = await fetch(`${node.url}${path}`);
        if (!r.ok) throw new Error(String(r.status));
        const b = (await r.json()) as T;
        if (live) (setData(b), setFailed(false));
      } catch {
        if (live) setFailed(true);
      }
    };
    void load();
    const id = window.setInterval(load, everyMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [path, everyMs, n]);
  return { data, failed, reload };
}

export interface Score {
  name: string;
  score: number;
  graded: number;
}

/** Humans vs the odds model: tonight's exam, this week's humans and the model they play against. */
export interface HumansView {
  night: string;
  exam: ExamToken[];
  mine: Record<string, Verdict>;
  rules: { minGraded: number; minSide: number; holdMin?: number };
  week: { start: string; end: string; endsAt: string };
  /** The odds model's score this week, the bar people play against. bestJudge carries the same object for older clients. */
  baseline?: Score | null;
  standings: HumanRow[];
  lastWeekTop: Array<{ wallet: string; score: number; graded: number }>;
}
export const opponentOf = (v: HumansView | null): Score | null => v?.baseline ?? null;

export type Verdict = "suspicious" | "watch" | "promising";
export interface ExamToken {
  mint: string;
  symbol: string;
  graduated?: boolean;
  hasSocials?: boolean | null;
  market?: { liq: number | null; vol24h: number | null; change24h: number | null; buys24h: number; sells24h: number } | null;
  flags?: string[];
  chain?: { creatorSold: number | null; creatorLaunches24h: number; buyers: number; top5Share: number | null; bundleWallets?: number | null } | null;
}
export interface HumanRow {
  id: string;
  graded: number;
  score: number;
  dead: number;
  alive: number;
  ranked: boolean;
  you?: boolean;
}

/** Agent of the week: guest agents graded by the next day's market. */
export interface WeekRow {
  id: string;
  name: string;
  kind?: string;
  score: number;
  graded: number;
  dead: number;
  alive: number;
  ranked: boolean;
}
export interface Weekly {
  minGraded: number;
  minSide: number;
  minAliveRight?: number;
  week: { start: string; end: string; endsAt: string; standings: WeekRow[]; bar?: { skill: number; nights: number } | null };
  lastWeek: { start: string; end: string; winner: WeekRow | null; best?: WeekRow | null; bar?: { skill: number; nights: number } | null };
}

export const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);

/** "2d 4h" or "3h 12m" until a moment. */
export function timeLeft(endsAt: string, now = Date.now()): string {
  const ms = Math.max(0, Date.parse(endsAt) - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d ? `${d}d ${h}h` : `${h}h ${m}m`;
}
