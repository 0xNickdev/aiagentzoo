import { useEffect, useState } from "react";
import { nodeOf } from "../zoo";

export interface Tally {
  hits: number;
  misses: number;
  dead: number;
  deadRight: number;
  alive: number;
  aliveRight: number;
  watched: number;
}

export interface Creature {
  id: string;
  name: string;
  house: string;
  generation: number;
  parents: [string, string] | null;
  temperament: string;
  mutation: string | null;
  bornNight: string;
  diedNight: string | null;
  epitaph: string | null;
  lifetime: Tally;
  window: Tally;
  accuracy: number | null;
  /** Balanced accuracy since the last turn, and over the whole life. */
  skill: number | null;
  lifetimeSkill: number | null;
  fitness: number;
  graded: number;
  starving: boolean;
}

export interface ChronicleEntry {
  night: string;
  generation: number;
  kind: "founded" | "scored" | "death" | "birth" | "extinct";
  text: string;
  ids: string[];
  at: number;
}

export interface Nursery {
  night: string;
  generation: number;
  nextGenerationInNights: number;
  /** What selection would do if the turn came now, computed by the node itself. */
  preview: { dies: string; parents: string[] } | null;
  creatures: Creature[];
  chronicle: ChronicleEntry[];
  history: Array<{ generation: number; night: string; accuracy: number | null; best: string | null }>;
  exam: {
    night: string;
    tokens: Array<{ mint: string; symbol: string }>;
    answered: string[];
    tonight?: Record<string, { suspicious: number; watch: number; promising: number }>;
  } | null;
}

export interface Case {
  mint: string;
  symbol: string;
  verdict: "promising" | "watch" | "suspicious";
  why: string;
  outcome: "dead" | "alive" | "unknown" | null;
  hit: boolean | null;
}

export interface CreatureDetail extends Omit<Creature, "parents" | "fitness" | "graded"> {
  playbook: string;
  parents: Array<{ id: string; name: string; house: string; playbook: string }>;
  children: Array<{ id: string; name: string }>;
  record: Array<{ night: string; scored: boolean; cases: Case[] }>;
}

let host: Promise<string> | null = null;
/** The node that keeps the nursery: the heron's, or the beaver's before the directory knows the heron. */
export function nurseryHost(): Promise<string> {
  host ??= (async () => {
    const node = (await nodeOf("heron")) ?? (await nodeOf("beaver"));
    if (!node) throw new Error("no nursery host");
    return node.url;
  })().catch((e) => {
    host = null;
    throw e;
  });
  return host;
}

export function useNursery(): { data: Nursery | null; state: "loading" | "ready" | "empty" | "offline" } {
  const [data, setData] = useState<Nursery | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "offline">("loading");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`${await nurseryHost()}/v1/evolution`);
        if (!live) return;
        if (res.status === 404) return setState("empty");
        setData((await res.json()) as Nursery);
        setState("ready");
      } catch {
        if (live) setState((s) => (s === "ready" ? s : "offline"));
      }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return { data, state };
}

export async function loadCreature(id: string): Promise<CreatureDetail> {
  const res = await fetch(`${await nurseryHost()}/v1/evolution/${id}`);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as CreatureDetail;
}

export const portrait = (house: string) => `/evolution/${house.toLowerCase()}.webp`;
export const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);
export const pad = (n: number) => String(n).padStart(2, "0");

/** A night id plus some days, as a short date: "Oct 13". */
export const dayOf = (night: string, plus = 0) =>
  new Date(Date.parse(`${night}T00:00:00Z`) + plus * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
