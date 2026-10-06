import type { Enclosure, LogEntry } from "@aiagentzoo/sdk";

export interface Step {
  seq: number;
  ts: number;
  kind: string;
  type: string;
  summary: string;
}

export interface Passport {
  name: string;
  node: string;
  species: string;
  status: string;
  nextRunAt: number | null;
  firstSeen: number | null;
  wakes: number;
  wokenBy: { schedule: number; signal: number; visitor: number; guardian: number; warden: number };
  cycles: number;
  feedSpent: number;
  signalsSent: number;
  signalsAccepted: number;
  signalsRejected: number;
  signalsReceived: number;
  artifacts: number;
  stops: number;
  lastSteps: Step[];
}

type Stats = Omit<Passport, "name" | "node" | "species" | "status" | "nextRunAt">;

const LAST_STEPS = 25;

function summarize(entry: LogEntry): string {
  const e = entry.event;
  const p = (e.payload ?? {}) as Record<string, any>;
  switch (e.type) {
    case "agent.woke":
      return p.note ? `woke (${p.note})` : `woke on ${p.reason}`;
    case "signal.delivered":
      return `${p.type} → ${p.to?.agent}@${p.to?.node}: ${p.accepted ? "accepted" : `rejected (${p.reason})`}`;
    case "cycle.settled":
      return `cycle settled, ${p.cost} feed`;
    case "artifact.published":
      return `published ${p.id}`;
    default:
      if (e.kind === "signal") return `signal ${e.type} → ${e.to?.agent}@${e.to?.node}`;
      return e.type;
  }
}

/**
 * Per-agent statistics derived from the public log. Rebuilt from the full
 * log at boot, then kept current by subscribing to new entries — so a
 * passport is always a pure function of what anyone can audit.
 */
export class PassportIndex {
  private stats = new Map<string, Stats>();
  private readonly enclosure: Enclosure;

  private constructor(enclosure: Enclosure) {
    this.enclosure = enclosure;
  }

  static async build(enclosure: Enclosure): Promise<PassportIndex> {
    const index = new PassportIndex(enclosure);
    let after = 0;
    for (;;) {
      const page = await enclosure.log.since(after, 1000);
      if (page.length === 0) break;
      for (const entry of page) index.ingest(entry);
      after = page[page.length - 1]!.seq;
    }
    enclosure.log.subscribe((entry) => index.ingest(entry));
    return index;
  }

  private of(agent: string): Stats {
    let s = this.stats.get(agent);
    if (!s) {
      s = {
        firstSeen: null,
        wakes: 0,
        wokenBy: { schedule: 0, signal: 0, visitor: 0, guardian: 0, warden: 0 },
        cycles: 0,
        feedSpent: 0,
        signalsSent: 0,
        signalsAccepted: 0,
        signalsRejected: 0,
        signalsReceived: 0,
        artifacts: 0,
        stops: 0,
        lastSteps: [],
      };
      this.stats.set(agent, s);
    }
    return s;
  }

  private ingest(entry: LogEntry): void {
    const e = entry.event;
    const p = (e.payload ?? {}) as Record<string, any>;

    // Verdicts on signals addressed to our agents are logged by the warden.
    if (e.type === "signal.accepted" && p.to?.agent) this.of(p.to.agent).signalsReceived += 1;
    if (e.from.agent === "warden") return;

    const s = this.of(e.from.agent);
    s.firstSeen ??= e.ts;
    switch (e.type) {
      case "agent.woke": {
        s.wakes += 1;
        const note = String(p.note ?? "");
        if (p.reason === "schedule") s.wokenBy.schedule += 1;
        else if (p.reason === "signal") s.wokenBy.signal += 1;
        else if (note.startsWith("guardian")) s.wokenBy.guardian += 1;
        else if (note.startsWith("visitor")) s.wokenBy.visitor += 1;
        else s.wokenBy.warden += 1;
        break;
      }
      case "cycle.settled":
        s.cycles += 1;
        s.feedSpent = Math.round((s.feedSpent + Number(p.cost ?? 0)) * 1e6) / 1e6;
        break;
      case "signal.delivered":
        if (p.accepted) s.signalsAccepted += 1;
        else s.signalsRejected += 1;
        break;
      case "artifact.published":
        s.artifacts += 1;
        break;
      case "budget.stop":
      case "loop.stop":
      case "permission.denied":
      case "agent.hungry":
        s.stops += 1;
        break;
    }
    if (e.kind === "signal") s.signalsSent += 1;
    if (e.type !== "cycle.settled") {
      s.lastSteps.unshift({ seq: entry.seq, ts: e.ts, kind: e.kind, type: e.type, summary: summarize(entry) });
      if (s.lastSteps.length > LAST_STEPS) s.lastSteps.length = LAST_STEPS;
    }
  }

  get(name: string): Passport | undefined {
    const snapshot = this.enclosure.snapshot().find((a) => a.name === name);
    if (!snapshot) return undefined;
    return {
      name,
      node: this.enclosure.node.id,
      species: snapshot.species,
      status: snapshot.status,
      nextRunAt: snapshot.nextRunAt,
      ...this.of(name),
    };
  }
}
