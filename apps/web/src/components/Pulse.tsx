import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";

interface NodeView {
  id: string;
  head: { seq: number; hash: string } | null;
  agents: Array<{ name: string; status: string; nextRunAt: number | null }>;
}

interface ChainLink {
  node: string;
  seq: number;
  hash: string;
  agent: string;
  type: string;
  ts: number;
}

function usePoll<T>(load: () => Promise<T>, everyMs: number): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (NODE_URLS.length === 0) return;
    let alive = true;
    const tick = () => load().then((v) => alive && setValue(v)).catch(() => undefined);
    void tick();
    const timer = setInterval(tick, everyMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

async function loadNodes(): Promise<NodeView[]> {
  const results = await Promise.allSettled(
    NODE_URLS.map(async (url) => {
      const [node, agents] = await Promise.all([
        fetch(`${url}/v1/node`).then((r) => r.json()),
        fetch(`${url}/v1/agents`).then((r) => r.json()),
      ]);
      return { id: node.id, head: node.head, agents } as NodeView;
    }),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

function inMinutes(ts: number | null): string {
  if (!ts) return "-";
  const m = Math.max(0, Math.round((ts - Date.now()) / 60_000));
  if (m === 0) return "now";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Live numbers from every node: is the network actually alive right now? */
export function NetworkPulse() {
  const nodes = usePoll(loadNodes, 15_000);
  if (!nodes) return null;
  const agents = nodes.flatMap((n) => n.agents);
  const next = agents.map((a) => a.nextRunAt).filter((t): t is number => !!t).sort((a, b) => a - b)[0] ?? null;
  const stats: Array<[string, string]> = [
    [`${nodes.length}/${NODE_URLS.length}`, "nodes online"],
    [String(agents.length), "agents"],
    [String(nodes.reduce((sum, n) => sum + (n.head?.seq ?? 0), 0)), "log entries"],
    [inMinutes(next), "next wake-up"],
  ];
  return (
    <div className="mt-10 grid w-full max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-3xl bg-white/10 sm:grid-cols-4">
      {stats.map(([value, label]) => (
        <div key={label} className="bg-black/45 px-4 py-5 backdrop-blur-md">
          <b className="font-display block text-3xl font-normal leading-none text-white">{value}</b>
          <span className="mt-2 block text-[10px] font-light uppercase tracking-[0.2em] text-white/55">{label}</span>
        </div>
      ))}
    </div>
  );
}

async function loadChain(): Promise<ChainLink[]> {
  const nodes = await loadNodes();
  const pages = await Promise.all(
    nodes.map(async (n, i) => {
      const head = n.head?.seq ?? 0;
      const url = NODE_URLS.find((u) => u.includes(n.id.split(".")[0]!)) ?? NODE_URLS[i]!;
      const entries = (await fetch(`${url}/v1/log?after=${Math.max(0, head - 4)}&limit=4`).then((r) => r.json())) as Array<{
        seq: number;
        hash: string;
        event: { from: { agent: string }; type: string; ts: number };
      }>;
      return entries.map((e) => ({ node: n.id, seq: e.seq, hash: e.hash, agent: e.event.from.agent, type: e.event.type, ts: e.event.ts }));
    }),
  );
  return pages.flat().sort((a, b) => b.ts - a.ts).slice(0, 6);
}

/** The newest links of the hash chains, straight from the nodes. */
export function ChainTicker() {
  const links = usePoll(loadChain, 12_000);
  if (!links || links.length === 0) return null;
  return (
    <div className="mt-10 grid w-full max-w-4xl gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((l) => (
        <div key={`${l.node}#${l.seq}`} className="rounded-2xl bg-black/45 px-4 py-3 text-left ring-1 ring-white/10 backdrop-blur-md">
          <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-white/45">
            <span>{l.node}</span>
            <span>#{l.seq}</span>
          </div>
          <p className="mt-1 truncate text-[13px] font-light text-white/90">
            {l.agent === "warden" ? "warden" : l.agent} · {l.type}
          </p>
          <p className="mt-1 font-mono text-[10px] text-white/40">{l.hash.slice(0, 16)}…</p>
        </div>
      ))}
    </div>
  );
}
