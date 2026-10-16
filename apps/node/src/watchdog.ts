import type { LogEntry } from "@aiagentzoo/sdk";

/**
 * The zoo watching itself: a model that stopped answering, a silent chain stream, a node that is down, a brief that
 * did not come out. Each problem is announced once when it starts and once when it ends, to the operators' chats.
 */

/** Log entries that mean an agent wanted its model and did not get it. */
const MODEL_FAILURES = new Set(["judge.fallback", "evo.answer.skipped", "evo.breed.fallback", "playbook.kept", "judge.unparsed"]);
/** Log entries that mean the model answered. */
const MODEL_OK = new Set(["calls.made", "evo.answered", "playbook.updated", "ask.answered"]);

export const MODEL_FAILS_TO_ALERT = 3;
export const STREAM_SILENT_MS = 5 * 60_000;
export const NODE_FAILS_TO_ALERT = 3;
/** The brief is due at briefAt; this long after, its absence is a problem. */
export const BRIEF_GRACE_MS = 20 * 60_000;

type Problem = "model" | "stream" | `node:${string}` | "brief";

export class Watchdog {
  private modelFails: number[] = [];
  private lastModelReason = "";
  private readonly open = new Map<Problem, number>();
  private readonly nodeFails = new Map<string, number>();
  private lastBriefNight: string | null = null;
  private readonly opts: { briefAt: string };

  constructor(opts: { briefAt: string }) {
    this.opts = opts;
  }

  /** Feed every new entry of this node's log; returns messages to send. */
  onEntry(entry: LogEntry, now = Date.now()): string[] {
    const ev = entry.event;
    if (ev.type === "artifact.published") {
      const night = (ev.payload as { content?: { night?: string } })?.content?.night;
      if (night) this.lastBriefNight = night;
      return this.close("brief", now, "The morning brief is out");
    }
    if (MODEL_FAILURES.has(ev.type)) {
      const reason = String((ev.payload as { reason?: unknown })?.reason ?? "");
      // A playbook kept for a dull reason (nothing new to learn) is not a model failure.
      if (ev.type === "playbook.kept" && !/\d{3}|model|credit|quota|timeout|unavailable|rate/i.test(reason)) return [];
      this.modelFails = [...this.modelFails.filter((t) => now - t < 60 * 60_000), now];
      if (reason) this.lastModelReason = reason.slice(0, 200);
      if (this.modelFails.length >= MODEL_FAILS_TO_ALERT && !this.open.has("model")) {
        this.open.set("model", now);
        return [`🔴 The model is not answering: ${this.modelFails.length} failures in the last hour (${ev.from.agent}). Agents are running on rules.\nLast error: ${this.lastModelReason || "none given"}`];
      }
      return [];
    }
    if (MODEL_OK.has(ev.type)) {
      // A rule call is logged as calls.made too; only a call the model made counts as recovery.
      if (ev.type === "calls.made" && (ev.payload as { by?: string })?.by !== "model") return [];
      if (ev.type === "ask.answered" && (ev.payload as { by?: string })?.by === "rules") return [];
      this.modelFails = [];
      return this.close("model", now, "The model is answering again");
    }
    return [];
  }

  /** The chain stream's status as north reports it, or null when north did not answer. */
  onStream(status: { live?: boolean; connected?: boolean; lastEventAt?: number } | null, now = Date.now()): string[] {
    if (!status) return [];
    const quietMs = status.lastEventAt ? now - status.lastEventAt : Number.POSITIVE_INFINITY;
    if (status.connected && quietMs < STREAM_SILENT_MS) return this.close("stream", now, "The chain stream is flowing again");
    if (this.open.has("stream")) return [];
    this.open.set("stream", now);
    const mins = Number.isFinite(quietMs) ? `${Math.round(quietMs / 60_000)} min` : "ever";
    return [`🔴 The pump.fun stream on north is silent: no event for ${mins}${status.connected ? "" : ", disconnected"}. New launches are not being seen.`];
  }

  /** A peer node's health check. */
  onNode(name: string, ok: boolean, now = Date.now()): string[] {
    if (ok) {
      this.nodeFails.set(name, 0);
      return this.close(`node:${name}`, now, `${name} is back up`);
    }
    const fails = (this.nodeFails.get(name) ?? 0) + 1;
    this.nodeFails.set(name, fails);
    if (fails >= NODE_FAILS_TO_ALERT && !this.open.has(`node:${name}`)) {
      this.open.set(`node:${name}`, now);
      return [`🔴 ${name} is not answering (${fails} checks in a row).`];
    }
    return [];
  }

  /** Called on every tick: is today's brief late? */
  onClock(now = Date.now()): string[] {
    const [h, m] = this.opts.briefAt.split(":").map(Number);
    const day = new Date(now).toISOString().slice(0, 10);
    const due = Date.parse(`${day}T00:00:00Z`) + ((h ?? 7) * 60 + (m ?? 0)) * 60_000;
    if (now < due + BRIEF_GRACE_MS || now > due + 6 * 3_600_000) return [];
    if (this.lastBriefNight === day || this.open.has("brief")) return [];
    this.open.set("brief", now);
    return [`🔴 The morning brief for ${day} is not out, ${Math.round((now - due) / 60_000)} min after ${this.opts.briefAt} UTC.`];
  }

  private close(problem: Problem, now: number, text: string): string[] {
    const since = this.open.get(problem);
    if (since === undefined) return [];
    this.open.delete(problem);
    return [`🟢 ${text}, after ${Math.max(1, Math.round((now - since) / 60_000))} min.`];
  }
}

/** Runs the watchdog on this node: its own log, north's stream, the peers' health, the brief's clock. */
export function startWatchdog(opts: {
  token: string;
  chats: number[];
  briefAt: string;
  subscribe: (fn: (entry: LogEntry) => void) => void;
  northUrl?: string;
  peers: Array<{ name: string; url: string }>;
  log?: (m: string) => void;
  fetchFn?: typeof fetch;
}): () => void {
  const f = opts.fetchFn ?? fetch;
  const log = opts.log ?? console.log;
  const dog = new Watchdog({ briefAt: opts.briefAt });
  const send = (texts: string[]) => {
    for (const text of texts) {
      log(`[watchdog] ${text.split("\n")[0]}`);
      for (const chat of opts.chats) {
        void f(`https://api.telegram.org/bot${opts.token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(15_000),
        }).catch(() => undefined);
      }
    }
  };
  opts.subscribe((entry) => send(dog.onEntry(entry)));
  const get = async <T>(url: string): Promise<T | null> => {
    try {
      const r = await f(url, { signal: AbortSignal.timeout(10_000) });
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const tick = async () => {
    if (opts.northUrl) send(dog.onStream(await get(`${opts.northUrl}/v1/chain`)));
    for (const p of opts.peers) send(dog.onNode(p.name, (await get<unknown>(`${p.url}/health`)) !== null));
    send(dog.onClock());
  };
  const timer = setInterval(() => void tick(), 2 * 60_000);
  timer.unref?.();
  log(`[watchdog] watching, alerts to ${opts.chats.length} chat(s)`);
  return () => clearInterval(timer);
}
