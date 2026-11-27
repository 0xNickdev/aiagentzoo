import { Worker } from "node:worker_threads";
import { PNL, type SmartWallets, WalletLedger } from "./walletpnl.ts";

/**
 * The main thread's side of the background worker (background-worker.ts). The operator graph is built there; here it
 * is only read (indexed lookups by wallet). Fills gather in a Map here and go to the worker every half minute; the
 * worker writes them, scores the smart wallets once a day and writes the list to its file, which is read again here.
 */

export interface PrintTie {
  key: string;
  wallets: number;
  common: boolean;
  creators: string[];
}

export interface BgOptions {
  dbPath: string;
  opgraph: boolean;
  pnl: boolean;
  smartFile?: string;
  /** Tokens per graph transaction, and the pause between transactions. */
  txTokens?: number;
  pauseMs?: number;
  graphFirstMs?: number;
  graphEveryMs?: number;
  scoreFirstMs?: number;
}

export type BgIn =
  | { t: "prints"; items: Array<{ mint: string; print: PrintTie }> }
  | { t: "pnl"; keys: string[]; nums: Float64Array }
  | { t: "clusters"; id: number; clusters: Array<string | null> }
  | { t: "graph" }
  | { t: "score" }
  | { t: "stop" };

export type BgOut =
  | { t: "ready" }
  | { t: "log"; m: string }
  | { t: "rebuilt"; tokens: number }
  | { t: "smart"; wallets: number }
  | { t: "clusters?"; id: number; wallets: string[] }
  | { t: "stopped" };

export interface BgDeps {
  /** The fills ledger on this thread (no store): filled from the tape's hot path. */
  ledger?: WalletLedger | null;
  smart?: SmartWallets | null;
  clusterOf?: (wallet: string) => string | null;
  log?: (m: string) => void;
  onMessage?: (m: BgOut) => void;
  flushMs?: number;
}

export interface Background {
  worker: Worker;
  postPrints(items: Array<{ mint: string; print: PrintTie }>): void;
  /** Hands the pending fills to the worker now. */
  flush(): void;
  send(m: BgIn): void;
  stop(): Promise<void>;
}

export function startBackground(opts: BgOptions, deps: BgDeps = {}): Background {
  const log = deps.log ?? (() => {});
  // The worker runs with the same flags as this process (type stripping for the .ts entry included).
  const worker = new Worker(new URL("./background-worker.ts", import.meta.url), { workerData: opts, execArgv: process.execArgv });
  worker.unref();
  const send = (m: BgIn, transfer: ArrayBuffer[] = []) => worker.postMessage(m, transfer);
  let stopped: (() => void) | null = null;
  worker.on("message", (m: BgOut) => {
    if (m.t === "log") log(m.m);
    else if (m.t === "smart") deps.smart?.reload();
    else if (m.t === "clusters?") send({ t: "clusters", id: m.id, clusters: m.wallets.map((w) => deps.clusterOf?.(w) ?? null) });
    else if (m.t === "stopped") stopped?.();
    deps.onMessage?.(m);
  });
  worker.on("error", (e) => log(`background worker failed: ${e.message}`));
  let stopping = false;
  worker.on("exit", (code) => {
    stopped?.();
    if (code && !stopping) log(`background worker exited with ${code}`);
  });
  const flush = () => {
    const rows = deps.ledger?.drain();
    if (rows) send({ t: "pnl", keys: rows.keys, nums: rows.nums }, [rows.nums.buffer as ArrayBuffer]);
  };
  const timer = deps.ledger ? setInterval(flush, deps.flushMs ?? PNL.flushMs) : null;
  timer?.unref();
  return {
    worker,
    postPrints: (items) => {
      if (items.length) send({ t: "prints", items });
    },
    flush,
    send,
    stop: () =>
      new Promise<void>((resolve) => {
        // Fills still pending stay in the ledger here: the caller writes them itself on the way down.
        stopping = true;
        if (timer) clearInterval(timer);
        const t = setTimeout(() => void worker.terminate().then(() => resolve()), 3_000);
        t.unref();
        stopped = () => {
          clearTimeout(t);
          resolve();
        };
        send({ t: "stop" });
      }),
  };
}

/**
 * Walks the tape a slice at a time and posts the tool print of each launch old enough to be near its settle time
 * (the worker reads a token 20 minutes after it is first seen). Each mint is posted once.
 */
export function startPrintFeed(
  tape: { mints(): string[]; createdAtOf(mint: string): number | null; printOf(mint: string): { key: string; wallets: number; common: boolean } | null; printLaunches(key: string, limit: number): Array<{ creator: string }> },
  bg: Background,
  { everyMs = 60_000, perTick = 2_000, minAgeMs = 12 * 60_000 } = {},
): () => void {
  let posted = new Set<string>();
  const tick = () => {
    const now = Date.now();
    const items: Array<{ mint: string; print: PrintTie }> = [];
    let looked = 0;
    const mints = tape.mints();
    for (const m of mints) {
      if (posted.has(m)) continue;
      const at = tape.createdAtOf(m);
      if (at === null || now - at < minAgeMs) continue;
      posted.add(m);
      const r = tape.printOf(m);
      if (r) items.push({ mint: m, print: { key: r.key, wallets: r.wallets, common: r.common, creators: tape.printLaunches(r.key, 6).map((l) => l.creator) } });
      if (++looked >= perTick) break;
    }
    // Mints the tape let go are forgotten here too.
    if (posted.size > mints.length * 2 + 1_000) {
      const live = new Set(mints);
      posted = new Set([...posted].filter((m) => live.has(m)));
    }
    bg.postPrints(items);
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
