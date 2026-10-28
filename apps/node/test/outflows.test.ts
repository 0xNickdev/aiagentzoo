import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SOLANA_RPC_URL = "https://rpc.example/?api-key=test";
const { traceOutflows } = await import("../src/chain/outflows.ts");

const SOL = 1_000_000_000;
const LAUNCH = 1_800_000_000_000;
const t = (min: number) => (LAUNCH + min * 60_000) / 1000;

// Each wallet's transfers, newest first, as Helius's enhanced API returns them.
const pages: Record<string, unknown[]> = {
  DEV: [
    { signature: "d3", timestamp: t(40), nativeTransfers: [{ fromUserAccount: "DEV", toUserAccount: "DEPOSIT", amount: 8 * SOL }] },
    { signature: "d2", timestamp: t(30), nativeTransfers: [{ fromUserAccount: "DEV", toUserAccount: "CREW", amount: 1 * SOL }, { fromUserAccount: "DEV", toUserAccount: "TIP", amount: 0.001 * SOL }] },
    { signature: "d1", timestamp: t(-10), nativeTransfers: [{ fromUserAccount: "DEV", toUserAccount: "OLD", amount: 5 * SOL }] },
  ],
  CREW: [{ signature: "c1", timestamp: t(50), nativeTransfers: [{ fromUserAccount: "CREW", toUserAccount: "BANK", amount: 3 * SOL }] }],
  DEPOSIT: [{ signature: "p1", timestamp: t(41), nativeTransfers: [{ fromUserAccount: "DEPOSIT", toUserAccount: "HOT", amount: 8 * SOL }] }],
  BANK: [
    { signature: "b2", timestamp: t(60), nativeTransfers: [{ fromUserAccount: "OTHERDEV", toUserAccount: "BANK", amount: 2 * SOL }] },
    { signature: "b1", timestamp: t(55), nativeTransfers: [{ fromUserAccount: "BANK", toUserAccount: "NEXT", amount: 4 * SOL }] },
  ],
};
const fakeFetch = (async (url: string) => {
  const who = /addresses\/([A-Z]+)\//.exec(url)![1]!;
  return new Response(JSON.stringify(url.includes("before=") ? [] : (pages[who] ?? [])));
}) as unknown as typeof fetch;

test("adds up transfers out after the launch, follows a deposit to its exchange and a bank to the devs paying in", async () => {
  const r = await traceOutflows(
    "MINT",
    LAUNCH,
    [{ wallet: "DEV", role: "dev" }, { wallet: "CREW", role: "crew" }],
    (to) => (to === "HOT" ? { kind: "exchange", label: "Binance" } : { kind: "wallet", label: null }),
    (w) => w === "OTHERDEV",
    fakeFetch,
    LAUNCH + 3 * 3_600_000,
  );
  assert.ok(r);
  const by = Object.fromEntries(r.flows.map((f) => [f.to, f]));
  assert.equal(by.DEPOSIT!.kind, "exchange");
  assert.equal(by.DEPOSIT!.label, "Binance");
  assert.equal(by.DEPOSIT!.via, "deposit");
  assert.equal(by.CREW!.kind, "operation");
  assert.equal(by.BANK!.collectsFrom, 1);
  assert.equal(by.BANK!.then?.to, "NEXT");
  assert.equal(by.OLD, undefined, "a transfer before the launch is not this launch's money");
  assert.equal(by.TIP, undefined, "dust stays out");
  // 8 to the exchange + 3 to the bank; the 1 SOL between the operation's own wallets is not money gone.
  assert.equal(r.totalSol, 11);
  assert.equal(r.wallets[0]!.reached, true);
});
