/**
 * The background worker: the operator graph's updates and rebuilds, the wallet ledger's writes and the daily smart
 * wallets score, on their own thread with their own connection to history.db (WAL), so the node's event loop never
 * waits on them. Every write goes in short transactions with a pause between, so the main thread's own writes to the
 * same file get the lock within a few milliseconds.
 */
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
import { RecordBuilder } from "./radar-record.ts";
import { QualityReader } from "./wallet-quality.ts";
import { type BuyerRow, ensureBuyers, pruneBuyers, writeBuyers } from "./radar-buyers.ts";
import { OPGRAPH, OperatorGraph } from "./opgraph.ts";
import { type PnlRows, SmartWallets, WalletLedger } from "./walletpnl.ts";
import type { BgIn, BgOut, BgOptions, PrintTie } from "./background.ts";

const port = parentPort!;
const o = workerData as BgOptions;
const post = (m: BgOut) => port.postMessage(m);
const log = (m: string) => post({ t: "log", m });

const db = new DatabaseSync(o.dbPath);
// The busy timeout first: setting the journal mode already needs the lock the main thread may hold.
db.exec("PRAGMA busy_timeout = 30000;");
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");

/** A write that found the store locked (the main thread's own write running long) is tried again, waiting longer each time. */
const isBusy = (e: unknown) => /locked|busy/i.test((e as Error)?.message ?? "");
async function retry<T>(what: string, f: () => T): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return f();
    } catch (error) {
      if (!isBusy(error) || i >= 8 || stopped) throw error;
      if (i >= 2) log(`${what}: store busy, try ${i + 1}`);
      await sleep(Math.min(10_000, 100 * 2 ** i));
    }
  }
}

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
      const r = await retry("operator graph", () => graph.update(Date.now(), tx));
      tokens += r.tokens;
      ties += r.ties;
      if (r.tokens < tx || stopped) break;
      await sleep(pauseMs);
    }
    if (rebuilding && !stopped) {
      await retry("operator graph", () => graph.rebuilt());
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
        await retry("wallet ledger", () => ledger.writeRows(rows, i, Math.min(rows.keys.length, i + 5_000)));
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
    const p = await retry("wallet ledger prune", () => ledger.prune());
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
    case "quality?":
      void (async () => {
        try {
          quality ??= new QualityReader(db);
          const q = await retry("wallet quality", () => quality!.read(m.buyers));
          post({ t: "quality", mint: m.mint, q });
        } catch (error) {
          log(`wallet quality not read: ${(error as Error).message}`);
        }
      })();
      break;
    case "buyers":
      buyerQueue.push(m);
      void writeBuyerQueue();
      break;
    case "stop":
      stopped = true;
      void (async () => {
        while (writing || graphBusy || recording || buyersWriting) await sleep(10);
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
      graph.reset(); // the busy timeout covers this one
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
// The radar track record: read-only, the marks file read on from where it stopped, a pause between chunks.
const record = o.record ? new RecordBuilder(db, o.record.marksFile, o.record.radarFile) : null;
let recording = false;
async function buildRecord(): Promise<void> {
  if (!record || recording || stopped) return;
  recording = true;
  try {
    const t0 = Date.now();
    const r = await record.update(Date.now(), async () => {
      if (stopped) throw new Error("stopping");
      await sleep(pauseMs);
    });
    post({ t: "record", record: r });
    // Candidates in radar.jsonl that never got their minute-20 stage (a restart, older lines): their marks, to decide on the main thread.
    const rows = record.undecided();
    if (rows.length) post({ t: "min20", rows });
    log(`radar record: ${r.picks.n} graded picks, ${r.top.length} runners 3x or more (${Date.now() - t0} ms)`);
  } catch (error) {
    log(`radar record not built: ${(error as Error).message}`);
  } finally {
    recording = false;
  }
}
if (record) {
  setTimeout(() => void buildRecord(), o.record!.firstMs ?? 60_000);
  setInterval(() => void buildRecord(), o.record!.everyMs ?? 3_600_000);
}
if (ledger && smart) {
  setTimeout(() => void score(), o.scoreFirstMs ?? 60 * 60_000);
  setInterval(() => void score(), 24 * 3_600_000);
}
// The radar's slim buyer record: one short transaction per coin, a pause between, pruned past 14 days every hour.
let quality: QualityReader | null = null;
const buyerQueue: Array<{ mint: string; at: number; rows: BuyerRow[] }> = [];
let buyersWriting = false;
let buyersReady = false;
async function writeBuyerQueue(): Promise<void> {
  if (buyersWriting) return;
  buyersWriting = true;
  try {
    if (!buyersReady) {
      await retry("radar buyers", () => ensureBuyers(db));
      buyersReady = true;
    }
    while (buyerQueue.length && !stopped) {
      const b = buyerQueue.shift()!;
      await retry("radar buyers", () => writeBuyers(db, b.mint, b.at, b.rows));
      await sleep(pauseMs);
    }
  } catch (error) {
    log(`radar buyers not written: ${(error as Error).message}`);
  } finally {
    buyersWriting = false;
  }
}
if (o.record) {
  setInterval(() => {
    void (async () => {
      if (!buyersReady || buyersWriting || stopped) return;
      buyersWriting = true;
      try {
        const n = await retry("radar buyers prune", () => pruneBuyers(db));
        if (n) log(`radar buyers: pruned ${n} rows past 14 days`);
      } catch (error) {
        log(`radar buyers not pruned: ${(error as Error).message}`);
      } finally {
        buyersWriting = false;
      }
    })();
  }, 3_600_000);
}
post({ t: "ready" });
