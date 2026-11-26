import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { PNL, WalletLedger } from "../src/chain/walletpnl.ts";
import { PumpTape } from "../src/chain/pump.ts";

const pad = (s: string) => s.padEnd(44, "w");
const DAY = 86_400_000;

test("the tape hands every SOL trade to the ledger; flushes add up per wallet and coin", () => {
  const db = new DatabaseSync(":memory:");
  const l = new WalletLedger(db);
  const t = new PumpTape();
  t.onFill = (w, m, sol, isBuy, ts) => l.fill(w, m, sol, isBuy, ts);
  const mint = pad("M");
  const t0 = Date.now();
  t.apply({ kind: "create", name: "x", symbol: "X", mint, creator: pad("Dev"), ts: t0 }, t0, "c", 1);
  t.apply({ kind: "trade", mint, sol: 1, tokens: 30_000_000, isBuy: true, user: pad("A"), ts: t0 + 1_000, curveSol: 31 }, t0, "t1", 2);
  t.apply({ kind: "trade", mint, sol: 0.0001, tokens: 1, isBuy: true, user: pad("A"), ts: t0 + 1_500, curveSol: 31 }, t0, "t2", 2);
  l.flush();
  t.apply({ kind: "trade", mint, sol: 1.5, tokens: 30_000_000, isBuy: false, user: pad("A"), ts: t0 + 9_000, curveSol: 30 }, t0, "t3", 3);
  l.flush();
  const row = db.prepare("SELECT * FROM wallet_pnl WHERE wallet = ?").get(pad("A")) as { sol_in: number; sol_out: number; first_ts: number; last_ts: number };
  assert.equal(row.sol_in, 1, "dust left out");
  assert.equal(row.sol_out, 1.5);
  assert.equal(row.first_ts, t0 + 1_000);
  assert.equal(row.last_ts, t0 + 9_000);
});

test("scoring: realized PnL with recency decay, minimum coins sold, operators out, one wallet per cluster", async () => {
  const db = new DatabaseSync(":memory:");
  const l = new WalletLedger(db);
  const now = Date.now();
  const trade = (w: string, n: number, inSol: number, outSol: number, ago: number) => {
    for (let i = 0; i < n; i++) {
      l.fill(w, `m${w}${i}`, inSol, true, now - ago);
      if (outSol) l.fill(w, `m${w}${i}`, outSol, false, now - ago);
    }
  };
  trade("fresh", 12, 1, 2, DAY); // +12 SOL, recent
  trade("stale", 12, 1, 3, 60 * DAY); // +24 SOL, two months ago: decays below fresh
  trade("few", 3, 1, 10, DAY); // too few coins
  trade("loser", 12, 2, 1, DAY);
  trade("op", 12, 1, 5, DAY);
  trade("twin", 12, 1, 1.9, DAY); // same funder as fresh
  trade("holder", 12, 1, 0, DAY); // never sold: nothing realized
  l.flush();
  const s = await l.score(now, { isOperator: (w) => w === "op", clusterOf: (w) => (w === "fresh" || w === "twin" ? "f1" : null) });
  assert.deepEqual(s.wallets.map((w) => w.wallet), ["fresh", "stale"]);
  assert.equal(s.wallets[0]!.realizedSol, 12);
  assert.equal(s.wallets[0]!.linked, 1);
  assert.equal(s.wallets[1]!.realizedSol, 24);
  assert.ok(s.wallets[1]!.score < s.wallets[0]!.score);
  assert.deepEqual(s.excluded, { operators: 1, linked: 1 });
});

test("prune drops pairs past 90 days, two-day-old dust and rows over the cap", () => {
  const db = new DatabaseSync(":memory:");
  const l = new WalletLedger(db);
  const now = Date.now();
  l.fill("a", "old", 1, true, now - 91 * DAY);
  l.fill("a", "dust", 0.01, true, now - 3 * DAY);
  l.fill("a", "keep", 0.01, true, now - DAY);
  l.fill("a", "keep2", 1, true, now - 2 * DAY);
  l.fill("a", "keep3", 1, true, now - 1);
  l.flush();
  assert.deepEqual(l.prune(now), { old: 1, dust: 1, capped: 0 });
  assert.equal(l.rows(), 3);
  // Over the cap: the least recently traded go first.
  assert.equal(l.prune(now, 2).capped, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM wallet_pnl WHERE mint = 'keep2'").get()!.n, 0);
});

test("the hot path stays cheap and the pending map is capped", () => {
  const db = new DatabaseSync(":memory:");
  const l = new WalletLedger(db);
  const t0 = performance.now();
  for (let i = 0; i < 200_000; i++) l.fill(`w${i % 50_000}`, `m${i % 3_000}`, 0.1, i % 3 !== 0, i);
  const perFillUs = ((performance.now() - t0) * 1000) / 200_000;
  assert.ok(perFillUs < 20, `a fill took ${perFillUs.toFixed(2)} µs`);
  assert.ok(l.queued <= PNL.maxPending);
});
