import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BaseFeed, CLANKER_FACTORY, CLANKER_SUPPLY, createEvent, parseCreate, parseSwap, POOL_MANAGER, TOPIC, traderOf, WETH, type ParsedSwap } from "../src/chain/base.ts";
import { type EvmLog, TRANSFER_TOPIC, ZERO } from "../src/chain/bsc.ts";
import { PumpTape } from "../src/chain/pump.ts";
import { PositionBook } from "../src/chain/bscHolders.ts";

/** Real logs from Base: four Clanker launches and three swaps on the CLANKEYS pool, as publicnode served them. */
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/clanker-logs.json", import.meta.url), "utf8")) as { creates: EvmLog[]; swaps: EvmLog[] };
const CLANKEYS = FIXTURE.creates.find((l) => l.transactionHash === "0xe09c23fdb7c53d41ad8c9b8ea08a7f831fdaa0f6247ef27f655295fca6b43a46")!;
const THANOS = FIXTURE.creates.find((l) => l.transactionHash === "0xf4bdb7abf7dd65a806079291dbd82a9484635f5221a179186f69f70ffb7333fc")!;
const KEYS_MINT = "0x0da6caaf2adb95ea87a9d7f23515f012e129cb07";
const KEYS_ADMIN = "0xb2322fb6b8a3b9bafeccde9dfc44ba9faf6ce6e7";
const KEYS_POOL = "0x9c40d578af12213b9341eaf181b5cb79b6bba3c1ac0b8c17a310e3274571b02c";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43";
const SNIPER = "0xc12073cd7ae4394ce6f184598f4e4b9d89db863f";
const E18 = 10n ** 18n;

const hex = (n: bigint) => `0x${n.toString(16)}`;
const wordOf = (n: bigint) => (n < 0n ? (n + (1n << 256n)).toString(16) : n.toString(16)).padStart(64, "0");
const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
/** A launch log as the chain wrote it, moved to a block and time of the test's choosing. */
const createAt = (log: EvmLog, block: number, ts: number): EvmLog => ({ ...log, blockNumber: hex(BigInt(block)), blockTimestamp: hex(BigInt(ts)) });
/** Swap(id, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee): the trader's deltas, positive is what they received. */
const swapLog = (pool: string, tokenDelta: bigint, quoteDelta: bigint, baseIsToken0: boolean, block: number, ts: number, tx: string, index: number): EvmLog => ({
  address: POOL_MANAGER,
  topics: [TOPIC.swap, pool, pad(ROUTER)],
  data: `0x${wordOf(baseIsToken0 ? tokenDelta : quoteDelta)}${wordOf(baseIsToken0 ? quoteDelta : tokenDelta)}${wordOf(1n << 96n)}${wordOf(1n)}${wordOf(-230400n)}${wordOf(10000n)}`,
  blockNumber: hex(BigInt(block)),
  blockTimestamp: hex(BigInt(ts)),
  transactionHash: tx,
  logIndex: hex(BigInt(index)),
});
const transferLog = (token: string, from: string, to: string, tokens: bigint, block: number, ts: number, tx: string, index: number): EvmLog => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad(from), pad(to)],
  data: `0x${wordOf(tokens)}`,
  blockNumber: hex(BigInt(block)),
  blockTimestamp: hex(BigInt(ts)),
  transactionHash: tx,
  logIndex: hex(BigInt(index)),
});

