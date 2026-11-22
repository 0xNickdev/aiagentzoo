import { test } from "node:test";
import assert from "node:assert/strict";
import { PumpTape } from "../src/chain/pump.ts";

const pad = (s: string) => (s + "1".repeat(44)).slice(0, 44);
const MINT = pad("Zoo");
const OTHER = pad("Old");
const DEV = pad("Dev");
const POOL = pad("Pool");
const A = pad("BuyerA");
const DAY = 86_400_000;

/** A coin launched, bought on the curve and graduated into a pool, all on its own tape, as a replay reads it. */
function replayed(t0: number): PumpTape {
  const own = new PumpTape();
  own.pin(MINT);
  own.apply({ kind: "create", name: "zoo", symbol: "ZOO", mint: MINT, creator: DEV, ts: t0 }, t0, "c0", 10);
  own.apply({ kind: "trade", mint: MINT, sol: 2, tokens: 60_000_000, isBuy: true, user: A, ts: t0 + 2_000, curveSol: 32 }, t0 + 2_000, "t1", 11);
  own.apply({ kind: "pool", mint: MINT, pool: POOL }, t0 + 60_000, "p0", 20);
  return own;
}

test("a pinned coin is kept past two days, through a prune and a restart, and the stream keeps reading its pool", () => {
  const t0 = Date.now() - 30 * DAY;
  const live = new PumpTape();
  live.pin(MINT);
  // An ordinary coin as old: the prune drops it.
  live.apply({ kind: "create", name: "old", symbol: "OLD", mint: OTHER, creator: DEV, ts: t0 }, t0, "o0", 5);
  assert.equal(live.adopt(replayed(t0), MINT), true);
  live.prune();
  assert.equal(live.has(OTHER), false);
  assert.equal(live.has(MINT), true);

  // A pool trade after the handover reaches the pinned coin: the first buyer sells half.
  live.apply({ kind: "swap", pool: POOL, isBuy: false, sol: 1, tokens: 30_000_000, user: A, ts: Date.now(), poolSol: 120 }, Date.now(), "s1", 30);
  const f = live.facts(MINT)!;
  assert.equal(f.ammSells, 1);
  assert.equal(f.graduated, true);
  assert.equal(f.bundlesSince, null);
  assert.equal(live.lastTxOf(MINT), "s1");

  // Saved and loaded again (a deploy): still there, with its pool.
  const back = new PumpTape();
  back.pin(MINT);
  back.load(live.snapshot());
  assert.equal(back.has(MINT), true);
  back.apply({ kind: "swap", pool: POOL, isBuy: true, sol: 1, tokens: 10_000_000, user: A, ts: Date.now(), poolSol: 121 }, Date.now(), "s2", 31);
  assert.equal(back.facts(MINT)!.ammBuys, 1);

  // Without the pin the same save forgets a month-old coin, as before.
  const plain = new PumpTape();
  plain.load(live.snapshot());
  assert.equal(plain.has(MINT), false);
});

test("a pinned coin is not counted among its creator's last two days", () => {
  const t0 = Date.now() - 30 * DAY;
  const live = new PumpTape();
  live.pin(MINT);
  live.adopt(replayed(t0), MINT);
  assert.equal(live.creator(DEV), null);
  // Only a pinned mint can be adopted.
  const loose = new PumpTape();
  assert.equal(loose.adopt(replayed(t0), MINT), false);
});

test("a pool that drained and came back to half its best is live again", () => {
  const t0 = Date.now() - 30 * DAY;
  const live = new PumpTape();
  live.pin(MINT);
  live.adopt(replayed(t0), MINT);
  const swap = (poolSol: number, tx: string) => live.apply({ kind: "swap", pool: POOL, isBuy: true, sol: 0.1, tokens: 1_000, user: A, ts: Date.now(), poolSol }, Date.now(), tx, 40);
  swap(150, "a");
  swap(20, "b");
  assert.equal(live.facts(MINT)!.drained, true);
  swap(60, "c");
  assert.equal(live.facts(MINT)!.drained, true);
  swap(110, "d");
  assert.equal(live.facts(MINT)!.drained, undefined);
});
