import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PumpTape } from "../src/chain/pump.ts";
import { parsePumpLogs, type PumpEvent } from "../src/chain/pumpParse.ts";

// Two real mainnet transactions: a pump.fun curve buy and a PumpSwap sell, their event lines only.
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/creator-fees.json", import.meta.url), "utf8")) as Array<{ what: string; logs: string[] }>;
const eventsOf = (what: string) => parsePumpLogs(fixtures.find((f) => f.what === what)!.logs);

test("creator fee is read from pump.fun's curve trade event", () => {
  const t = eventsOf("curve").find((e) => e.kind === "trade") as Extract<PumpEvent, { kind: "trade" }>;
  // 0.69216416 SOL at 30 bps: 2,076,493 lamports, as the event says.
  assert.equal(t.sol, 0.69216416);
  assert.equal(t.creatorFee, 0.002076493);
});

test("coin creator fee is read from a PumpSwap sell event", () => {
  const s = eventsOf("pool").find((e) => e.kind === "swap") as Extract<PumpEvent, { kind: "swap" }>;
  // 1.648722661 SOL out at 75 bps.
  assert.equal(s.creatorFee, 0.01236542);
});

test("the tape sums creator fees per coin, curve and pool, and estimates only when the event lacks the field", () => {
  const trade = eventsOf("curve").find((e) => e.kind === "trade") as Extract<PumpEvent, { kind: "trade" }>;
  const swap = eventsOf("pool").find((e) => e.kind === "swap") as Extract<PumpEvent, { kind: "swap" }>;
  const tape = new PumpTape();
  const now = trade.ts;
  tape.apply({ kind: "create", name: "x", symbol: "X", mint: trade.mint, creator: "11111111111111111111111111111111", ts: now - 60_000 }, now);
  tape.apply(trade, now);
  tape.apply({ kind: "pool", mint: trade.mint, pool: swap.pool }, now);
  tape.apply({ ...swap, ts: now }, now);
  let f = tape.facts(trade.mint, now)!;
  assert.deepEqual(f.creatorFees, { total: 0.014442, curve: 0.002076, pool: 0.012365 });
  // An older event without the field: 0.30% of 1 SOL, marked as estimated.
  const { creatorFee: _, ...old } = trade;
  tape.apply({ ...old, sol: 1 }, now);
  f = tape.facts(trade.mint, now)!;
  assert.equal(f.creatorFees!.curve, 0.005076);
  assert.equal(f.creatorFees!.estimated, true);
});
