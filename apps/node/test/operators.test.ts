import { test } from "node:test";
import assert from "node:assert/strict";
import { operatorWarning, Operators } from "../src/chain/operators.ts";
import { PumpTape } from "../src/chain/pump.ts";

test("wallets in one transaction become one operator; a wallet alone is none", () => {
  const ops = new Operators();
  ops.signer("A", "tx1", 1);
  ops.signer("B", "tx1", 1);
  ops.signer("C", "tx1", 1);
  ops.signer("D", "tx2", 2);
  assert.equal(ops.of("D"), null);
  assert.equal(ops.of("A")!.wallets, 3);
  assert.deepEqual(new Set(ops.of("C")!.members), new Set(["A", "B", "C"]));
  // A fresh wallet signing later next to an old one joins the whole group.
  ops.signer("E", "tx3", 3);
  ops.signer("B", "tx3", 3);
  assert.equal(ops.of("E")!.wallets, 4);
  assert.equal(ops.of("E")!.root, ops.of("A")!.root);
  assert.deepEqual(ops.proof(ops.of("A")!.root, 2).map((p) => p.tx), ["tx3", "tx1"]);
});

test("a wallet repeated inside its own transaction joins nothing", () => {
  const ops = new Operators();
  ops.signer("A", "tx1", 1);
  ops.signer("A", "tx1", 1);
  assert.equal(ops.of("A"), null);
  assert.equal(ops.joined, 0);
});

test("the warning needs settled launches that nearly all dumped; avoid only when it is overwhelming", () => {
  assert.equal(operatorWarning(null), null);
  assert.equal(operatorWarning({ wallets: 3, launches: 4, settled: 2, dumped: 2 }), null, "too few settled");
  assert.equal(operatorWarning({ wallets: 3, launches: 10, settled: 10, dumped: 6 }), null, "60% is not a farm");
  const caution = operatorWarning({ wallets: 2, launches: 4, settled: 4, dumped: 4 })!;
  assert.equal(caution.avoid, false);
  assert.match(caution.text, /^the dev signed transactions together with 1 other wallet: one operator/);
  assert.equal(operatorWarning({ wallets: 6, launches: 12, settled: 10, dumped: 10 })!.avoid, true);
  assert.equal(operatorWarning({ wallets: 400, launches: 90, settled: 80, dumped: 80 }), null, "a custodial bot's users are not one person");
});

test("the tape joins a launch's creator with the wallets buying inside the create transaction, and counts their dumps", () => {
  const tape = new PumpTape();
  const t0 = 1_800_000_000_000;
  // An old wallet launched and dumped three coins.
  for (let i = 0; i < 3; i++) {
    const mint = `Old${i}pump11111111111111111111111111111111`;
    tape.apply({ kind: "create", name: "o", symbol: "O", mint, creator: "OLDDEV", ts: t0 + i }, t0 + i, `c${i}`);
    tape.apply({ kind: "trade", mint, sol: 1, tokens: 1_000_000, isBuy: true, user: "OLDDEV", ts: t0 + i, curveSol: 31 }, t0 + i, `c${i}`);
    tape.apply({ kind: "trade", mint, sol: 1, tokens: 1_000_000, isBuy: false, user: "OLDDEV", ts: t0 + 60_000, curveSol: 30 }, t0 + 60_000, `s${i}`);
  }
  // A fresh dev launches, and the old wallet buys inside the same create transaction: both signed it.
  const fresh = "Freshpump11111111111111111111111111111111";
  const at = t0 + 30 * 60_000;
  tape.apply({ kind: "create", name: "f", symbol: "F", mint: fresh, creator: "NEWDEV", ts: at }, at, "launch");
  tape.apply({ kind: "trade", mint: fresh, sol: 1, tokens: 1000, isBuy: true, user: "NEWDEV", ts: at, curveSol: 31 }, at, "launch");
  tape.apply({ kind: "trade", mint: fresh, sol: 1, tokens: 1000, isBuy: true, user: "OLDDEV", ts: at, curveSol: 32 }, at, "launch");
  const op = tape.operatorOf("NEWDEV", at)!;
  assert.equal(op.wallets, 2);
  assert.equal(op.launches, 3);
  assert.equal(op.settled, 3);
  assert.equal(op.dumped, 3);
  // The operator survives a restart through the snapshot.
  const reborn = new PumpTape();
  reborn.load(tape.snapshot(), at);
  assert.equal(reborn.operatorOf("NEWDEV", at)!.wallets, 2);
});

test("BNB Chain events name a recipient, not a signer: no operators there", () => {
  const tape = new PumpTape("BNB");
  tape.apply({ kind: "trade", mint: "0xabc", sol: 1, tokens: 1, isBuy: true, user: "0x1", ts: 1, curveSol: 1 }, 1, "0xtx");
  tape.apply({ kind: "trade", mint: "0xabc", sol: 1, tokens: 1, isBuy: true, user: "0x2", ts: 1, curveSol: 1 }, 1, "0xtx");
  assert.equal(tape.operators.joined, 0);
});
