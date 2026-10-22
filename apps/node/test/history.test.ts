import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Enclosure, Identity } from "@aiagentzoo/sdk";
import { HistoryStore, startHistory } from "../src/chain/history.ts";
import { PumpTape, tape as liveTape } from "../src/chain/pump.ts";
import { createNodeServer } from "../src/server.ts";

const pad = (s: string) => s.padEnd(44, "h");
const DEV = pad("Dev");
const SNIPER = pad("Snipe");
const BUNDLER = pad("Bund");

const tempStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "zoo-history-"));
  return { store: new HistoryStore(join(dir, "history.db")), done: () => rmSync(dir, { recursive: true, force: true }) };
};

/** A launch with a dev who buys and dumps, one sniper and one launch-block bundler. */
const launch = (t: PumpTape, mint: string, t0: number) => {
  t.apply({ kind: "create", name: "silk", symbol: "SILK", mint, creator: DEV, ts: t0 }, t0, "tx0", 100);
  t.apply({ kind: "trade", mint, sol: 1, tokens: 50_000_000, isBuy: true, user: DEV, ts: t0, curveSol: 31 }, t0, "tx1", 100);
  t.apply({ kind: "trade", mint, sol: 2, tokens: 80_000_000, isBuy: true, user: SNIPER, ts: t0 + 1_000, curveSol: 33 }, t0, "tx2", 105);
  t.apply({ kind: "trade", mint, sol: 1, tokens: 30_000_000, isBuy: true, user: BUNDLER, ts: t0 + 1_500, curveSol: 34 }, t0, "tx3", 101);
  t.apply({ kind: "trade", mint, sol: 1, tokens: 40_000_000, isBuy: false, user: DEV, ts: t0 + 120_000, curveSol: 33 }, t0 + 120_000, "tx4", 400);
};

test("history keeps a token past the tape and rebuilds what the X-Ray shows", () => {
  const { store, done } = tempStore();
  try {
    const t = new PumpTape();
    const t0 = Date.now() - 10 * 60_000;
    const mint = pad("Mint1");
    launch(t, mint, t0);
    const rec = t.historyOf(mint)!;
    // Queued twice before a flush: one write, the later record wins.
    store.enqueue({ ...rec, funder: null });
    store.enqueue({ ...rec, funder: pad("Fund") });
    assert.equal(store.flush(), 1);
    // Written again later: counters must not double, and a known funder is kept.
    store.write([{ ...rec, funder: null }]);

    const r = store.report(mint)!;
    assert.equal(r.symbol, "SILK");
    assert.equal(r.creator, DEV);
    assert.equal(r.funder, pad("Fund"));
    assert.ok(r.devDumpedAt);
    assert.deepEqual(r.early.map((e) => e.wallet).sort(), [BUNDLER, SNIPER].sort());
    const live = t.earlyOf(mint)!;
    const sniper = r.early.find((e) => e.wallet === SNIPER)!;
    assert.equal(sniper.bought, live.find((e) => e.wallet === SNIPER)!.bought);
    assert.equal(sniper.afterSec, 1);
    assert.deepEqual(r.bundle, t.token(mint)!.bundle);
    assert.equal(r.facts.buys, rec.facts.buys);
    assert.equal(r.facts.creatorSold, rec.facts.creatorSold);
    assert.equal(r.creatorRecord!.launches48h, 1);
    assert.equal(r.creatorRecord!.dumped, 1);

    const dev = store.wallet(DEV)!;
    assert.equal(dev.launches, 1);
    assert.equal(dev.dumped, 1);
    assert.deepEqual(dev.tokens[0]!.roles, ["dev"]);
    const b = store.wallet(BUNDLER)!;
    assert.equal(b.snipes, 1);
    assert.equal(b.bundleHits, 1);
    assert.deepEqual(b.tokens[0]!.roles.sort(), ["bundle", "early"]);
    assert.equal(store.wallet(pad("Nobody")), null);
    assert.equal(store.report(pad("Other")), null);
  } finally {
    store.close();
    done();
  }
});

