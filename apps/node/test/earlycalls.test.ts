import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallerRecord } from "../src/chain/callers.ts";
import type { Callout } from "../src/chain/calls.ts";
import { earlyCallLine, earlyCallsOf, goodCaller, markField } from "../src/chain/earlycalls.ts";

const rec = (wallet: string, o: Partial<CallerRecord>): CallerRecord => ({
  wallet, name: wallet, twitter: null, followers: null, calls: 10, coins: 10, settled: 10, alive: 5, dead: 3, up: 5, medianX: 1.4, bestX: 5,
  walletSeen: 4, boughtBefore: 0, soldWithinHour: 1, soldAfter: 2, devDumpedAfter: 1, lastAt: 0, ...o,
});
const call = (wallet: string, at: number, twitter: string | null = null): Callout => ({
  post: at, mint: "M", symbol: "X", text: "", caller: wallet, followers: null, twitter, wallet, calledMcUsd: 5_000, mcUsd: 5_000, nth: 1, at, postedAt: at, url: "",
});

test("a good caller needs enough settled calls, ups, few dead and no quick exits", () => {
  assert.equal(goodCaller(rec("a", {})), true);
  assert.equal(goodCaller(rec("a", { settled: 5 })), false, "too few settled");
  assert.equal(goodCaller(rec("a", { up: 3 })), false, "30% up");
  assert.equal(goodCaller(rec("a", { dead: 6 })), false, "mostly dead");
  assert.equal(goodCaller(rec("a", { soldWithinHour: 3 })), false, "sells out within the hour");
  assert.equal(goodCaller(null), false);
});

test("only calls made by the cut-off count, one per caller, judged by their record", () => {
  const t0 = 1_000_000;
  const records = new Map([["good", rec("good", {})], ["bad", rec("bad", { up: 1 })]]);
  const calls = [call("bad", t0 + 60_000), call("good", t0 + 4 * 60_000, "@ace"), call("good", t0 + 4.5 * 60_000), call("late", t0 + 9 * 60_000)];
  const e = earlyCallsOf(calls, t0, t0 + 5 * 60_000, (w) => records.get(w) ?? null);
  assert.equal(e.n, 2);
  assert.equal(e.good, 1);
  assert.equal(e.firstSec, 60);
  assert.equal(e.goodFirstSec, 240);
  assert.deepEqual(markField(e), { n: 2, good: 1, firstSec: 60, goodFirstSec: 240 });
  assert.match(earlyCallLine(e)!, /^called early by @ace, 4 min after launch \(record: 5 of 10 calls ended up, 3 dead, median 1.4x\)$/);
  assert.equal(earlyCallLine(earlyCallsOf([call("bad", t0)], t0, t0 + 1, (w) => records.get(w) ?? null)), null);
});
