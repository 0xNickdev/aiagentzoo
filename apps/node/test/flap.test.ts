import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FLAP_PORTAL, FLAP_SUPPLY, FlapFeed, parseFlapLog, tradersOf } from "../src/chain/flap.ts";
import type { EvmLog } from "../src/chain/bsc.ts";
import { PumpTape } from "../src/chain/pump.ts";
import { PositionBook } from "../src/chain/bscHolders.ts";

/** Three real Flap transactions from BNB Chain: a launch through a launcher bot, a buy through a router, and a buy split over five wallets. */
const TXS = JSON.parse(readFileSync(new URL("./fixtures/flap-txs.json", import.meta.url), "utf8")) as Record<string, { from: string; logs: EvmLog[] }>;
const LAUNCH = "0xc231d2c48b59014b673c82ea875014300d0a79f6d36f2ea6e67c08b11f9a93fe";
const [, ROUTED, BUNDLE] = Object.keys(TXS) as [string, string, string];
const MODELSELL = "0xf67e3c0eb6b6c976308a5009ef7967f1d4057777";

/** The batch endpoint, answered from the fixtures: transactions by hash and their receipts. */
const batch = async (_url: string, calls: Array<{ method: string; params: unknown[] }>) =>
  calls.map((c) => {
    const t = TXS[String(c.params[0])];
    if (!t) return null;
    return c.method === "eth_getTransactionByHash" ? { from: t.from } : { logs: t.logs };
  });

test("Flap's Portal logs decode: a launch with its name, ticker and metadata, a buy and a sell in whole units, the settings of the launch", () => {
  const logs = TXS[LAUNCH]!.logs.filter((l) => l.address.toLowerCase() === FLAP_PORTAL);
  const parsed = logs.map(parseFlapLog).filter(Boolean);
  const create = parsed.find((p) => p!.kind === "create");
  assert.ok(create && create.kind === "create");
  if (create.kind === "create") {
    assert.equal(create.launch.mint, MODELSELL);
    assert.equal(create.launch.symbol, "MODELSELL");
    assert.equal(create.launch.name, "Modelsell");
    assert.match(create.launch.meta, /^bafkrei/);
    // The Portal names the launcher bot, not the person.
    assert.equal(create.launch.launcher, "0xe8c6037cfeb66b22235556d38dcfd51bb5346666");
  }
  const tax = parsed.find((p) => p!.kind === "tax");
  assert.deepEqual(tax && "value" in tax ? tax.value : null, 900);
  const migrator = parsed.find((p) => p!.kind === "migrator");
  assert.deepEqual(migrator && "value" in migrator ? migrator.value : null, 1);
  const quote = parsed.find((p) => p!.kind === "quote");
  assert.deepEqual(quote && "value" in quote ? quote.value : null, "");
  const buy = parsed.find((p) => p!.kind === "trade");
  assert.ok(buy && buy.kind === "trade" && buy.trade.isBuy && buy.trade.tokens > 0 && buy.trade.quote > 0);
});

