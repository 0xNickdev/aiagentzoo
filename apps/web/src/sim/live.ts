import { useEffect, useRef, useState } from "react";
import type { SpeciesId } from "../data";
import type { NightWatch, PulseEvent } from "./nightWatch";

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

/** The line an animal shows over its head for a real event, if the event is worth one. */
function noteFor(e: { type: string; kind: string; from: { agent: string }; payload?: any }): [string, string] | null {
  const p = e.payload ?? {};
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (e.type) {
    case "launches.found":
      return [e.from.agent, `+${n(p.launches)} launches`];
    case "profiles.found":
      return [e.from.agent, `+${n(p.mints)} promoted`];
    case "gathered":
      return [e.from.agent, `${Number(p.count ?? 0)} tokens gathered`];
    case "calls.made":
      return [e.from.agent, `${Number(p.count ?? 0)} calls`];
    case "calls.scored":
      return [e.from.agent, `re-checked: ${Number(p.hits ?? 0)} right`];
    case "playbook.updated":
      return [e.from.agent, `playbook v${Number(p.version ?? 0)}`];
    case "artifact.published":
      return [e.from.agent, "brief published"];
    case "followup.check":
      return [e.from.agent, `re-check ${n(p.mints)}`];
    case "evo.exam":
      return [e.from.agent, `exam set: ${n(p.mints)} tokens`];
    case "evo.answered":
      return [e.from.agent, `${String(p.name ?? "a creature")} answered`];
    case "evo.scored":
      return [e.from.agent, `exam graded: ${Number(p.hits ?? 0)} right`];
    case "evo.death":
      return [e.from.agent, `${String(p.name ?? "a creature")} died`];
    case "evo.birth":
      return [e.from.agent, `${String(p.name ?? "a creature")} born`];
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
        if (fresh) {
          const note = noteFor(e);
          if (note) engine.current?.liveNote(note[0], note[1]);
        }

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

export interface ChainPulse {
  live: boolean;
  perMinute: { launches: number; trades: number } | null;
  /** The newest loud moments (not plain launches), newest first. */
  recent: PulseEvent[];
}

const POLL_MS = 3_000;
/** One loud moment on the map at a time, so each can be read. */
const LOUD_EVERY_MS = 4_500;
/** Launches are a background stream; past this pace they blur. */
const LAUNCH_EVERY_MS = 1_200;
/** The per-minute counter moves this often, not on every poll. */
const COUNTER_EVERY_MS = 10_000;
/** Rarer moments first: a graduate or a big buy beats the fiftieth dump. */
const PRIORITY: Record<PulseEvent["kind"], number> = { graduated: 4, whale: 3, dump: 2, serial: 1, launch: 0 };

/**
 * Polls north's pump.fun tape and plays it back at a readable pace: launches as a thin stream,
 * loud moments one by one from a short queue, the rarest first and the stale dropped.
 */
export function useChainPulse(engine: React.RefObject<NightWatch | null>): ChainPulse {
  const [state, setState] = useState<ChainPulse>({ live: false, perMinute: null, recent: [] });

  useEffect(() => {
    const north = NODE_URLS.find((u) => u.includes("north"));
    if (!north) return;
    let after = -1;
    let stopped = false;
    let loud: PulseEvent[] = [];
    let launches = 0;
    let counterAt = 0;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`${north}/v1/chain/pulse?after=${Math.max(0, after)}`);
        if (!r.ok) return;
        const body = (await r.json()) as { live: boolean; perMinute: ChainPulse["perMinute"]; events: PulseEvent[] };
        if (stopped) return;
        const first = after < 0;
        if (body.events.length) after = body.events[body.events.length - 1]!.seq;
        else if (first) after = 0;
        // The first read only sets the cursor and keeps the newest loud moments.
        const fresh = body.events.filter((e) => e.kind !== "launch");
        loud = [...loud, ...(first ? fresh.slice(-2) : fresh)]
          .sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || b.seq - a.seq)
          .slice(0, 6);
        launches = Math.min(launches + body.events.length - fresh.length, 4);
        const now = Date.now();
        if (now - counterAt >= COUNTER_EVERY_MS || first) {
          counterAt = now;
          setState((s) => ({ ...s, live: body.live, perMinute: body.perMinute }));
        }
      } catch {
        /* the next poll tries again */
      }
    };

    const playLoud = () => {
      if (document.hidden) return;
      const e = loud.shift();
      if (!e) return;
      engine.current?.livePulse(e);
      setState((s) => ({ ...s, recent: [e, ...s.recent].slice(0, 3) }));
    };
    const playLaunch = () => {
      if (document.hidden || launches <= 0) return;
      launches -= 1;
      engine.current?.livePulse({ seq: 0, at: Date.now(), kind: "launch", mint: "", symbol: "", text: "" });
    };

    poll();
    const timers = [window.setInterval(poll, POLL_MS), window.setInterval(playLoud, LOUD_EVERY_MS), window.setInterval(playLaunch, LAUNCH_EVERY_MS)];
    return () => {
      stopped = true;
      timers.forEach((id) => clearInterval(id));
    };
  }, [engine]);

  return state;
}
