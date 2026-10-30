import assert from "node:assert/strict";
import { test } from "node:test";
import { checkToken, DEV_GONE_REASON, oddsRunNote } from "../src/chain/check.ts";

// PHP as the x-ray saw it: a serial dumper's coin they fully left, graduated, its pool grown from 85 to 386 SOL.
const php = (over: Record<string, unknown> = {}) =>
  ({
    ageMin: 41 * 60, buys: 1400, sells: 900, buyers: 611, solIn: 900, solOut: 600, curveSol: null, creatorSold: 1, creatorLaunches24h: 12, graduated: true,
    top5Share: 0.2, repeatBuyers: 80, trades15m: 300, bundleWallets: 1, bundleShare: 0.02, bundlers: 40, bundlersHeld: 0.14, bundlersPeak: 0.48,
    poolSol: 386, ammBuys: 900, ammSells: 500, ammSolIn: 600, ammSolOut: 400, earlyWallets: 8, earlyHeld: 0.03, creatorCrew: 0, ringWallets: 0, serialSnipers: 2, crewHeld: 0, ...over,
  }) as never;
const serial = { wallet: "dev", launches24h: 12, launches48h: 24, dumped: 23, medianDumpMin: 3, graduated: 1, recent: [] } as never;
const spread = (over: Record<string, unknown> = {}) => ({ top10Share: 0.2, topShare: 0.04, programShare: 0.3, creator: "dev", creatorShare: 0, ...over }) as never;

test("dev gone, holders carry it: a serial dumper's coin they left, that graduated and grew, is caution, not avoid", () => {
  const c = checkToken("PHP", { symbol: "PHP", facts: php(), creatorRecord: serial }, { holders: spread() });
  assert.equal(c.verdict, "caution");
  assert.equal(c.proceed, false);
  assert.equal(c.reasons[0], DEV_GONE_REASON);
  assert.ok(c.reasons.some((r) => r.includes("dumped 23 of their 24 launches")), "the dev's record still shows");
  assert.ok(c.reasons.some((r) => r.includes("sold 100%")));
  assert.equal(c.facts!.devGone, true);
});

test("dev gone does not apply when the holders are concentrated, the pool shrank, it never graduated or the holders are unknown", () => {
  const top = checkToken("PHP", { symbol: "PHP", facts: php(), creatorRecord: serial }, { holders: spread({ top10Share: 0.45 }) });
  assert.equal(top.verdict, "avoid");
  assert.equal(top.facts!.devGone, false);
  assert.notEqual(top.reasons[0], DEV_GONE_REASON);

  const shrank = checkToken("PHP", { symbol: "PHP", facts: php({ poolSol: 60 }), creatorRecord: serial }, { holders: spread() });
  assert.equal(shrank.verdict, "avoid");
  assert.equal(shrank.facts!.devGone, false);

  const drained = checkToken("PHP", { symbol: "PHP", facts: php({ drained: true }), creatorRecord: serial }, { holders: spread() });
  assert.equal(drained.verdict, "avoid");

  const curve = php({ graduated: false, poolSol: null, curveSol: 60 });
  const before = checkToken("PHP", { symbol: "PHP", facts: curve, creatorRecord: serial });
  const after = checkToken("PHP", { symbol: "PHP", facts: curve, creatorRecord: serial }, { holders: spread() });
  assert.equal(after.verdict, "avoid");
  assert.deepEqual(after.reasons, before.reasons, "not graduated: unchanged");
  assert.equal(after.facts!.devGone, false);

  const unknown = checkToken("PHP", { symbol: "PHP", facts: php(), creatorRecord: serial });
  assert.equal(unknown.verdict, "avoid");
  const unread = checkToken("PHP", { symbol: "PHP", facts: php(), creatorRecord: serial }, { holders: null });
  assert.equal(unread.verdict, "avoid");
});

test("a dev who sold and came back through their own wallets stays avoid", () => {
  const c = checkToken("PHP", { symbol: "PHP", facts: php({ crewHeld: 0.08, creatorCrew: 3 }), creatorRecord: serial }, { holders: spread() });
  assert.equal(c.verdict, "avoid");
  assert.match(c.reasons[0]!, /came back through their own wallets/);
  assert.equal(c.facts!.devGone, false);
});

