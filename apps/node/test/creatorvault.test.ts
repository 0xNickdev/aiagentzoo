import assert from "node:assert/strict";
import { test } from "node:test";
import { curveCreatorVaultOf, poolCreatorVaultAuthorityOf, poolCreatorVaultOf, unclaimedCreatorFees } from "../src/chain/creatorVault.ts";

// Checked on mainnet, 27 Nov 2026: each curve vault is the creator_vault account of a real pump.fun buy of that
// creator's coin, and the PumpSwap vault is the WSOL account (owned by the authority) a CollectCoinCreatorFee emptied.
test("the creator vault addresses are pump.fun's and PumpSwap's own", () => {
  assert.equal(curveCreatorVaultOf("98F33reMHW7n8xeGrawcDgpBSGgv1c8Y8bMqBLVYtkqF"), "2zPp25NdZSzQ5wLkLC1rv6CqCW5j37NiZRxHxJR4SoRn");
  assert.equal(curveCreatorVaultOf("82KxsQmZt9dHDKmtTys7xENeqfK7oUr93BPG73GUWcim"), "3gi89P4zBDhMcZzoPpoLQdZfL52c4hYN8r4DMG7MbUE6");
  assert.equal(curveCreatorVaultOf("A3DNJxNNRtcndwHuiwU5JwQ2ctdSitdN1cBgdLsjFPrJ"), "3XWEgpbUQs5L2WwJoE5wMvG8eGjtXm3hTFXHGVkMjcPD");
  assert.equal(poolCreatorVaultAuthorityOf("9cE3QMYTN49NJwdbFcs61DZPzJvV8X3SvSw6VvTBXR7"), "XoydaMVgX7Qf2pJhDohddvVNq5ssT7eCccAnLmVxDJV");
  assert.equal(poolCreatorVaultOf("9cE3QMYTN49NJwdbFcs61DZPzJvV8X3SvSw6VvTBXR7"), "SwiSUQhJ8L2aPoffRpoRc3nB584tzyZmXFioZct1SvD");
});

test("unclaimed: the curve vault's SOL above rent, plus the PumpSwap vault's WSOL; an account never made is zero", async () => {
  const calls: string[] = [];
  // As mainnet answered for 98F33...: 161,919,297 lamports in the curve vault, 0.01166 WSOL in the PumpSwap one.
  const rpc = async <T>(method: string, params: unknown[]): Promise<T | null> => {
    calls.push(method);
    if (method === "getMinimumBalanceForRentExemption") return 650_240 as T;
    const [keys] = params as [string[]];
    assert.deepEqual(keys, ["2zPp25NdZSzQ5wLkLC1rv6CqCW5j37NiZRxHxJR4SoRn", poolCreatorVaultOf("98F33reMHW7n8xeGrawcDgpBSGgv1c8Y8bMqBLVYtkqF")]);
    return { value: [{ lamports: 161_919_297, space: 0 }, { lamports: 13_148_440, space: 165, data: { parsed: { info: { tokenAmount: { amount: "11660000" } } } } }] } as T;
  };
  assert.deepEqual(await unclaimedCreatorFees("98F33reMHW7n8xeGrawcDgpBSGgv1c8Y8bMqBLVYtkqF", rpc), { sol: 0.172929, curve: 0.161269, pool: 0.01166 });
  const none = async <T>(method: string): Promise<T | null> => (method === "getMultipleAccounts" ? ({ value: [null, null] } as T) : null);
  // The rent is asked once and kept.
  assert.deepEqual(await unclaimedCreatorFees("82KxsQmZt9dHDKmtTys7xENeqfK7oUr93BPG73GUWcim", none), { sol: 0, curve: 0, pool: 0 });
  assert.equal(await unclaimedCreatorFees("82KxsQmZt9dHDKmtTys7xENeqfK7oUr93BPG73GUWcim", async () => null), null);
});
