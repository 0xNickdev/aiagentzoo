import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HistoryStore } from "../src/chain/history.ts";
import { PumpTape } from "../src/chain/pump.ts";
import { OperatorGraph } from "../src/chain/opgraph.ts";
import { type BgOut, startBackground } from "../src/chain/background.ts";
import { SmartWallets, WalletLedger } from "../src/chain/walletpnl.ts";

const pad = (s: string) => s.padEnd(44, "g");

const launch = (store: HistoryStore, mint: string, dev: string, t0: number, funder: string) => {
  const t = new PumpTape();
  t.apply({ kind: "create", name: "x", symbol: "X", mint, creator: dev, ts: t0 }, t0, `c${mint}`, 100);
  t.apply({ kind: "trade", mint, sol: 1, tokens: 50_000_000, isBuy: true, user: dev, ts: t0, curveSol: 31 }, t0, `d${mint}`, 100);
  t.apply({ kind: "trade", mint, sol: 1, tokens: 50_000_000, isBuy: false, user: dev, ts: t0 + 120_000, curveSol: 31 }, t0 + 120_000, `x${mint}`, 400);
  store.write([{ ...t.historyOf(mint, t0 + 10 * 60_000)!, funder }], t0);
};

const waitFor = (msgs: BgOut[], pred: (m: BgOut) => boolean, ms = 10_000) =>
  new Promise<BgOut>((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const m = msgs.find(pred);
      if (m) return resolve(m);
      if (Date.now() - t0 > ms) return reject(new Error("timed out"));
      setTimeout(tick, 20);
    };
    tick();
  });

test("the worker builds the operator graph in history.db; the main thread reads it; prints come by message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zoo-bg-"));
  const store = new HistoryStore(join(dir, "history.db"));
  try {
    const t0 = Date.now() - 3 * 3_600_000;
    for (let i = 0; i < 4; i++) launch(store, pad(`M${i}`), pad(`Dev${i}`), t0 + i * 60_000, pad("Funder"));
    // An outdated graph: the worker starts a rebuild on its own.
    const main = new OperatorGraph(store.db);
    store.db.prepare("INSERT INTO op_state (k, v) VALUES ('version', 1)").run();
    store.db.prepare("INSERT INTO op_members VALUES ('x', 'x', 1, 1)").run();
    const msgs: BgOut[] = [];
    const bg = startBackground({ dbPath: join(dir, "history.db"), opgraph: true, pnl: false, graphFirstMs: 50, txTokens: 2, pauseMs: 1 }, { onMessage: (m) => msgs.push(m) });
    bg.postPrints([{ mint: pad("M0"), print: { key: "p1", wallets: 2, common: false, creators: [pad("Lone")] } }]);
    await waitFor(msgs, (m) => m.t === "rebuilt");
    const s = main.summary(pad("Dev3"))!;
    assert.equal(s.creators, 5, "four funder-tied devs and the print-tied wallet");
    assert.equal(s.ties.print, 1);
    assert.equal(main.idOf("x"), null, "the old graph is gone");
    await bg.stop();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fills gather on the main thread, the worker writes them and scores the smart list into the file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zoo-bg-"));
  const store = new HistoryStore(join(dir, "history.db"));
  const file = join(dir, "smart-wallets.json");
  try {
    const ledger = new WalletLedger(null);
    const smart = new SmartWallets(file);
    const now = Date.now();
    for (const w of ["a", "b"]) for (let i = 0; i < 12; i++) {
      ledger.fill(w, `m${i}`, 1, true, now - 1000);
      ledger.fill(w, `m${i}`, w === "a" ? 3 : 2, false, now);
    }
    const msgs: BgOut[] = [];
    const bg = startBackground(
      { dbPath: join(dir, "history.db"), opgraph: false, pnl: true, smartFile: file, scoreFirstMs: 3_600_000 },
      { ledger, smart, clusterOf: () => "same", onMessage: (m) => msgs.push(m), flushMs: 3_600_000 },
    );
    await waitFor(msgs, (m) => m.t === "ready");
    bg.flush();
    assert.equal(ledger.queued, 0);
    for (let i = 0; i < 100 && !(store.db.prepare("SELECT count(*) AS n FROM wallet_pnl").get() as { n: number }).n; i++) await new Promise((r) => setTimeout(r, 20));
    bg.send({ t: "score" });
    await waitFor(msgs, (m) => m.t === "smart");
    assert.ok(existsSync(file));
    assert.deepEqual(smart.current!.wallets.map((w) => w.wallet), ["a"], "one wallet per cluster, the best");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).wallets[0].linked, 1);
    await bg.stop();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
