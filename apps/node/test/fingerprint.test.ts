import { test } from "node:test";
import assert from "node:assert/strict";
import { hostOf, printWarning, type PrintableTx, toolPrintOf } from "../src/chain/fingerprint.ts";
import { fromBase58, PumpTape } from "../src/chain/pump.ts";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const JITO = "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5";
const WALLET_A = "8WZwQJbW3hVq3m8c2fW6mR7oJ2D9qS5uYy4kTzX1aBcD";
const WALLET_B = "BKZEZmfJLghn7aZwQnfi5mgA6GfquFqTjwLx1NgPNm4u";

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

/** A launch transaction as a bot builds it: budget, budget, Jito tip, pump create and buy. */
function launchTx(signer: string, o: { cuLimit?: number; cuPrice?: number; tipLamports?: number; tipTo?: string; lut?: boolean } = {}): PrintableTx {
  const keys = [signer, o.tipTo ?? JITO, COMPUTE_BUDGET, SYSTEM, PUMP].map((k) => new Uint8Array(fromBase58(k)));
  const ix = (programIdIndex: number, data: Buffer, accounts: number[] = []) => ({ programIdIndex, accounts: new Uint8Array(accounts), data: new Uint8Array(data) });
  return {
    transaction: {
      message: {
        header: { numRequiredSignatures: 1 },
        accountKeys: keys,
        instructions: [
          ix(2, Buffer.concat([Buffer.from([2]), u32(o.cuLimit ?? 250_000)])),
          ix(2, Buffer.concat([Buffer.from([3]), u64(o.cuPrice ?? 1_234_567)])),
          ix(3, Buffer.concat([u32(2), u64(o.tipLamports ?? 1_000_000)]), [0, 1]),
          ix(4, Buffer.from([1, 2, 3])),
          ix(4, Buffer.from([4, 5, 6])),
        ],
        addressTableLookups: o.lut ? [{}] : [],
      },
    },
    meta: {},
  };
}

test("a launch's tool print reads the compute budget, the Jito tip and the programs in order", () => {
  const p = toolPrintOf(launchTx(WALLET_A), "https://ipfs.io/ipfs/abc")!;
  assert.equal(p.cuLimit, 250_000);
  assert.equal(p.cuPrice, 1_234_567);
  assert.deepEqual(p.tip, { to: "jito", lamports: 1_000_000 });
  assert.deepEqual(p.programs, ["budget", "system", "pump"]);
  assert.equal(p.signers, 1);
  assert.equal(p.lut, false);
  assert.equal(p.host, "ipfs.io");
  assert.match(p.key, /^[0-9a-f]{6}$/);
  assert.match(p.shape, /^s[0-9a-f]{6}$/);
});

test("a fresh wallet with the same tool setup gets the same print; a different setup does not", () => {
  const a = toolPrintOf(launchTx(WALLET_A), "https://ipfs.io/ipfs/1")!;
  const b = toolPrintOf(launchTx(WALLET_B), "https://ipfs.io/ipfs/2")!;
  assert.equal(a.key, b.key, "the wallet is not part of the print");
  const repriced = toolPrintOf(launchTx(WALLET_B, { cuPrice: 999, tipLamports: 1_500_000 }), "https://ipfs.io/x")!;
  assert.notEqual(repriced.key, a.key);
  assert.equal(repriced.shape, a.shape, "a bot that prices each launch keeps its shape");
  assert.notEqual(toolPrintOf(launchTx(WALLET_B, { tipLamports: 2_000_000 }), "https://ipfs.io/x")!.key, a.key);
  assert.notEqual(toolPrintOf(launchTx(WALLET_B, { lut: true }), "https://ipfs.io/x")!.key, a.key);
  assert.notEqual(toolPrintOf(launchTx(WALLET_B), "https://meta.somebot.xyz/1")!.key, a.key);
});

