import { test } from "node:test";
import assert from "node:assert/strict";
import { PumpTape } from "../src/chain/pump.ts";
import { bills, buyMessage, compact, holderLine } from "../src/buybot.ts";

const POOL = "CpZyjihejMJ8i6xRFL6Znmpt4HdgGirMvQh5QqdgJZ2v";
const MINT = "2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B";
const swap = (user: string, isBuy = true, sol = 1.07) => ({ kind: "swap" as const, pool: POOL, isBuy, sol, tokens: 6_140_000, user, ts: 1_000, poolSol: 70 });

test("the tape keeps a followed pool's trades though it never saw the launch, once per tx", () => {
  const t = new PumpTape();
  t.follow(MINT, POOL);
  t.apply(swap("buyerA"), 10_000, "tx1");
  t.apply(swap("buyerA"), 10_001, "tx1");
  t.apply(swap("buyerB", false), 10_002, "tx2");
  t.apply({ ...swap("other"), pool: "SomeOtherPool1111111111111111111111111111111" }, 10_003, "tx3");
  const all = t.followedAfter(MINT, 0);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((s) => s.user), ["buyerA", "buyerB"]);
  assert.equal(t.followedAfter(MINT, all[0]!.seq).length, 1);
  assert.equal(t.followedAfter("nothing", 0).length, 0);
});

test("numbers and lines read like a person wrote them", () => {
  assert.equal(compact(6_140_000), "6.14M");
  assert.equal(compact(16_900), "16.9K");
  assert.equal(compact(950), "950");
  assert.equal(holderLine(1000, 1000, 1e9), "new holder");
  assert.equal(holderLine(1000, 500, 1e9), null);
  assert.equal(holderLine(1_000_000, 11_000_000, 1e9), "holds 11M (1.1%), +10%");
  assert.equal(bills(1.07), "💵".repeat(11));
  assert.equal(bills(25), "💵".repeat(40));
});

test("a buy message has the size, the buyer, the cap and no ads", () => {
  const text = buyMessage({
    swap: { seq: 1, mint: MINT, pool: POOL, isBuy: true, sol: 1.07, tokens: 6_140_000, user: "WsUAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxagTN", ts: 0, poolSol: 70, tx: "sig" },
    symbol: "ZOOAGENCY",
    mint: MINT,
    balance: 6_140_000,
    solUsd: 103.6,
    supply: 940_000_000,
  });
  assert.match(text, /<b>1\.07 SOL<\/b> \(\$110\.85\)/);
  assert.match(text, /6\.14M ZOOAGENCY/);
  assert.match(text, /WsUA…agTN<\/a> \| <a href="https:\/\/solscan\.io\/tx\/sig">Txn<\/a>/);
  assert.match(text, /New holder!/);
  assert.match(text, /Price \$0\.0000180\d+/);
  assert.match(text, /Market Cap \$17K/);
  assert.doesNotMatch(text, /Volume Bot|Marketing|trending/i);
});
