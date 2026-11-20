/**
 * The zoo watching itself: a silent chain stream, a node that is down. Each problem is announced once when it starts
 * and once when it ends, to the operators' chats. No model runs anywhere any more, so there is no model to watch.
 */

export const STREAM_SILENT_MS = 5 * 60_000;
export const NODE_FAILS_TO_ALERT = 3;

type Problem = "stream" | `node:${string}`;

export class Watchdog {
  private readonly open = new Map<Problem, number>();
  private readonly nodeFails = new Map<string, number>();

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

  private close(problem: Problem, now: number, text: string): string[] {
    const since = this.open.get(problem);
    if (since === undefined) return [];
    this.open.delete(problem);
    return [`🟢 ${text}, after ${Math.max(1, Math.round((now - since) / 60_000))} min.`];
  }
}

/** Runs the watchdog on this node: north's stream and the peers' health. */
export function startWatchdog(opts: {
  token: string;
  chats: number[];
  northUrl?: string;
  peers: Array<{ name: string; url: string }>;
  log?: (m: string) => void;
  fetchFn?: typeof fetch;
}): () => void {
  const f = opts.fetchFn ?? fetch;
  const log = opts.log ?? console.log;
  const dog = new Watchdog();
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
  };
  const timer = setInterval(() => void tick(), 2 * 60_000);
  timer.unref?.();
  log(`[watchdog] watching, alerts to ${opts.chats.length} chat(s)`);
  return () => clearInterval(timer);
}