test("a tip to a non-Jito address keeps that address, so a relay or a bot's fee wallet is part of the print", () => {
  const p = toolPrintOf(launchTx(WALLET_A, { tipTo: WALLET_B }))!;
  assert.deepEqual(p.tip, { to: WALLET_B, lamports: 1_000_000 });
});

test("a message-less update has no print, and a bad uri has no host", () => {
  assert.equal(toolPrintOf({}), null);
  assert.equal(hostOf("not a url"), null);
  assert.equal(hostOf("https://WWW.Example.com/x"), "example.com");
});

const record = (o: Partial<{ wallets: number; settled: number; dumped: number; common: boolean }>) => ({
  key: "abcdef",
  print: toolPrintOf(launchTx(WALLET_A))!,
  launches: 30,
  wallets: o.wallets ?? 8,
  settled: o.settled ?? 25,
  dumped: o.dumped ?? 24,
  common: o.common ?? false,
});

test("the warning needs several wallets, enough settled launches and nearly all of them dumped, and never a common launcher", () => {
  assert.match(printWarning(record({}))!, /^launched with the same tool setup as 7 other wallets/);
  assert.equal(printWarning(record({ wallets: 3 })), null, "two other wallets is not a farm");
  assert.equal(printWarning(record({ settled: 9, dumped: 9 })), null, "too few launches to say");
  assert.equal(printWarning(record({ dumped: 20 })), null, "80% is not nearly all");
  assert.equal(printWarning(record({ common: true })), null, "pump.fun's own site is shared by everyone");
  assert.equal(printWarning(null), null);
  assert.match(printWarning(record({}), true)!, /a tool setup built like that of 7 other wallets/);
});

test("the tape counts launches, wallets and dumps by print, and forgets a print when its launches age out", () => {
  const tape = new PumpTape();
  const print = toolPrintOf(launchTx(WALLET_A))!;
  const t0 = 1_800_000_000_000;
  const creators = Array.from({ length: 5 }, (_, i) => `Creator${i}111111111111111111111111111111`);
  creators.forEach((creator, i) => {
    const mint = `Mint${i}pump1111111111111111111111111111111`;
    tape.apply({ kind: "create", name: `T${i}`, symbol: `T${i}`, mint, creator, ts: t0 + i * 1000, print }, t0 + i * 1000);
    tape.apply({ kind: "trade", mint, sol: 1, tokens: 1_000_000, isBuy: true, user: creator, ts: t0 + i * 1000, curveSol: 31 }, t0 + i * 1000);
    // Four of the five creators sell their whole bag a minute in.
    if (i < 4) tape.apply({ kind: "trade", mint, sol: 1, tokens: 1_000_000, isBuy: false, user: creator, ts: t0 + 60_000, curveSol: 30 }, t0 + 60_000);
  });
  const later = t0 + 20 * 60_000;
  const r = tape.printRecord(print.key, later)!;
  assert.equal(r.launches, 5);
  assert.equal(r.wallets, 5);
  assert.equal(r.settled, 5);
  assert.equal(r.dumped, 4);
  assert.equal(r.common, false);
  assert.equal(tape.printOf("Mint0pump1111111111111111111111111111111", later)!.key, print.key);
  assert.equal(tape.printLaunches(print.key, 2).length, 2);
  assert.equal(tape.shapeOf("Mint0pump1111111111111111111111111111111", later)!.launches, 5);
  assert.deepEqual(tape.topPrints(5, later).map((r) => r.key), [print.key], "the shape adds nothing over the print here");
  // The print survives a restart through the snapshot.
  const reborn = new PumpTape();
  reborn.load(tape.snapshot(), later);
  assert.equal(reborn.printRecord(print.key, later)!.launches, 5);
  // Two days on, the launches and their print are gone.
  tape.prune(t0 + 49 * 3_600_000);
  assert.equal(tape.printRecord(print.key, t0 + 49 * 3_600_000), null);
});
