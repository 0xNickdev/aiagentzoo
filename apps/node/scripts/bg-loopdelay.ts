/**
 * Event-loop delay on the main thread while the operator graph rebuilds over a synthetic history.db, the old way
 * (batches on the main thread) and the new way (the background worker). Usage:
 *   node --disable-warning=ExperimentalWarning scripts/bg-loopdelay.ts <dir> [tokens=200000] [before|after|both] [ms=60000]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";
import { HistoryStore } from "../src/chain/history.ts";
import { OperatorGraph } from "../src/chain/opgraph.ts";
import { startBackground } from "../src/chain/background.ts";
import { WalletLedger } from "../src/chain/walletpnl.ts";

const dir = process.argv[2] ?? "./bg-loopdelay";
const N = Number(process.argv[3] ?? 200_000);
const mode = process.argv[4] ?? "both";
/** Each side is measured for at most this long (a full rebuild of 200k tokens takes minutes). */
const forMs = Number(process.argv[5] ?? 60_000);
mkdirSync(dir, { recursive: true });
const path = join(dir, `history-${N}.db`);

const w = (s: string) => `${s}x`.padEnd(44, "1");
if (!existsSync(path)) {
  const t0 = performance.now();
  const store = new HistoryStore(path);
  const db = store.db;
  const now = Date.now() - 3_600_000;
  const devs = Math.floor(N / 3);
  const snipers = 20_000;
  db.exec("BEGIN");
  const iw = db.prepare("INSERT INTO wallets (id, wallet, launches, dumped, snipes, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (let i = 1; i <= devs; i++) iw.run(i, w(`D${i}`), 3, i % 2 ? 2 : 0, 0, now, now);
  for (let i = 1; i <= snipers; i++) iw.run(devs + i, w(`S${i}`), 0, 0, 1 + (i % 40), now, now);
  const it = db.prepare("INSERT INTO tokens (id, mint, symbol, name, creator_id, created_at, first_seen, funder, body, updated_at) VALUES (?, ?, 'X', 'x', ?, ?, ?, ?, ?, ?)");
  const il = db.prepare("INSERT OR IGNORE INTO wallet_tokens (wallet_id, token_id, role, at) VALUES (?, ?, 1, ?)");
  for (let i = 1; i <= N; i++) {
    const dev = 1 + (i % devs);
    const at = now - (N - i) * 1000;
    const e: number[][] = [];
    for (let k = 0; k < 6; k++) {
      const sid = devs + 1 + ((i * 7 + k * 131) % snipers);
      e.push([sid, 1, 1, k]);
      il.run(sid, i, at);
    }
    it.run(i, w(`M${i}`), dev, at, at, i % 5 ? w(`F${i % (N / 8)}`) : null, deflateRawSync(JSON.stringify({ e })), at);
    if (i % 50_000 === 0) {
      db.exec("COMMIT");
      db.exec("BEGIN");
    }
  }
  db.exec("COMMIT");
  store.close();
  console.log(`built ${path}: ${N} tokens in ${Math.round(performance.now() - t0)} ms`);
}

const ms = (h: ReturnType<typeof monitorEventLoopDelay>, p: number) => Math.round(h.percentile(p) / 1e5) / 10;
const report = (label: string, h: ReturnType<typeof monitorEventLoopDelay>, took: number, reads: number) =>
  console.log(`${label}: p50 ${ms(h, 50)} ms, p99 ${ms(h, 99)} ms, max ${Math.round(h.max / 1e5) / 10} ms over ${Math.round(took / 1000)} s; ${reads} lookups served`);

/** Lookups on the main thread every 20 ms while it runs, like the check route asking for a dev's operator. */
const reader = (db: DatabaseSync) => {
  const g = new OperatorGraph(db);
  let n = 0;
  const t = setInterval(() => {
    if (process.env.NOREAD) return;
    g.summary(w(`D${1 + (n % 1000)}`));
    n++;
  }, 20);
  return () => {
    clearInterval(t);
    return n;
  };
};

if (mode === "before" || mode === "both") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  const g = new OperatorGraph(db);
  g.reset();
  const stop = reader(db);
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const t0 = performance.now();
  // The old schedule: 1,000 tokens per batch on the main thread (here back to back instead of 20 s apart).
  for (;;) {
    const r = g.update(Date.now(), 1_000);
    await new Promise((res) => setTimeout(res, 20));
    if (r.tokens < 1_000 || performance.now() - t0 > forMs) break;
  }
  g.rebuilt();
  h.disable();
  report("before (main thread)", h, performance.now() - t0, stop());
  db.close();
}

if (mode === "after" || mode === "both") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  new OperatorGraph(db).reset();
  const stop = reader(db);
  // Fills too: 100k fills a second (10k every 100 ms, like a busy stream), handed to the worker every second while the graph rebuilds.
  const ledger = new WalletLedger(null);
  let fills = 0;
  const filler = setInterval(() => {
    if (process.env.NOFILL) return;
    for (let i = 0; i < 10_000; i++) ledger.fill(w(`T${fills++ % 500_000}`), w(`M${i % 5000}`), 0.5, i % 2 === 0, Date.now());
  }, 100);
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const bg = startBackground({ dbPath: path, opgraph: true, pnl: true, graphFirstMs: 0 }, { ledger, flushMs: 1_000, log: (m) => console.log(`  worker: ${m}`), onMessage: (m) => m.t === "rebuilt" && done() });
    bg.worker.ref();
    const done = () => void bg.stop().then(resolve);
    setTimeout(done, forMs);
  });
  clearInterval(filler);
  h.disable();
  report("after (worker)", h, performance.now() - t0, stop());
  const sizes = new OperatorGraph(db).sizes();
  console.log(`  tokens read ${(db.prepare("SELECT v FROM op_state WHERE k = 'tokens_id'").get() as { v: number }).v}, groups: ${[...sizes.values()].reduce((a, b) => a + b, 0)}, pnl rows ${(db.prepare("SELECT count(*) AS n FROM wallet_pnl").get() as { n: number }).n}`);
  db.close();
}
