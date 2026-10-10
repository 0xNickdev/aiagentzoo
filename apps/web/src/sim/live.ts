import { useEffect, useRef, useState } from "react";
import type { SpeciesId } from "../data";
import type { NightWatch } from "./nightWatch";

/** Comma-separated node base URLs, e.g. `http://localhost:8781,http://localhost:8782`. */
export const NODE_URLS: string[] = (import.meta.env.VITE_ZOO_NODES ?? "")
  .split(",")
  .map((s: string) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

const SPECIES_OF: Record<string, SpeciesId> = {
  raven: "sentinel",
  owl: "sentinel",
  hedgehog: "gatherer",
  otter: "gatherer",
  beaver: "builder",
  tortoise: "archivist",
};

interface Entry {
  seq: number;
  hash: string;
  event: {
    id: string;
    kind: "signal" | "trace" | "artifact" | "system";
    type: string;
    from: { node: string; agent: string };
    to?: { node: string; agent: string };
    payload: any;
    ts: number;
  };
}

export interface LiveLine {
  id: string;
  time: string;
  who: string;
  species: SpeciesId | null;
  text: string;
  hash: string;
}

export interface LiveState {
  enabled: boolean;
  connected: number;
  stats: { cycles: number; wakes: number; feed: number; signals: number; rejected: number; observed: number };
  log: LiveLine[];
  brief: { id: string; markdown: string; ts: number } | null;
}

const ANIMATE_WINDOW_MS = 60_000;

function describe(e: Entry["event"]): string | null {
  const p = e.payload ?? {};
  switch (e.type) {
    case "agent.woke": {
      const note = String(p.note ?? "");
      if (note.startsWith("guardian:")) return `was woken by guardian ${note.slice(9, 13)}…${note.slice(-4)}`;
      if (note === "visitor") return "was woken by a visitor";
      return null;
    }
    case "launches.found":
      return `found ${p.launches?.length ?? 0} new pump.fun launches → ${e.to?.agent}${e.to?.node !== e.from.node ? ` @${e.to?.node}` : ""}`;
    case "profiles.found":
      return `spotted ${p.mints?.length ?? 0} fresh DexScreener profiles → ${e.to?.agent}`;
    case "observations":
      return `sent ${p.items?.length ?? 0} observations → ${e.to?.agent} @${e.to?.node}`;
    case "gathered":
      return `gathered market data for ${p.count} tokens`;
    case "scan":
      return "scanned, nothing new";
    case "artifact.drafted":
      return "updated the brief draft";
    case "artifact.published":
      return `published ${p.id}`;
    case "signal.rejected":
      return `rejected a signal from ${p.from?.agent}: ${p.reason}`;
    case "budget.stop":
      return `budget stop (${p.resource})`;
    case "agent.hungry":
      return "is hungry - no feed";
    case "loop.stop":
      return "paused: repeating itself";
    case "stake.slashed":
      return `stake slashed by ${p.amount} (spam rule)`;
    case "enclosure.retired":
      return `enclosure retired: ${p.reason}`;
    default:
      return null;
  }
}

export function useLiveZoo(engine: React.RefObject<NightWatch | null>): LiveState {
  const [state, setState] = useState<LiveState>({
    enabled: NODE_URLS.length > 0,
    connected: 0,
    stats: { cycles: 0, wakes: 0, feed: 0, signals: 0, rejected: 0, observed: 0 },
    log: [],
    brief: null,
  });
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (NODE_URLS.length === 0) return;
    const open = new Set<string>();
    const sources = NODE_URLS.map((url) => {
      const es = new EventSource(`${url}/v1/stream`);
      es.onopen = () => {
        open.add(url);
        setState((s) => ({ ...s, connected: open.size }));
      };
      es.onerror = () => {
        open.delete(url);
        setState((s) => ({ ...s, connected: open.size }));
      };
      es.addEventListener("entry", (msg) => {
        const entry = JSON.parse((msg as MessageEvent).data) as Entry;
        const e = entry.event;
        const key = `${e.from.node}:${entry.seq}`;
        if (seen.current.has(key)) return;
        seen.current.add(key);

        const fresh = Date.now() - e.ts < ANIMATE_WINDOW_MS;
        if (fresh && e.type === "agent.woke") engine.current?.liveWake(e.from.agent);
        if (fresh && e.kind === "signal" && e.to) engine.current?.liveSignal(e.from.agent, e.to.agent);

        setState((s) => {
          const stats = { ...s.stats };
          if (e.type === "cycle.settled") {
            stats.cycles += 1;
            stats.feed += Number(e.payload?.cost ?? 0);
          }
          // Every session opens with agent.woke; cycle.settled only exists when the feed ledger is on.
          if (e.type === "agent.woke") stats.wakes += 1;
          if (e.type === "signal.accepted") stats.signals += 1;
          if (e.type === "signal.rejected") stats.rejected += 1;
          if (e.type === "gathered") stats.observed += Number(e.payload?.count ?? 0);

          let brief = s.brief;
          if (e.kind === "artifact" && (!brief || e.ts > brief.ts)) {
            brief = { id: e.payload.id, markdown: e.payload.content?.markdown ?? "", ts: e.ts };
          }

          const text = describe(e);
          const log = text
            ? [
                {
                  id: key,
                  time: new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                  who: e.from.agent === "warden" ? "warden" : e.from.agent,
                  species: SPECIES_OF[e.from.agent] ?? null,
                  text,
                  hash: entry.hash.slice(0, 6),
                },
                ...s.log,
              ].slice(0, 40)
            : s.log;
          return { ...s, stats, brief, log };
        });
      });
      return es;
    });
    return () => sources.forEach((es) => es.close());
  }, [engine]);

  return state;
}
