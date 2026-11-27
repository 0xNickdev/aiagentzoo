import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { graduatedFrom } from "../src/chain/adopt.ts";
import { DBC_POOL_AUTHORITY, fromRpc, parseLaunchpads } from "../src/chain/launchpads.ts";
import { PumpTape } from "../src/chain/pump.ts";
import { fromBase58, type PumpEvent } from "../src/chain/pumpParse.ts";
import { raydiumFollower } from "../src/chain/stream.ts";

// Real mainnet transactions: a Meteora curve migrating to DAMM v2 (2wHj21...), a buy and a sell in that DAMM v2 pool
// (63QzTU..., 5TMtDv...).
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/migrations.json", import.meta.url), "utf8")) as Array<{ what: string; tx: any }>;
const parse = (what: string, ts = 0) => parseLaunchpads(fromRpc(fixtures.find((f) => f.what === what)!.tx, fromBase58), ts) as any[];

const DBC_MINT = "3iBohACVmao9UcDjBCv7fpNaPnVMTJ5LmVZWT8LYt1By";
const DAMM_POOL = "EM7fbQcaFcdpUzTdvqyJkpTH8hPVbM6mXwbueanoEbUk";
const OTHER_POOL = "69bFbXmMi1D24xXPiEyrzY7uLfLLh84azSLnoMcZUmoo";
const DEV = "11111111111111111111111111111112";

test("a Meteora curve's migration to DAMM v2 graduates the coin and names its pool; that pool's swaps are read", () => {
  assert.deepEqual(parse("dbc:migrate-damm2"), [
    { kind: "complete", mint: DBC_MINT },
    { kind: "pool", mint: DBC_MINT, pool: DAMM_POOL, venue: "damm" },
  ]);
  const [buy] = parse("damm:buy", 2_000);
  assert.deepEqual(
    [buy.kind, buy.venue, buy.mint, buy.pool, buy.user, buy.isBuy, buy.sol, buy.tokens],
    ["trade", "damm", DBC_MINT, DAMM_POOL, "4igUVo2YLbonkQQpGk2T4BQc4UVxV7dL6YwNqj7JDGJA", true, 0.098901, 3_776_032.239017],
  );
  const [sell] = parse("damm:sell");
  assert.deepEqual([sell.isBuy, sell.sol, sell.tokens], [false, 0.482096333, 20_386_606.656774]);
});

test("on the tape: the graduated coin trades on in its pool under the same coin, another pool's trades do not count", () => {
  const tape = new PumpTape();
  const now = Date.now();
  tape.apply({ kind: "create", venue: "dbc", name: "x", symbol: "X", mint: DBC_MINT, creator: DEV, ts: now - 3_600_000 }, now);
  for (const ev of parse("dbc:migrate-damm2")) tape.apply(ev, now);
  let f = tape.facts(DBC_MINT, now)!;
  assert.equal(f.graduated, true);
  assert.equal(f.venue, "dbc");
  const [buy] = parse("damm:buy", now - 1_000) as Array<Extract<PumpEvent, { kind: "trade" }>>;
  tape.apply(buy!, now);
  // The same swap in some other DAMM pool of this token is not this coin's trading.
  tape.apply({ ...buy!, pool: "So11111111111111111111111111111111111111112", user: "Other1111111111111111111111111111111111111" }, now);
  f = tape.facts(DBC_MINT, now)!;
  assert.equal(f.buys, 1);
  assert.equal(f.buyers, 1);
  // Followed again after a restart, in the DAMM lane.
  assert.deepEqual(tape.raydiumPools(now).map((p) => [p.pool, p.venue]), [[DAMM_POOL, "damm"]]);
  const again = new PumpTape();
  again.load(tape.snapshot(), now);
  assert.deepEqual(again.raydiumPools(now).map((p) => [p.pool, p.venue]), [[DAMM_POOL, "damm"]]);
  const follower = raydiumFollower(again);
  assert.deepEqual(follower.dammPools(), [DAMM_POOL]);
  assert.equal(follower.pools.size, 0);

});

test("adoption: a DAMM v2 pool Meteora's curve opened is that coin's, graduated", async () => {
  const rpc = async <T>(method: string, params: unknown[]): Promise<T | null> => {
    const [addr, opts] = params as [string, { dataSlice?: { length: number } }];
    if (method !== "getAccountInfo") return null;
    if (addr === DAMM_POOL && opts.dataSlice?.length === 32) return { value: { data: [Buffer.from(fromBase58(DBC_POOL_AUTHORITY)).toString("base64"), "base64"] } } as T;
    return { value: { data: [Buffer.alloc(32).toString("base64"), "base64"] } } as T;
  };
  assert.deepEqual(await graduatedFrom(DBC_MINT, { kind: "raydium", venue: "damm", pool: DAMM_POOL, listedAt: null }, rpc), { venue: "dbc", poolVenue: "damm" });
  // Someone else's DAMM pool for the token is no graduation.
  assert.equal(await graduatedFrom(DBC_MINT, { kind: "raydium", venue: "damm", pool: OTHER_POOL, listedAt: null }, rpc), null);

  // Adopted as Meteora's coin, graduated, its DAMM pool followed in the DAMM lane, and its trades there read back.
  const tape = new PumpTape();
  const followed: Array<[string, string | undefined]> = [];
  tape.followRaydium = (pool, _now, venue) => void followed.push([pool, venue]);
  const now = Date.now();
  const [buy] = parse("damm:buy", now - 1_000);
  assert.equal(tape.adoptToken({ mint: DBC_MINT, kind: "raydium", venue: "dbc", poolVenue: "damm", pool: DAMM_POOL, creator: DEV, createdAt: now - 86_400_000, trades: [{ ev: buy }] }, now), true);
  assert.deepEqual(followed, [[DAMM_POOL, "damm"]]);
  const f = tape.facts(DBC_MINT, now)!;
  assert.deepEqual([f.venue, f.graduated, f.buys], ["dbc", true, 1]);
});