test("a runner dev who sells early but whose coins mostly went past $20K gets caution, only for selling and bundles", () => {
  const pattern = { launches: 6, firstCapUsd: 5000, peakCapUsd: 27000, upsideX: 3.5, peakAfterSec: 41, reached20k: 0.6, firstSellSec: 26, dumpCapUsd: 4500, afterDumpLowPct: -0.3, afterDumpDoubled: 0.2, dumps: 4 };
  const base = { wallet: "dev", launches24h: 2, launches48h: 6, dumped: 4, medianDumpMin: 1, graduated: 3, recent: [], pattern };
  const runner = base as never;
  // A fresh coin on the curve, the dev sold everything: their usual exit.
  const fresh = php({ graduated: false, poolSol: null, curveSol: 40, ageMin: 3, creatorLaunches24h: 2, bundleWallets: 1, bundleShare: 0.02 });
  const c = checkToken("ZIBR", { symbol: "ZIBR", facts: fresh, creatorRecord: runner });
  assert.equal(c.verdict, "caution");
  assert.match(c.reasons[0]!, /60% of their last 6 launches went past \$20K \(usual peak \$27K\)/);
  assert.ok(c.reasons.some((r) => r.includes("sold 100%")), "the selling still shows");
  assert.equal(c.facts!.runnerDev, true);

  // Too few launches, or most did not run: still avoid.
  const few = checkToken("ZIBR", { symbol: "ZIBR", facts: fresh, creatorRecord: { ...base, pattern: { ...pattern, launches: 3 } } as never });
  assert.equal(few.verdict, "avoid");
  const flat = checkToken("ZIBR", { symbol: "ZIBR", facts: fresh, creatorRecord: { ...base, pattern: { ...pattern, reached20k: 0.3 } } as never });
  assert.equal(flat.verdict, "avoid");
  // A reason the record cannot soften (the creator's own wallets in the first seconds) keeps it avoid.
  const crew = checkToken("ZIBR", { symbol: "ZIBR", facts: php({ graduated: false, poolSol: null, curveSol: 40, ageMin: 3, creatorLaunches24h: 2, bundleWallets: 1, bundleShare: 0.02, creatorCrew: 3 }), creatorRecord: runner });
  assert.equal(crew.verdict, "avoid");
  assert.equal(crew.facts!.runnerDev, false);
});

test("a wallet launching thirty or more tokens a day is launch spam: avoid, even with nothing dumped", () => {
  const spam = { wallet: "dev", launches24h: 146, launches48h: 146, dumped: 0, medianDumpMin: null, graduated: 0, recent: [] } as never;
  const fresh = php({ graduated: false, poolSol: null, curveSol: 0, ageMin: 1, creatorSold: 0, creatorLaunches24h: 146, buyers: 0, buys: 0, sells: 0, bundleWallets: 0, bundleShare: 0, serialSnipers: 0 });
  const c = checkToken("LeLe", { symbol: "LeLe", facts: fresh, creatorRecord: spam });
  assert.equal(c.verdict, "avoid");
  assert.ok(c.reasons.some((r) => r === "this wallet launched 146 tokens in 24 hours: launch spam, not a project"));
});

test("dev gone counts a dev who sold 80% and kept under 1%, and an avoid with high odds says it may still run", () => {
  const most = checkToken("DG", { symbol: "DG", facts: php({ creatorSold: 0.8 }), creatorRecord: serial }, { holders: spread({ creatorShare: 0.005 }) });
  assert.equal(most.facts!.devGone, true);
  assert.equal(most.verdict, "caution");
  const kept = checkToken("DG", { symbol: "DG", facts: php({ creatorSold: 0.8 }), creatorRecord: serial }, { holders: spread({ creatorShare: 0.03 }) });
  assert.equal(kept.facts!.devGone, false);
  const little = checkToken("DG", { symbol: "DG", facts: php({ creatorSold: 0.6 }), creatorRecord: serial }, { holders: spread() });
  assert.equal(little.facts!.devGone, false);

  assert.match(oddsRunNote("avoid", 9.2)!, /^launches like this one ran 9x more often/);
  assert.equal(oddsRunNote("avoid", 2), null);
  assert.equal(oddsRunNote("caution", 9), null);
});
