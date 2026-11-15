import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kindOf, PoolBook, poolSol, signerOf, type ParsedTx, type PoolEntry } from "../src/chain/pools.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/pool-zorpo.json", import.meta.url), "utf8")) as { pool: string; mint: string; open: ParsedTx; close: ParsedTx; pass: ParsedTx; buy: ParsedTx };

test("the opening transaction names the opener and the SOL the pool started with", () => {
  assert.equal(signerOf(fx.open), "HkGwjeuK6LgLPBP9iXHhAfeAGw5e2NNiFGQrdyxqQAyS");
  assert.ok(Math.abs(poolSol(fx.open, fx.pool) - 84.99) < 0.01);
});

test("the opener taking the liquidity back shows as SOL leaving the pool under the same signature", () => {
  assert.equal(signerOf(fx.close), signerOf(fx.open));
  assert.ok(Math.abs(poolSol(fx.close, fx.pool) + 481.84) < 0.01);
});

test("a bag landing in another wallet inside one transaction is a pass; a wallet trading with the pool is not", () => {
  assert.equal(kindOf(fx.pass, fx.pool, fx.mint), "pass");
  assert.equal(kindOf(fx.buy, fx.pool, fx.mint), "buy");
  assert.equal(kindOf(fx.open, fx.pool, fx.mint), "sell", "liquidity going in is tokens into the pool, never a pass");
});

test("the view counts what closed pools took out, and how many pools one opener ran", () => {
  const book = new PoolBook(null);
  const now = Date.parse("2026-11-15T14:00:00Z");
  const entry = (pool: string, creator: string, taken: number | null): PoolEntry => ({
    row: { pool, mint: `${pool}mint`, symbol: "X", createdAt: now - 3_600_000, volumeUsd: 1e6, fdvUsd: 1e5, buyers: 10, sellers: 2, trades: 100 },
    read: { creator, solIn: 85, openedAt: now - 3_600_000, trades: 1000, lastAt: now - 60_000, sample: { n: 60, passes: 44 }, taken: taken === null ? null : { sol: taken, at: now - 600_000 }, readAt: now },
    seenAt: now,
  });
  const entries = (book as unknown as { entries: Map<string, PoolEntry> }).entries;
  for (const e of [entry("a", "dev1", 482), entry("b", "dev1", 512), entry("c", "dev1", null), entry("d", "dev2", null)]) entries.set(e.row.pool, e);
  const v = book.view(now);
  assert.deepEqual({ listed: v.totals.listed, read: v.totals.read, closed: v.totals.closed, solIn: v.totals.solIn, solOut: v.totals.solOut }, { listed: 4, read: 4, closed: 2, solIn: 170, solOut: 994 });
  const a = v.pools.find((p) => p.pool === "a")!.read!;
  assert.equal(a.creatorPools, 3);
  assert.equal(a.creatorTaken, 2);
  assert.equal(book.ofMint("dmint")?.read?.creator, "dev2");
});

import { poolCheck } from "../src/chain/check.ts";

test("a pool its opener emptied is an avoid, a busy pool with real trades is left unknown, and nothing is ever a pass", () => {
  const emptied = poolCheck("m", { symbol: "ZORPO", solIn: 84.99, taken: { sol: 481.84, at: 1 }, sample: { n: 60, passes: 44 }, otherTaken: 2 });
  assert.equal(emptied.verdict, "avoid");
  assert.equal(emptied.proceed, false);
  assert.deepEqual(emptied.reasons, [
    "the wallet that opened this pool took the liquidity back: 482 SOL out after 85 SOL in",
    "the wallet that opened this pool opened and emptied 2 other pools in the last three days",
    "44 of 60 trades drawn at random passed one bag between two wallets through the pool, so most of the volume shown is not buying",
  ]);
  const quiet = poolCheck("m", { symbol: "X", solIn: 50, taken: null, sample: { n: 60, passes: 3 }, otherTaken: 0 });
  assert.equal(quiet.verdict, "unknown");
  assert.equal(quiet.proceed, null);
  assert.equal(poolCheck("m", { symbol: "X", solIn: 50, taken: null, sample: { n: 60, passes: 15 }, otherTaken: 0 }).verdict, "caution");
});