test("Clanker's TokenCreated decodes: the admin, the deployer, strings, the pool id, the quote, the links and the request's origin", () => {
  const l = parseCreate(CLANKEYS)!;
  assert.equal(l.mint, KEYS_MINT);
  assert.equal(l.admin, KEYS_ADMIN);
  assert.equal(l.deployer, KEYS_ADMIN);
  assert.equal(l.name, "CLANKER KEYS");
  assert.equal(l.symbol, "CLANKEYS");
  assert.match(l.image!, /^https:\/\/clankerworld\.mypinata\.cloud\/ipfs\//);
  assert.equal(l.poolId, KEYS_POOL);
  assert.equal(l.quote, WETH);
  assert.equal(l.hook, "0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc");
  assert.equal(l.links.web, "https://clankerkeys.vercel.app/");
  assert.equal(l.links.x, null);
  assert.equal(l.interface, "clanker.world");
  assert.deepEqual(l.extensions, ["0xf652b3610d75d81871bf96db50825d9af28391e0"]);
  assert.equal(l.block, 0x32aeadf);
  assert.equal(l.ts, 0x6ae032a1 * 1000);
  // The tape's create: the admin is the creator, a hundred billion supply, ETH-paired so no quote, launched on Clanker.
  const ev = createEvent(l);
  assert.equal(ev.creator, KEYS_ADMIN);
  assert.equal(ev.venue, "clanker");
  assert.equal(ev.supply, CLANKER_SUPPLY);
  assert.equal(ev.quote, null);
  assert.equal(ev.platform, undefined);
  // A USDC-paired launch asked for on Farcaster names its quote.
  const t = parseCreate(THANOS)!;
  assert.equal(t.symbol, "TNS");
  assert.equal(t.quote, USDC);
  assert.equal(t.platform, "farcaster");
  assert.equal(createEvent(t).quote, USDC);
  // Not the factory's, or not a create: nothing.
  assert.equal(parseCreate({ ...CLANKEYS, address: POOL_MANAGER }), null);
  assert.equal(parseCreate({ ...CLANKEYS, topics: [TOPIC.swap, ...CLANKEYS.topics.slice(1)] }), null);
});

test("a PoolManager Swap decodes as the trader's deltas: tokens in and quote out is a buy, in the quote's own decimals", () => {
  const pool = { mint: KEYS_MINT, baseIsToken0: true, quoteDecimals: 18, quoteNet: 0 };
  // The chain's own swap on the CLANKEYS pool: 992 tokens received for a sliver of ETH.
  const real = parseSwap(FIXTURE.swaps[0]!, pool)!;
  assert.equal(real.pool, KEYS_POOL);
  assert.equal(real.isBuy, true);
  assert.ok(Math.abs(real.tokens - 992.44) < 0.01, `${real.tokens}`);
  assert.ok(real.quote > 0 && real.quote < 1e-6, `${real.quote}`);
  assert.equal(real.sender, "0x7d6839415693801e94cdc4a7d732c9a3fdbbd1d7");
  // A sell with the token as currency1, quoted in USDC's six decimals.
  const sell = parseSwap(swapLog(KEYS_POOL, -5_000_000n * E18, 2_500_000n, false, 10, 1_000, "0x01", 3), { mint: KEYS_MINT, baseIsToken0: false, quoteDecimals: 6, quoteNet: 0 })!;
  assert.equal(sell.isBuy, false);
  assert.equal(sell.tokens, 5_000_000);
  assert.equal(sell.quote, 2.5);
  // Both sides in or both out is not a trade of ours.
  assert.equal(parseSwap(swapLog(KEYS_POOL, 5n * E18, 1n, true, 10, 1_000, "0x02", 3), pool), null);
});

test("the trader is the wallet the tokens netted to: routers pass them through, the PoolManager and the factory are legs", () => {
  const legs = new Set([POOL_MANAGER, CLANKER_FACTORY, ZERO, KEYS_MINT]);
  const buy = { pool: KEYS_POOL, isBuy: true, tokens: 100, quote: 0.01, sender: ROUTER, ts: 1, block: 1, tx: "0x1", logIndex: 1 } satisfies ParsedSwap;
  const via = [
    { token: KEYS_MINT, from: POOL_MANAGER, to: ROUTER, amount: 100, logIndex: 2 },
    { token: KEYS_MINT, from: ROUTER, to: SNIPER, amount: 100, logIndex: 3 },
  ];
  assert.equal(traderOf(buy, KEYS_MINT, via, legs), SNIPER);
  assert.equal(traderOf(buy, KEYS_MINT, [{ token: KEYS_MINT, from: POOL_MANAGER, to: SNIPER, amount: 100, logIndex: 2 }], legs), SNIPER);
  const sell = { ...buy, isBuy: false };
  assert.equal(traderOf(sell, KEYS_MINT, [{ token: KEYS_MINT, from: SNIPER, to: ROUTER, amount: 100, logIndex: 2 }, { token: KEYS_MINT, from: ROUTER, to: POOL_MANAGER, amount: 100, logIndex: 3 }], legs), SNIPER);
  // Another token's transfers in the same transaction say nothing about this one; no transfer, no name.
  assert.equal(traderOf(buy, KEYS_MINT, [{ token: USDC, from: SNIPER, to: POOL_MANAGER, amount: 5, logIndex: 2 }], legs), null);
});

test("the feed: a launch lands on the tape with the dev's buy from its receipt, swaps become trades by the wallet their transfer names, a plain transfer moves positions", async () => {
  const tape = new PumpTape("ETH");
  const book = new PositionBook();
  const t0 = Math.floor(Date.now() / 1000) - 20 * 60;
  const block = 53_000_000;
  const launchTx = "0xaa01";
  const receipts: string[] = [];
  const rpc = (async (_url: string, method: string, params: unknown[]) => {
    if (method === "eth_getTransactionReceipt") {
      receipts.push(String(params[0]));
      // The launch transaction: the supply minted to the factory, the pool filled, and the dev's own buy.
      return {
        blockNumber: hex(BigInt(block)),
        logs: [
          transferLog(KEYS_MINT, ZERO, CLANKER_FACTORY, 100_000_000_000n * E18, block, t0, launchTx, 1),
          transferLog(KEYS_MINT, CLANKER_FACTORY, POOL_MANAGER, 90_000_000_000n * E18, block, t0, launchTx, 2),
          swapLog(KEYS_POOL, 2_000_000_000n * E18, -(E18 / 10n), true, block, t0, launchTx, 7),
          transferLog(KEYS_MINT, POOL_MANAGER, KEYS_ADMIN, 2_000_000_000n * E18, block, t0, launchTx, 8),
        ],
      };
    }
    throw new Error(method);
  }) as never;
  const launches: string[] = [];
  const feed = new BaseFeed(tape, { rpc, book, decimalsOf: async () => 18, onLaunch: (l) => launches.push(l.symbol), log: () => {} });
  feed.backfilled = true;
  feed.onLog(createAt({ ...CLANKEYS, transactionHash: launchTx }, block, t0));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(launches, ["CLANKEYS"]);
  assert.deepEqual(receipts, [launchTx]);
  assert.equal(feed.pools.get(KEYS_POOL)?.mint, KEYS_MINT);
  // A sniper buys through the router one block later; a bot swaps with nothing of ours in it.
  const buyTx = "0xaa02";
  feed.onLog(swapLog(KEYS_POOL, 1_000_000_000n * E18, -(E18 / 20n), true, block + 1, t0 + 2, buyTx, 3));
  feed.onLog(transferLog(KEYS_MINT, POOL_MANAGER, ROUTER, 1_000_000_000n * E18, block + 1, t0 + 2, buyTx, 4));
  feed.onLog(transferLog(KEYS_MINT, ROUTER, SNIPER, 1_000_000_000n * E18, block + 1, t0 + 2, buyTx, 5));
  feed.onLog(swapLog("0x" + "ab".repeat(32), 5n * E18, -1n, true, block + 1, t0 + 2, "0xaa03", 1));
  // Later the dev sells all they bought, and the sniper hands half their bag to a friend by plain transfer.
  const sellTx = "0xaa04";
  feed.onLog(swapLog(KEYS_POOL, -2_000_000_000n * E18, E18 / 8n, true, block + 200, t0 + 400, sellTx, 2));
  feed.onLog(transferLog(KEYS_MINT, KEYS_ADMIN, POOL_MANAGER, 2_000_000_000n * E18, block + 200, t0 + 400, sellTx, 3));
  feed.onLog(transferLog(KEYS_MINT, SNIPER, "0x00000000000000000000000000000000000000f1", 500_000_000n * E18, block + 201, t0 + 402, "0xaa05", 1));
  feed.settle(Date.now(), true);
  const t = tape.token(KEYS_MINT)!;
  assert.equal(t.symbol, "CLANKEYS");
  assert.equal(t.facts.venue, "clanker");
  assert.equal(t.facts.buys, 2);
  assert.equal(t.facts.sells, 1);
  assert.equal(t.facts.creatorSold, 1);
  assert.equal(t.facts.graduated, false);
  assert.equal(t.facts.curveSol, null);
  assert.ok(Math.abs(t.facts.solIn - 0.15) < 1e-9, `${t.facts.solIn}`);
  assert.deepEqual((tape.earlyOf(KEYS_MINT) ?? []).map((e) => e.wallet), [SNIPER]);
  // The pool's quote: a tenth in, a twentieth in, an eighth out.
  assert.ok(Math.abs(feed.quoteNetOf(KEYS_MINT)! - 0.025) < 1e-9);
  // Positions: the dev bought and sold back; the sniper keeps half, the friend has the other half; the router nothing.
  assert.deepEqual(book.top(KEYS_MINT), [SNIPER, "0x00000000000000000000000000000000000000f1"]);
  assert.equal(feed.unnamed, 0);
  // The feed's snapshot carries the pools a restart needs; a new feed follows them for the tokens the tape still has.
  const saved = JSON.parse(feed.snapshot()) as { cursor: number; pools: Array<[string, { mint: string }]> };
  assert.equal(saved.cursor, block + 201);
  assert.equal(saved.pools[0]![0], KEYS_POOL);
  const again = new BaseFeed(tape, { pools: saved.pools as never, decimalsOf: async () => 18, log: () => {} });
  assert.equal(again.pools.get(KEYS_POOL)?.mint, KEYS_MINT);
});

test("a USDC-paired launch asks the chain for the quote's decimals and reads its swaps in those; the tape keeps the quote", async () => {
  const tape = new PumpTape("ETH");
  const asked: string[] = [];
  const feed = new BaseFeed(tape, { decimalsOf: async (token) => (asked.push(token), 6), book: new PositionBook(), log: () => {} });
  const t0 = Math.floor(Date.now() / 1000) - 60;
  const poolId = `0x${THANOS.data.slice(2 + 8 * 64, 66 + 8 * 64)}`;
  feed.onLog(createAt(THANOS, 100, t0));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(asked, [USDC]);
  const mint = "0x1776b6cdf9f4d301eb6aa6b4e9924dc6d9b5fb07";
  assert.equal(feed.pools.get(poolId)?.quoteDecimals, 6);
  // The token's address sorts below USDC's: it is currency0.
  assert.equal(feed.pools.get(poolId)?.baseIsToken0, true);
  feed.onLog(swapLog(poolId, 1_000_000n * E18, -25_000_000n, true, 101, t0 + 2, "0xbb01", 1));
  feed.onLog(transferLog(mint, POOL_MANAGER, SNIPER, 1_000_000n * E18, 101, t0 + 2, "0xbb01", 2));
  feed.settle(Date.now(), true);
  const t = tape.token(mint)!;
  assert.equal(t.facts.quote, USDC);
  assert.equal(t.facts.buys, 1);
  assert.equal(t.facts.solIn, 25);
});

test("the backfill reads the factory first, then the chunk's swaps for the pools it now follows and the transfers of its tokens, in ranges of ten thousand blocks", async () => {
  const tape = new PumpTape("ETH");
  const asked: Array<{ from: number; to: number; address: unknown; topics: unknown }> = [];
  const head = 53_100_000;
  const t0 = Math.floor(Date.now() / 1000) - 3_600;
  const launchBlock = head - 15_000;
  const rpc = (async (_url: string, method: string, params: unknown[]) => {
    if (method === "eth_blockNumber") return hex(BigInt(head));
    if (method === "eth_getLogs") {
      const p = params[0] as { fromBlock: string; toBlock: string; address: unknown; topics: unknown };
      const from = Number(p.fromBlock);
      const to = Number(p.toBlock);
      asked.push({ from, to, address: p.address, topics: p.topics });
      const inRange = (b: number) => b >= from && b <= to;
      if (p.address === CLANKER_FACTORY) return inRange(launchBlock) ? [createAt(CLANKEYS, launchBlock, t0)] : [];
      if (p.address === POOL_MANAGER) {
        // A swap in the launch's own chunk, and one later: both only once the pool is asked for.
        const pools = (p.topics as unknown[])[1] as string[];
        assert.ok(pools.includes(KEYS_POOL));
        return [launchBlock + 2, launchBlock + 12_000].filter(inRange).map((b, i) => swapLog(KEYS_POOL, 1_000_000n * E18, -(E18 / 100n), true, b, t0 + (b - launchBlock) * 2, `0xcc0${i}${b}`, 1));
      }
      // The tokens' transfers: the sniper's buy legs.
      return [launchBlock + 2, launchBlock + 12_000].filter(inRange).map((b, i) => transferLog(KEYS_MINT, POOL_MANAGER, SNIPER, 1_000_000n * E18, b, t0 + (b - launchBlock) * 2, `0xcc0${i}${b}`, 2));
    }
    throw new Error(method);
  }) as never;
  const sockets: Array<{ onopen?: () => void; onmessage?: (m: { data: string }) => void; close(): void }> = [];
  class FakeSocket {
    onopen?: () => void;
    onmessage?: (m: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    readyState = 1;
    constructor() {
      sockets.push(this);
      setTimeout(() => this.onopen?.(), 1);
    }
    send(raw: string) {
      const msg = JSON.parse(raw) as { id: number };
      if (msg.id === 1) setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: 1, result: "0x1" }) }), 1);
    }
    close() {
      setTimeout(() => this.onclose?.(), 1);
    }
  }
  const feed = new BaseFeed(tape, { cursor: head - 25_002, rpc, decimalsOf: async () => 18, book: new PositionBook(), WebSocketImpl: FakeSocket as never, log: () => {} });
  const stop = feed.start();
  await new Promise((r) => setTimeout(r, 80));
  stop();
  const factory = asked.filter((a) => a.address === CLANKER_FACTORY);
  assert.equal(factory.length, 3, `${factory.length} factory ranges`);
  for (const a of asked) assert.ok(a.to - a.from <= 9_999 && a.from <= a.to, `range ${a.from}..${a.to}`);
  for (let i = 1; i < factory.length; i++) assert.equal(factory[i]!.from, factory[i - 1]!.to + 1);
  assert.equal(factory[factory.length - 1]!.to, head);
  // Before the launch's chunk no pool was followed, so no swaps were asked for; after it, every chunk asks.
  const swaps = asked.filter((a) => a.address === POOL_MANAGER);
  assert.equal(swaps.length, 2);
  assert.equal(tape.token(KEYS_MINT)?.facts.buys, 2);
  assert.deepEqual((tape.earlyOf(KEYS_MINT) ?? []).map((e) => e.wallet), [SNIPER]);
  assert.equal(feed.cursor, head);
  assert.equal(feed.backfilled, true);
});

