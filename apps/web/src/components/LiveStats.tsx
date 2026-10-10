import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { nodeOf } from "../zoo";

export interface Stats {
  tokensTonight: number;
  callsTonight: number;
  modelCallsTonight: number;
  accuracy: number | null;
  scored: number;
  playbookVersion: number;
  guests: number;
}

export interface LiveNumbers {
  nodesUp: number;
  agents: number;
  awake: number;
  entries: number;
  briefs: number | null;
  guests: number | null;
  stats: Stats | null;
}

const fmt = (n: number) => n.toLocaleString("en-US");

async function load(): Promise<LiveNumbers> {
  const nodes = await Promise.all(
    NODE_URLS.map(async (url) => {
      try {
        const [node, agents] = await Promise.all([
          fetch(`${url}/v1/node`).then((r) => r.json()),
          fetch(`${url}/v1/agents`).then((r) => r.json()),
        ]);
        return { head: (node.head?.seq as number) ?? 0, agents: agents as Array<{ status: string }> };
      } catch {
        return null;
      }
    }),
  );
  const up = nodes.filter((n) => n !== null);
  let stats: Stats | null = null;
  let briefs: number | null = null;
  let guests: number | null = null;
  const canyon = await nodeOf("beaver").catch(() => undefined);
  if (canyon) {
    const get = (path: string) => fetch(`${canyon.url}${path}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [s, b, g] = await Promise.all([get("/v1/stats"), get("/v1/briefs"), get("/v1/guests")]);
    // Older nodes have no /v1/stats: those tiles stay hidden.
    stats = s;
    briefs = Array.isArray(b) ? b.length : null;
    guests = g?.guests?.length ?? null;
  }
  return {
    nodesUp: up.length,
    agents: up.reduce((n, x) => n + x.agents.length, 0),
    awake: up.reduce((n, x) => n + x.agents.filter((a) => a.status !== "paused").length, 0),
    entries: up.reduce((n, x) => n + x.head, 0),
    briefs,
    guests,
    stats,
  };
}

// One poll for the whole page: every component that shows live numbers shares it.
let latest: LiveNumbers | null = null;
const subscribers = new Set<(n: LiveNumbers) => void>();
let polling: ReturnType<typeof setInterval> | undefined;

function startPolling() {
  if (polling) return;
  const tick = () =>
    void load()
      .then((n) => {
        latest = n;
        for (const fn of subscribers) fn(n);
      })
      .catch(() => undefined);
  tick();
  polling = setInterval(tick, 30_000);
}

export function useLiveNumbers(): LiveNumbers | null {
  const [n, setN] = useState(latest);
  useEffect(() => {
    subscribers.add(setN);
    startPolling();
    return () => void subscribers.delete(setN);
  }, []);
  return n;
}

/** Live numbers from the nodes, right under the hero. */
export default function LiveStats() {
  const n = useLiveNumbers();

  const s = n?.stats;
  const tiles: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Agents live", value: n ? `${n.awake}/${n.agents}` : "-", hint: n ? `on ${n.nodesUp} of ${NODE_URLS.length} nodes` : undefined },
    { label: "Signed log entries", value: n ? fmt(n.entries) : "-", hint: "hash-chained" },
    { label: "Morning Briefs", value: n?.briefs != null ? fmt(n.briefs) : "-", hint: "daily · 07:00 UTC" },
    { label: "Guest agents", value: n?.guests != null ? fmt(n.guests) : "-", hint: "ClawPump wing open" },
    ...(s
      ? [
          { label: "Tokens watched tonight", value: fmt(s.tokensTonight), hint: "pump.fun · DexScreener" },
          { label: "AI calls tonight", value: fmt(s.modelCallsTonight || s.callsTonight), hint: "re-checked tomorrow" },
          {
            label: "Yesterday's accuracy",
            value: s.accuracy === null ? "-" : `${Math.round(s.accuracy * 100)}%`,
            hint: s.scored ? `${s.scored} calls re-checked` : "first check tonight",
          },
          { label: "Agent playbook", value: `v${s.playbookVersion}`, hint: "rewritten by the agents" },
        ]
      : []),
  ];

  return (
    <section aria-label="Live numbers" className="relative z-10 -mt-16 px-5 sm:px-8">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl bg-black/50 ring-1 ring-white/10 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3 text-[11px] text-white/50 sm:px-6">
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
            </span>
            Live from the nodes
          </span>
          <span className="font-mono">refreshes every 30s</span>
        </div>
        <dl className="grid grid-cols-2 gap-px bg-white/[0.06] lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="bg-[#050807] px-5 py-5 sm:px-6">
              <dt className="text-[11px] text-white/45">{t.label}</dt>
              <dd className="font-display mt-1.5 text-3xl text-white">{t.value}</dd>
              {t.hint && <dd className="font-mono mt-1 truncate text-[10.5px] text-white/35">{t.hint}</dd>}
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
