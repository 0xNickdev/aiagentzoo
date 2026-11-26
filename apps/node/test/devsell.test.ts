import assert from "node:assert/strict";
import { test } from "node:test";
import { checkToken, devSellRead } from "../src/chain/check.ts";
import { PumpTape } from "../src/chain/pump.ts";

const facts = (over: Record<string, unknown> = {}) =>
  ({
    ageMin: 45, buys: 80, sells: 30, buyers: 20, solIn: 20, solOut: 5, curveSol: 15, creatorSold: 0, creatorLaunches24h: 1, graduated: false,
    top5Share: 0.3, repeatBuyers: 8, trades15m: 50, bundleWallets: 0, bundleShare: 0, poolSol: null, ammBuys: 0, ammSells: 0, ammSolIn: 0, ammSolOut: 0, ...over,
  }) as never;
const rec = { wallet: "w", launches24h: 1, launches48h: 1, dumped: 0, medianDumpMin: null, graduated: 0, recent: [] } as never;
const sell = (sold: number, d: Record<string, unknown>) => ({ creatorSold: sold, devSell: { firstSec: 3, mainSec: 3, solIn: 1, solOut: 2, held: 1 - sold, rebuy: false, capX: 1.2, ...d } });
const run = (sold: number, d: Record<string, unknown>, over: Record<string, unknown> = {}) => checkToken("M", { symbol: "D", facts: facts({ ...sell(sold, d), ...over }), creatorRecord: rec });
const devReason = (c: ReturnType<typeof checkToken>) => c.reasons.find((r) => /own bag/.test(r));

test("dev sold under 10%: no flag, no line", () => {
  const c = run(0.05, { held: 0.95 });
  assert.equal(devReason(c), undefined);
  assert.deepEqual(devSellRead(sell(0.05, {}) as never), { level: null, line: null });
});

test("dev took back what they put in and still holds: no flag, a plain line", () => {
  const c = run(0.4, { solOut: 1.1, held: 0.6 });
  assert.equal(devReason(c), undefined);
  assert.ok(c.notes.includes("the dev took back what they put in and still holds 60%"));
  // Holding under a fifth is not that kind: it stays avoid.
  const gone = run(0.85, { solOut: 1.1, held: 0.15 });
  assert.equal(gone.verdict, "avoid");
  assert.equal(devReason(gone), "the creator sold 85% of their own bag");
});

test("dev sold at a loss or bought back: no flag", () => {
  const loss = run(1, { solOut: 0.8, held: 0 });
  assert.equal(devReason(loss), undefined);
  assert.ok(loss.notes.includes("the dev sold at a loss"));
  const back = run(1, { rebuy: true, held: 0 });
  assert.equal(devReason(back), undefined);
  assert.ok(back.notes.includes("the dev bought back after selling"));
});

test("dev sold 100% in the first minute: avoid, and the crowd rule still softens it to caution", () => {
  const c = run(1, { held: 0 });
  assert.equal(c.verdict, "avoid");
  assert.equal(devReason(c), "the creator sold 100% of their own bag");
  assert.ok(c.notes.includes("the dev sold 100% in the first minute"));
  const crowd = run(1, { held: 0 }, { buyers: 60 });
  assert.equal(crowd.verdict, "caution");
  assert.ok(crowd.notes.some((n) => /^60 wallets have bought in/.test(n)));
});

test("dev sold half or more after five minutes: caution; after thirty or past 3x the launch cap, only a note", () => {
  const mid = run(0.8, { firstSec: 100, mainSec: 20 * 60, held: 0.1 });
  assert.equal(mid.verdict, "caution");
  assert.equal(devReason(mid), "the creator has sold 80% of their own bag");
  assert.ok(mid.notes.includes("the dev sold 80% after 20 minutes"));
  const late = run(1, { firstSec: 3000, mainSec: 3600, held: 0 });
  assert.equal(devReason(late), undefined);
  assert.ok(late.notes.includes("the dev sold 100% after 60 minutes"));
  const ran = run(1, { mainSec: 120, held: 0, capX: 3.5 });
  assert.equal(devReason(ran), undefined);
  assert.ok(ran.notes.includes("the dev sold 100% after 2 minutes"));
});

test("a partial trim in the first five minutes is caution", () => {
  const c = run(0.3, { firstSec: 40, mainSec: null, solOut: 2, held: 0.7 });
  assert.equal(c.verdict, "caution");
  assert.equal(devReason(c), "the creator has sold 30% of their own bag");
  assert.ok(c.notes.includes("the dev sold 30% in the first minute"));
});

test("facts read before the sell shape was kept keep the old rule", () => {
  assert.equal(checkToken("M", { symbol: "D", facts: facts({ creatorSold: 1 }), creatorRecord: rec }).verdict, "avoid");
  assert.equal(devSellRead({ creatorSold: 0.3 } as never).level, "caution");
});

test("the tape keeps the dev's SOL in and out, sell times, what they hold and a rebuy", () => {
  const tape = new PumpTape();
  tape.connected = true;
  const t0 = 1_791_600_000_000;
  const mint = "SELLpump", dev = "DEV";
  tape.apply({ kind: "create", name: "s", symbol: "S", mint, creator: dev, ts: t0 }, t0);
  tape.apply({ kind: "trade", mint, sol: 1, tokens: 1_000_000, isBuy: true, user: dev, ts: t0, curveSol: 31 }, t0);
  tape.apply({ kind: "trade", mint, sol: 0.3, tokens: 200_000, isBuy: false, user: dev, ts: t0 + 30_000, curveSol: 30 }, t0 + 30_000);
  tape.apply({ kind: "trade", mint, sol: 1, tokens: 500_000, isBuy: false, user: dev, ts: t0 + 600_000, curveSol: 30 }, t0 + 600_000);
  let d = tape.facts(mint, t0 + 600_000)!.devSell!;
  assert.deepEqual({ ...d, capX: null }, { firstSec: 30, mainSec: 600, solIn: 1, solOut: 1.3, held: 0.3, rebuy: false, capX: null });
  tape.apply({ kind: "trade", mint, sol: 0.1, tokens: 50_000, isBuy: true, user: dev, ts: t0 + 700_000, curveSol: 30 }, t0 + 700_000);
  d = tape.facts(mint, t0 + 700_000)!.devSell!;
  assert.equal(d.rebuy, true);
});
