import { test } from "node:test";
import assert from "node:assert/strict";
import { oddsOf, type OddsInputs } from "../src/chain/odds.ts";

const typical: OddsInputs = { still5: false, dumped5: true, devSold5: true, priorLaunches: 6, priorDumped: 4, priorGraduated: 0, launchShare: 0.02, devShare: 0.02, buyers1m: 5, buyers5: 6, insiders: false, wash: 0, crew2: false, ring3: false, social: false, mayhem: false, funderExchange: false, funderMany: false };

test("a serial dev's dumped launch gets long odds, a busy first launch with links much shorter ones", () => {
  const bad = oddsOf(typical, "5min");
  const good = oddsOf({ ...typical, still5: true, dumped5: false, devSold5: false, priorLaunches: 0, priorDumped: 0, devShare: 0.06, buyers1m: 30, buyers5: 120, social: true }, "5min");
  assert.ok(bad.run < 0.01, `bad ${bad.run}`);
  assert.ok(good.run > 0.1, `good ${good.run}`);
  assert.equal(bad.devDumps, null, "a dev who already dumped has no dump odds left");
  assert.ok(good.devDumps !== null && good.devDumps > 0 && good.devDumps < 1);
  assert.ok(good.why.length > 0 && good.why[0]!.up);
  assert.ok(good.vsAverage > 3);
});
