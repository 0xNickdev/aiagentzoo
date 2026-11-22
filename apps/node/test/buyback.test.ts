import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSwap, tokenAmountOf } from "../src/buyback.ts";

const OWNER = "Hot1111111111111111111111111111111111111111";
const key = (s: string) => ({ toBase58: () => s });
const tx = (signers = 1, payer = OWNER) => ({ message: { header: { numRequiredSignatures: signers }, staticAccountKeys: [key(payer), key("Other111")] } });
/** An SPL token account's data with this amount, base64, as simulateTransaction returns it. */
const tokenData = (amount: bigint): [string, string] => {
  const b = Buffer.alloc(165);
  b.writeBigUInt64LE(amount, 64);
  return [b.toString("base64"), "base64"];
};
const want = { owner: OWNER, lamportsBefore: 1_000_000_000, sellLamports: 100_000_000, tokensBefore: 5n, minTokens: 1_000n };
const sim = (lamports: number, tokens: bigint, owner = "11111111111111111111111111111111", err: unknown = null) => ({ err, accounts: [{ lamports, owner, data: ["", "base64"] }, { lamports: 2_039_280, owner: "Token", data: tokenData(tokens) }] });

test("the buyback signs a swap that sells what it asked and pays the treasury at least the quote's minimum", () => {
  assert.equal(tokenAmountOf(tokenData(42n)), 42n);
  // 0.1 SOL sold plus 0.003 SOL of fees, 1,200 tokens to the treasury: fine.
  assert.equal(checkSwap(tx(), sim(897_000_000, 1_205n), want), 1_200n);
});

test("the buyback refuses a swap that takes more, pays less, adds a signer or fails", () => {
  // An extra transfer out of the hot wallet.
  assert.throws(() => checkSwap(tx(), sim(500_000_000, 1_205n), want), /would lose/);
  // Tokens to someone else: the treasury gets nothing.
  assert.throws(() => checkSwap(tx(), sim(897_000_000, 5n), want), /under the quote's minimum/);
  // Another signer or fee payer.
  assert.throws(() => checkSwap(tx(2), sim(897_000_000, 1_205n), want), /another signer/);
  assert.throws(() => checkSwap(tx(1, "Evil111"), sim(897_000_000, 1_205n), want), /another signer/);
  // The wallet reassigned to another program.
  assert.throws(() => checkSwap(tx(), sim(897_000_000, 1_205n, "EvilProgram"), want), /change owner/);
  // The dry run itself fails.
  assert.throws(() => checkSwap(tx(), sim(897_000_000, 1_205n, undefined, { InstructionError: [0, "Custom"] }), want), /dry run failed/);
});