test("history counts a creator's launches over many days and prunes past the cutoff", async () => {
  const { store, done } = tempStore();
  try {
    const t = new PumpTape();
    const now = Date.now();
    const days = [100, 30, 5, 0.1];
    for (const [i, d] of days.entries()) {
      const mint = pad(`M${i}`);
      launch(t, mint, now - d * 86_400_000);
      store.enqueue(t.historyOf(mint, now)!);
    }
    store.flush(now);
    const totals = store.creatorTotals(DEV)!;
    assert.equal(totals.launches, 4);
    assert.equal(totals.dumped, 4);
    assert.equal(totals.medianDumpMin, 2);
    // At launch, two days back: only that token.
    assert.equal(store.creatorRecord(DEV, now - 30 * 86_400_000)!.launches48h, 1);

    const pruned = await store.prune(now, 90 * 86_400_000);
    assert.equal(pruned.tokens, 1);
    assert.equal(store.report(pad("M0")), null);
    assert.ok(store.report(pad("M1")));
    assert.equal(store.counts().tokens, 3);
    assert.equal(store.wallet(SNIPER)!.tokens.length, 3);
    // Everyone was written just now, so no wallet is old enough to go.
    assert.equal(pruned.wallets, 0);
    const later = await store.prune(now + 200 * 86_400_000, 90 * 86_400_000);
    assert.equal(later.wallets, 3);
    assert.equal(store.counts().wallets, 0);
  } finally {
    store.close();
    done();
  }
});

test("the recorder writes launches as they settle and dumps at once; the X-Ray falls back to history", async () => {
  const { store, done } = tempStore();
  const t = new PumpTape();
  const stop = startHistory(store, t, { flushMs: 20, backfill: true });
  const enclosure = new Enclosure({ node: { id: "north.zoo", identity: Identity.generate(), operator: "op" }, keeper: "keeper", tools: [], agents: [] });
  const server = createNodeServer({ enclosure, history: store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const mint = pad("Rec1");
    launch(t, mint, Date.now() - 5 * 60_000);
    // The dev dumped: written on the next tick, without waiting for the first minute to settle.
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(store.has(mint));
    assert.equal(store.wallet(DEV)!.dumped, 1);

    // The live tape never saw it (it is a different tape), so the X-Ray reads the long memory.
    liveTape.lastEventAt ||= Date.now();
    const x = (await (await fetch(`${base}/v1/xray/${mint}`)).json()) as { symbol: string; fromHistory: boolean; historySince: number; early: Array<{ wallet: string }>; check: { verdict: string; symbol: string } };
    assert.equal(x.symbol, "SILK");
    assert.equal(x.fromHistory, true);
    assert.ok(x.historySince > 0);
    assert.equal(x.early.length, 2);
    assert.equal(x.check.symbol, "SILK");
    assert.notEqual(x.check.verdict, "unknown");
    const c = (await (await fetch(`${base}/v1/check/${mint}`)).json()) as { fromHistory: boolean; verdict: string };
    assert.equal(c.fromHistory, true);
    const d = (await (await fetch(`${base}/v1/wallet/${SNIPER}/history`)).json()) as { snipes: number; tokens: Array<{ mint: string; roles: string[] }> };
    assert.equal(d.snipes, 1);
    assert.equal(d.tokens[0]!.mint, mint);
    assert.equal((await fetch(`${base}/v1/wallet/${pad("Nobody")}/history`)).status, 404);
    const rec = (await (await fetch(`${base}/v1/chain/creator/${DEV}`)).json()) as { launches48h: number; counted: string };
    assert.equal(rec.launches48h, 1);
    assert.equal(rec.counted, "history");
  } finally {
    stop();
    server.close();
    store.close();
    done();
  }
});
