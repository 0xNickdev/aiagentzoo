/**
 * The background worker: the operator graph's updates and rebuilds, the wallet ledger's writes and the daily smart
 * wallets score, on their own thread with their own connection to history.db (WAL), so the node's event loop never
 * waits on them. Every write goes in short transactions with a pause between, so the main thread's own writes to the
 * same file get the lock within a few milliseconds.
 */
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
import { OPGRAPH, OperatorGraph } from "./opgraph.ts";
import { type PnlRows, SmartWallets, WalletLedger } from "./walletpnl.ts";
import type { BgIn, BgOut, BgOptions, PrintTie } from "./background.ts";

const port = parentPort!;
const o = workerData as BgOptions;
const post = (m: BgOut) => port.postMessage(m);
const log = (m: string) => post({ t: "log", m });

const db = new DatabaseSync(o.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 30000;");

/** Tool prints of recent launches, posted by the main thread that holds the tape; the oldest go past the cap. */
const prints = new Map<string, PrintTie>();
const PRINTS_MAX = 200_000;

const graph = o.opgraph ? new OperatorGraph(db, { printOf: (mint) => prints.get(mint) ?? null }) : null;
const ledger = o.pnl ? new WalletLedger(db) : null;
const smart = o.pnl && o.smartFile ? new SmartWallets(o.smartFile) : null;

const tx = o.txTokens ?? 250;
const pauseMs = o.pauseMs ?? 5;
let stopped = false;

/** Reads every settled token not read yet, a short transaction at a time. */
let graphBusy = false;
async function runGraph(): Promise<void> {
  if (!graph || graphBusy || stopped) return;
  graphBusy = true;
  try {
    const rebuilding = graph.rebuilding();
    let tokens = 0;
    let ties = 0;
    for (;;) {
      const r = graph.update(Date.now(), tx);
      tokens += r.tokens;
      ties += r.ties;
      if (r.tokens < tx || stopped) break;
      await sleep(pauseMs);
    }
    if (rebuilding && !stopped) {
      graph.rebuilt();
      log(`operator graph: rebuild done, ${tokens} tokens read`);
      post({ t: "rebuilt", tokens });
    } else if (ties) log(`operator graph: ${tokens} tokens read, ${ties} ties`);
  } catch (error) {
    log(`operator graph not updated: ${(error as Error).message}`);
  } finally {
    graphBusy = false;
  }
}

/** Batches of fills from the main thread, written a few thousand rows per transaction. */
const queue: PnlRows[] = [];
let writing = false;
async function writePnl(): Promise<void> {
  if (!ledger || writing) return;
  writing = true;
  try {
    while (queue.length) {
      const rows = queue.shift()!;
      for (let i = 0; i < rows.keys.length; i += 5_000) {
        ledger.writeRows(rows, i, Math.min(rows.keys.length, i + 5_000));
        await sleep(pauseMs);
      }
    }
  } catch (error) {
    log(`wallet ledger not written: ${(error as Error).message}`);
  } finally {
    writing = false;
  }
}

const asks = new Map<number, (c: Array<string | null>) => void>();
let askId = 0;
const clustersOf = (wallets: string[]) =>
  new Promise<Array<string | null>>((resolve) => {
    const id = ++askId;
    asks.set(id, resolve);
    post({ t: "clusters?", id, wallets });
  });

let scoring = false;
async function score(): Promise<void> {
  if (!ledger || !smart || scoring) return;
  scoring = true;
  try {
    const p = ledger.prune();
    const list = await ledger.score(Date.now(), { isOperator: (w) => graph?.idOf(w) != null, clustersOf });
    smart.set(list);
    post({ t: "smart", wallets: list.wallets.length });
    const s = ledger.stats;
    log(`smart wallets: ${list.wallets.length} of ${list.scanned} wallets (${ledger.rows()} rows; pruned ${p.old} old, ${p.dust} dust, ${p.capped} over the cap; ${s.flushed} pairs written, slowest write ${s.flushMsMax} ms)`);
  } catch (error) {
    log(`smart wallets not scored: ${(error as Error).message}`);
  } finally {
    scoring = false;
  }
}

port.on("message", (m: BgIn) => {
  switch (m.t) {
    case "prints":
      for (const p of m.items) {
        prints.delete(p.mint);
        prints.set(p.mint, p.print);
      }
      if (prints.size > PRINTS_MAX) for (const k of prints.keys()) {
        prints.delete(k);
        if (prints.size <= PRINTS_MAX) break;
      }
      break;
    case "pnl":
      queue.push({ keys: m.keys, nums: m.nums });
      void writePnl();
      break;
    case "clusters":
      asks.get(m.id)?.(m.clusters);
      asks.delete(m.id);
      break;
    case "graph":
      void runGraph();
      break;
    case "score":
      void score();
      break;
    case "stop":
      stopped = true;
      void (async () => {
        while (writing || graphBusy) await sleep(10);
        try {
          db.close();
        } catch {
          /* closed */
        }
        post({ t: "stopped" });
        port.close();
      })();
      break;
  }
});

if (graph) {
  try {
    if (graph.outdated()) {
      graph.reset();
      log(`operator graph: tie rules v${OPGRAPH.version}, rebuilding from history in the worker`);
    }
  } catch (error) {
    log(`operator graph not reset: ${(error as Error).message}`);
  }
  setTimeout(() => void runGraph(), o.graphFirstMs ?? 2 * 60_000);
  setInterval(() => void runGraph(), o.graphEveryMs ?? 5 * 60_000);
  setInterval(() => {
    try {
      graph.prune();
    } catch (error) {
      log(`operator graph not pruned: ${(error as Error).message}`);
    }
  }, 24 * 3_600_000);
}
if (ledger && smart) {
  setTimeout(() => void score(), o.scoreFirstMs ?? 60 * 60_000);
  setInterval(() => void score(), 24 * 3_600_000);
}
post({ t: "ready" });