test("the person behind a router's trade is the wallet the tokens netted to; a buy split over five wallets is five buys", () => {
  const routed = TXS[ROUTED]!;
  const trade = routed.logs.map(parseFlapLog).find((p) => p?.kind === "trade");
  assert.ok(trade && trade.kind === "trade");
  if (trade.kind !== "trade") return;
  const transfers = routed.logs
    .filter((l) => l.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" && l.topics.length >= 3)
    .map((l) => ({ token: l.address.toLowerCase(), from: `0x${l.topics[1]!.slice(26)}`, to: `0x${l.topics[2]!.slice(26)}`, amount: Number(BigInt(l.data)) / 1e18 }));
  // The Portal's buyer is the router; the tokens end with the wallet that signed.
  assert.notEqual(trade.trade.actor, routed.from);
  assert.deepEqual(tradersOf(trade.trade, transfers).map((w) => w.wallet), [routed.from]);
  const bundle = TXS[BUNDLE]!;
  const bt = bundle.logs.map(parseFlapLog).find((p) => p?.kind === "trade");
  assert.ok(bt && bt.kind === "trade");
  if (bt.kind !== "trade") return;
  const btx = bundle.logs
    .filter((l) => l.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" && l.topics.length >= 3)
    .map((l) => ({ token: l.address.toLowerCase(), from: `0x${l.topics[1]!.slice(26)}`, to: `0x${l.topics[2]!.slice(26)}`, amount: Number(BigInt(l.data)) / 1e18 }));
  const who = tradersOf(bt.trade, btx);
  assert.equal(who.length, 5);
  assert.ok(Math.abs(who.reduce((a, w) => a + w.share, 0) - 1) < 1e-9);
  for (const w of who) assert.ok(Math.abs(w.share - 0.2) < 0.01);
});

test("the feed puts a Flap launch on the tape under the wallet that signed it, and its trades under the wallets the tokens went to", async () => {
  const tape = new PumpTape("BNB");
  const book = new PositionBook();
  const launched: string[] = [];
  const feed = new FlapFeed(tape, { batch, book, onLaunch: (l) => launched.push(l.symbol), log: () => {} });
  feed.backfilled = true;
  for (const l of TXS[LAUNCH]!.logs) if (l.address.toLowerCase() === FLAP_PORTAL) feed.onLog(l);
  await feed.settle(Date.now() + 5_000);
  const t = tape.token(MODELSELL)!;
  assert.ok(t, "on the tape");
  assert.equal(t.creator, TXS[LAUNCH]!.from);
  assert.equal(t.facts.venue, "flap");
  assert.equal(t.facts.platform, "tax 9%");
  assert.equal(t.facts.quote, undefined);
  assert.deepEqual(launched, ["MODELSELL"]);
  assert.equal(tape.metadataOf(MODELSELL)?.startsWith("https://flap.mypinata.cloud/ipfs/bafkrei"), true);
  // The launch's own buy came through a bot without its transfers on the socket: the receipt named the wallet.
  assert.ok(t.facts.buys >= 1);
  assert.equal(feed.unnamed, 0);
  void FLAP_SUPPLY;

  // The bundled token, launched earlier: its five wallets each bought a fifth, all in the same block.
  const bt = TXS[BUNDLE]!.logs.map(parseFlapLog).find((p) => p?.kind === "trade");
  assert.ok(bt && bt.kind === "trade");
  if (bt.kind !== "trade") return;
  tape.apply({ kind: "create", creator: "0x0000000000000000000000000000000000000abc", mint: bt.trade.mint, name: "X", symbol: "X", ts: (bt.trade.ts ?? Date.now()) - 2_000, venue: "flap", supply: FLAP_SUPPLY }, (bt.trade.ts ?? Date.now()) - 2_000, "0x00", bt.trade.block - 1);
  for (const l of TXS[BUNDLE]!.logs) feed.onLog(l);
  await feed.settle(Date.now() + 5_000);
  const b = tape.token(bt.trade.mint)!;
  assert.equal(b.facts.buys, 5);
  assert.equal(b.facts.buyers, 5);
  assert.equal(book.top(bt.trade.mint).length, 5);
});

test("a graduation to a PancakeSwap V2 pair is handed to the pair follower; the token is marked graduated", async () => {
  const tape = new PumpTape("BNB");
  const pairs: string[] = [];
  const feed = new FlapFeed(tape, { batch, book: new PositionBook(), onPair: (mint, pool) => pairs.push(`${mint}:${pool}`), log: () => {} });
  feed.backfilled = true;
  for (const l of TXS[LAUNCH]!.logs) if (l.address.toLowerCase() === FLAP_PORTAL) feed.onLog(l);
  await feed.settle(Date.now() + 5_000);
  const word = (a: string) => a.slice(2).padStart(64, "0");
  const POOL = "0x80eb85baefbd587c4d99b35ff2694dca8fb7e9d3";
  feed.onLog({ address: FLAP_PORTAL, topics: ["0x6e4f47630b8745b8cacbd44f42a8a33e7eea7cc08ef22fc7630f4f385784ff7d"], data: `0x${word(MODELSELL)}${word(POOL)}${"1".padStart(64, "0")}${"1".padStart(64, "0")}`, blockNumber: "0x10", transactionHash: "0xgrad", logIndex: "0x1" });
  await feed.settle(Date.now() + 5_000);
  assert.equal(tape.token(MODELSELL)!.facts.graduated, true);
  assert.deepEqual(pairs, [`${MODELSELL}:${POOL}`]);
});