test("the node tells a Base token from a BNB Chain one by the tape that has it: check and x-ray say chain base, an unknown 0x answers in the asked chain's words", async () => {
  const { Enclosure, Identity } = await import("@aiagentzoo/sdk");
  const { createNodeServer } = await import("../src/server.ts");
  const { baseTape } = await import("../src/chain/base.ts");
  const { bscTape } = await import("../src/chain/bsc.ts");
  const t0 = Math.floor(Date.now() / 1000) - 10 * 60;
  const block = 53_200_000;
  const feed = new BaseFeed(baseTape, { decimalsOf: async () => 18, book: new PositionBook(), log: () => {} });
  feed.onLog(createAt(CLANKEYS, block, t0));
  await new Promise((r) => setTimeout(r, 20));
  feed.onLog(swapLog(KEYS_POOL, 1_000_000_000n * E18, -(E18 / 20n), true, block + 1, t0 + 2, "0xdd01", 3));
  feed.onLog(transferLog(KEYS_MINT, POOL_MANAGER, SNIPER, 1_000_000_000n * E18, block + 1, t0 + 2, "0xdd01", 4));
  feed.settle(Date.now(), true);
  baseTape.connected = true;
  baseTape.lastEventAt = Date.now();
  bscTape.lastEventAt ||= Date.now();
  const enclosure = new Enclosure({ node: { id: "north.zoo", identity: Identity.generate(), operator: "op" }, keeper: "keeper", tools: [], agents: [] });
  const server = createNodeServer({ enclosure });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const c = (await (await fetch(`${base}/v1/check/${KEYS_MINT.toUpperCase().replace("0X", "0x")}`)).json()) as { mint: string; chain: string; verdict: string; facts: { venue: string; quote: string | null } };
    assert.equal(c.mint, KEYS_MINT);
    assert.equal(c.chain, "base");
    assert.equal(c.facts.venue, "clanker");
    assert.equal(c.facts.quote, null);
    const x = (await (await fetch(`${base}/v1/xray/${KEYS_MINT}`)).json()) as { chain: string; symbol: string; creator: string; early: Array<{ wallet: string }> };
    assert.equal(x.chain, "base");
    assert.equal(x.symbol, "CLANKEYS");
    assert.equal(x.creator, KEYS_ADMIN);
    assert.deepEqual(x.early.map((e) => e.wallet), [SNIPER]);
    const w = (await (await fetch(`${base}/v1/wallet/${KEYS_ADMIN}`)).json()) as { chain: string; dev: { launches: unknown[] } | null };
    assert.equal(w.chain, "base");
    assert.equal(w.dev?.launches.length, 1);
    // A 0x address no tape knows is BNB Chain unless the caller says Base.
    const unknown = (await (await fetch(`${base}/v1/check/0x0000000000000000000000000000000000000002`)).json()) as { chain: string; verdict: string; reasons: string[] };
    assert.equal(unknown.chain, "bsc");
    assert.match(unknown.reasons[0]!, /four\.meme/);
    const asked = (await (await fetch(`${base}/v1/check/0x0000000000000000000000000000000000000002?chain=base`)).json()) as { chain: string; reasons: string[] };
    assert.equal(asked.chain, "base");
    assert.match(asked.reasons[0]!, /Clanker/);
    const status = (await (await fetch(`${base}/v1/chain`)).json()) as { base: { tracked: number } };
    assert.equal(status.base.tracked, 1);
    assert.equal(bscTape.token(KEYS_MINT), null);
  } finally {
    server.close();
  }
});
