import assert from "node:assert/strict";
import { test } from "node:test";
import { BscFeed, FourMemeInfo, parseLog, quoteOf, TOKEN_MANAGER2, TOPIC, WBNB, type EvmLog } from "../src/chain/bsc.ts";
import { chainOf, checkToken } from "../src/chain/check.ts";
import { PumpTape } from "../src/chain/pump.ts";

const pad = (s: string) => `0x${s.padStart(64, "0")}`;
const wordOf = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
const addrWord = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
const strWords = (s: string) => {
  const hex = Buffer.from(s, "utf8").toString("hex");
  return wordOf(s.length) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
};

const CREATOR = "0x774352301321637bc2cad74e67d4089f36e15962";
const TOKEN = "0xd90c7ca9d7f2db697ec3e766f71ab027ab76ffff";
const SNIPER = "0xc12073cd7ae4394ce6f184598f4e4b9d89db863f";
const E18 = 10n ** 18n;

/** TokenCreate(creator, token, requestId, name, symbol, totalSupply, launchTime, launchFee) as the chain wrote one. */
const createLog = (block: number, ts: number, tx = "0xaa"): EvmLog => ({
  address: TOKEN_MANAGER2,
  topics: [TOPIC.create],
  data: `0x${addrWord(CREATOR)}${addrWord(TOKEN)}${wordOf(0x6286c2b)}${wordOf(0x100)}${wordOf(0x140)}${wordOf(1_000_000_000n * E18)}${wordOf(0)}${wordOf(0)}${strWords("Crime Cat ")}${strWords("Crime ")}`,
  blockNumber: `0x${block.toString(16)}`,
  blockTimestamp: `0x${ts.toString(16)}`,
  transactionHash: tx,
  logIndex: "0x1",
});
/** TokenPurchase / TokenSale(token, account, price, amount, cost, fee, offers, funds), amounts in wei. */
const tradeLog = (buy: boolean, account: string, tokens: number, bnb: number, block: number, ts: number, tx: string, index = 2): EvmLog => ({
  address: TOKEN_MANAGER2,
  topics: [buy ? TOPIC.buy : TOPIC.sell],
  data: `0x${addrWord(TOKEN)}${addrWord(account)}${wordOf(1)}${wordOf(BigInt(tokens) * E18)}${wordOf(BigInt(Math.round(bnb * 1e6)) * 10n ** 12n)}${wordOf(0)}${wordOf(0)}${wordOf(BigInt(Math.round(bnb * 1e6)) * 10n ** 12n)}`,
  blockNumber: `0x${block.toString(16)}`,
  blockTimestamp: `0x${ts.toString(16)}`,
  transactionHash: tx,
  logIndex: `0x${index.toString(16)}`,
});

test("four.meme logs decode into the tape's events: a create with its strings and supply, buys and sells in whole units", () => {
  const c = parseLog(createLog(129915777, 1793025925))!;
  assert.equal(c.ev.kind, "create");
  assert.equal(c.block, 129915777);
  assert.equal(c.ts, 1793025925000);
  if (c.ev.kind === "create") {
    assert.equal(c.ev.creator, CREATOR);
    assert.equal(c.ev.mint, TOKEN);
    assert.equal(c.ev.name, "Crime Cat");
    assert.equal(c.ev.symbol, "Crime");
    assert.equal(c.ev.supply, 1_000_000_000);
    assert.equal(c.ev.venue, "fourmeme");
  }
  // The purchase the chain wrote for the HL token: 7.14M tokens for 70.4 of its quote, 2,633 raised so far.
  const real = parseLog({
    address: TOKEN_MANAGER2,
    topics: [TOPIC.buy],
    data: "0x0000000000000000000000001d911b6d846c68ea52d8faca64106c00862bffff000000000000000000000000c12073cd7ae4394ce6f184598f4e4b9d89db863f00000000000000000000000000000000000000000000000000000912dde423a300000000000000000000000000000000000000000005e7eb76ca85bde0c6a000000000000000000000000000000000000000000000000003d10c2d424a5d81fd00000000000000000000000000000000000000000000000009c53de480be6005000000000000000000000000000000000000000001139e1e8bbbe04f35bcf20000000000000000000000000000000000000000000000008ebac56453cfeed0e0",
    blockNumber: "0x7be5a90",
    transactionHash: "0xbb",
    logIndex: "0x3",
  })!;
  assert.equal(real.ev.kind, "trade");
  if (real.ev.kind === "trade") {
    assert.equal(real.ev.isBuy, true);
    assert.equal(real.ev.mint, "0x1d911b6d846c68ea52d8faca64106c00862bffff");
    assert.equal(real.ev.user, SNIPER);
    assert.ok(Math.abs(real.ev.tokens - 7_139_839.3) < 1);
    assert.ok(Math.abs(real.ev.sol - 70.4037) < 0.001);
    assert.ok(Math.abs((real.ev.curveSol ?? 0) - 2632.9) < 0.1);
  }
  assert.equal(parseLog(tradeLog(false, SNIPER, 10, 0.5, 1, 1, "0xcc"))!.ev.kind, "trade");
  assert.equal(parseLog({ ...createLog(1, 1), topics: [TOPIC.liquidity], data: `0x${addrWord(TOKEN)}${wordOf(0)}${addrWord(WBNB)}${wordOf(0)}` })!.ev.kind, "complete");
  assert.equal(parseLog({ ...createLog(1, 1), removed: true }), null);
  assert.equal(parseLog({ ...createLog(1, 1), address: "0x0000000000000000000000000000000000000001" }), null);
  assert.equal(parseLog({ ...createLog(1, 1), topics: ["0x01"] }), null);
});

test("the feed holds a token's trades behind its create until the quote is read, then the tape has the launch, the dev's buy and the sniper", async () => {
  const tape = new PumpTape("BNB");
  let asked = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const feed = new BscFeed(tape, {
    quoteOf: async () => {
      asked += 1;
      await gate;
      return null;
    },
  });
  const t0 = 1793025925;
  const block = 129915777;
  feed.onLog(createLog(block, t0, "0xa1"));
  // The creator's own buy in the launch transaction, and a sniper in the next block.
  feed.onLog(tradeLog(true, CREATOR, 50_000_000, 0.5, block, t0, "0xa1", 5));
  feed.onLog(tradeLog(true, SNIPER, 80_000_000, 1, block + 1, t0 + 1, "0xa2"));
  // Not applied yet: the quote is still being read.
  assert.equal(tape.token(TOKEN), null);
  assert.equal(asked, 1);
  release();
  await new Promise((r) => setTimeout(r, 10));
  const found = tape.token(TOKEN, t0 * 1000 + 60_000)!;
  assert.ok(found);
  assert.equal(found.symbol, "Crime");
  assert.equal(found.creator, CREATOR);
  assert.equal(found.createdAt, t0 * 1000);
  assert.equal(found.facts.buys, 2);
  assert.equal(found.facts.venue, "fourmeme");
  assert.equal(found.facts.creatorSold, 0);
  // The sniper bought in the block after the launch: a launch-block bundle wallet, and an early wallet.
  assert.deepEqual(found.bundle.map((b) => b.wallet), [SNIPER]);
  assert.equal(found.facts.earlyWallets, 1);
  // Now a direct trade, applied at once, and the same log again, dropped.
  feed.onLog(tradeLog(false, CREATOR, 50_000_000, 0.6, block + 400, t0 + 300, "0xa3"));
  feed.onLog(tradeLog(false, CREATOR, 50_000_000, 0.6, block + 400, t0 + 300, "0xa3"));
  const after = tape.token(TOKEN, t0 * 1000 + 600_000)!;
  assert.equal(after.facts.sells, 1);
  assert.equal(after.facts.creatorSold, 1);
  assert.equal(feed.cursor, block + 400);
  const check = checkToken(TOKEN, found && { symbol: after.symbol, facts: after.facts, creatorRecord: after.creatorRecord }, { now: t0 * 1000 + 600_000 });
  assert.equal(check.verdict, "avoid");
  assert.match(check.reasons[0]!, /creator sold 100%/);
  assert.equal(check.facts!.venue, "fourmeme");
  // The moments speak in BNB on this tape.
  feed.onLog(tradeLog(true, SNIPER, 1_000, 12, block + 401, t0 + 301, "0xa4"));
  assert.match(tape.momentsMatching({ mint: TOKEN, kind: "whale" })[0]!.text, /\+12\.0 BNB buy/);
});

test("quoteOf reads Helper3: WBNB and the zero address mean BNB, anything else is the quote token", async () => {
  const answer = (quote: string) => async () => `0x${wordOf(2)}${addrWord(TOKEN_MANAGER2)}${addrWord(quote)}${wordOf(0)}`;
  assert.equal(await quoteOf(TOKEN, answer(WBNB) as never), null);
  assert.equal(await quoteOf(TOKEN, answer("0x0000000000000000000000000000000000000000") as never), null);
  assert.equal(await quoteOf(TOKEN, answer("0x55d398326f99059fF775485246999027B3197955") as never), "0x55d398326f99059ff775485246999027b3197955");
  await assert.rejects(quoteOf(TOKEN, (async () => "0x") as never));
});

test("an address's chain shows in its shape, and a BNB Chain token the tape never saw says so in four.meme's words", () => {
  assert.equal(chainOf(TOKEN), "bsc");
  assert.equal(chainOf("DqHhWUUh6nQF47ZoUyfjgnybYNpgb8s6wQG8wmHL5TiY"), "solana");
  const unknown = checkToken(TOKEN, null);
  assert.equal(unknown.verdict, "unknown");
  assert.match(unknown.reasons[0]!, /four\.meme/);
  assert.doesNotMatch(unknown.reasons[0]!, /pump\.fun/);
  const sol = checkToken("DqHhWUUh6nQF47ZoUyfjgnybYNpgb8s6wQG8wmHL5TiY", null);
  assert.match(sol.reasons[0]!, /pump\.fun/);
});

test("four.meme's own record of a token: creator, time, ticker, picture and links, kept once read", async () => {
  let calls = 0;
  const f = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        code: 0,
        data: { address: TOKEN, image: "https://static.four.meme/x.jpg", name: "Crime Cat ", shortName: "Crime ", symbol: "BNB", userAddress: CREATOR.toUpperCase().replace("0X", "0x"), createDate: "1793025923000", raisedAmount: "13.5", twitterUrl: "https://x.com/a", tokenPrice: { holderCount: 7, progress: "0.12" } },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const info = new FourMemeInfo(f);
  assert.equal(info.peek(TOKEN), undefined);
  const got = (await info.get(TOKEN))!;
  assert.equal(got.creator, CREATOR);
  assert.equal(got.createdAt, 1793025923000);
  assert.equal(got.symbol, "Crime");
  assert.equal(got.quote, "BNB");
  assert.equal(got.holders, 7);
  assert.equal(got.graduatesAt, 13.5);
  assert.equal(got.links.x, "https://x.com/a");
  assert.equal(info.image(TOKEN.toUpperCase().replace("0X", "0x")), "https://static.four.meme/x.jpg");
  await info.get(TOKEN);
  info.want(TOKEN);
  assert.equal(calls, 1);
  const miss = new FourMemeInfo((async () => new Response(JSON.stringify({ code: 0, msg: "success" }), { status: 200 })) as unknown as typeof fetch);
  assert.equal(await miss.get(TOKEN), null);
  assert.equal(miss.peek(TOKEN), null);
});

test("the node answers a 0x address from the BNB Chain tape: check, x-ray, creator and wallet, with the Solana tape untouched", async () => {
  const { Enclosure, Identity } = await import("@aiagentzoo/sdk");
  const { createNodeServer } = await import("../src/server.ts");
  const { bscTape } = await import("../src/chain/bsc.ts");
  const { tape: solTape } = await import("../src/chain/pump.ts");
  const t0 = Date.now() - 20 * 60_000;
  const feed = new BscFeed(bscTape, { quoteOf: async () => null });
  const block = 129915777;
  feed.onLog(createLog(block, Math.floor(t0 / 1000), "0xb1"));
  feed.onLog(tradeLog(true, CREATOR, 50_000_000, 0.5, block, Math.floor(t0 / 1000), "0xb1", 5));
  feed.onLog(tradeLog(true, SNIPER, 80_000_000, 1, block + 1, Math.floor(t0 / 1000) + 1, "0xb2"));
  await new Promise((r) => setTimeout(r, 10));
  feed.onLog(tradeLog(false, CREATOR, 50_000_000, 0.6, block + 400, Math.floor(t0 / 1000) + 300, "0xb3"));
  bscTape.connected = true;
  bscTape.lastEventAt = Date.now();
  const enclosure = new Enclosure({ node: { id: "north.zoo", identity: Identity.generate(), operator: "op" }, keeper: "keeper", tools: [], agents: [] });
  const server = createNodeServer({ enclosure });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    // Any spelling of the address lands on the same token.
    const c = (await (await fetch(`${base}/v1/check/${TOKEN.toUpperCase().replace("0X", "0x")}`)).json()) as { mint: string; verdict: string; reasons: string[]; facts: { venue: string }; stream: { live: boolean } };
    assert.equal(c.mint, TOKEN);
    assert.equal(c.verdict, "avoid");
    assert.match(c.reasons[0]!, /creator sold 100%/);
    assert.equal(c.facts.venue, "fourmeme");
    assert.equal(c.stream.live, true);
    const x = (await (await fetch(`${base}/v1/xray/${TOKEN}`)).json()) as { symbol: string; creator: string; early: Array<{ wallet: string }>; funding: unknown; check: { holders?: unknown }; bundle: { wallets: Array<{ wallet: string }> } };
    assert.equal(x.symbol, "Crime");
    assert.equal(x.creator, CREATOR);
    assert.deepEqual(x.early.map((e) => e.wallet), [SNIPER]);
    assert.deepEqual(x.bundle.wallets.map((b) => b.wallet), [SNIPER]);
    // Nothing is read from an RPC on BNB Chain yet: no funders, no holders.
    assert.equal(x.funding, null);
    assert.equal("holders" in x.check, false);
    const dev = (await (await fetch(`${base}/v1/chain/creator/${CREATOR}`)).json()) as { launches48h: number; dumped: number };
    assert.equal(dev.launches48h, 1);
    assert.equal(dev.dumped, 1);
    const w = (await (await fetch(`${base}/v1/wallet/${CREATOR}`)).json()) as { dev: { launches: unknown[] } | null };
    assert.equal(w.dev?.launches.length, 1);
    // A 0x address the tape never saw: unknown, in four.meme's words, and not a Solana lookup.
    const other = (await (await fetch(`${base}/v1/check/0x0000000000000000000000000000000000000001`)).json()) as { verdict: string; reasons: string[] };
    assert.equal(other.verdict, "unknown");
    assert.match(other.reasons[0]!, /four\.meme/);
    assert.equal(solTape.token(TOKEN), null);
  } finally {
    server.close();
  }
});

test("the backfill asks the archive for ascending thousand-block ranges and the live endpoint for the last few thousand", async () => {
  const tape = new PumpTape("BNB");
  const asked: Array<[string, number, number]> = [];
  const head = 1_000_000;
  const rpc = (async (url: string, method: string, params: unknown[]) => {
    if (method === "eth_blockNumber") return `0x${head.toString(16)}`;
    if (method === "eth_getLogs") {
      const p = params[0] as { fromBlock: string; toBlock: string };
      asked.push([url, Number(p.fromBlock), Number(p.toBlock)]);
      return [];
    }
    throw new Error(method);
  }) as never;
  const sockets: Array<{ onopen?: () => void; onmessage?: (m: { data: string }) => void; close(): void }> = [];
  class FakeSocket {
    onopen?: () => void;
    onmessage?: (m: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    constructor() {
      sockets.push(this);
      setTimeout(() => this.onopen?.(), 1);
    }
    send() {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: 1, result: "0x1" }) }), 1);
    }
    close() {
      setTimeout(() => this.onclose?.(), 1);
    }
  }
  const feed = new BscFeed(tape, { cursor: head - 5_500, rpc, rpcUrl: "live", logsUrl: "archive", quoteOf: async () => null, WebSocketImpl: FakeSocket as never, log: () => {} });
  const stop = feed.start();
  await new Promise((r) => setTimeout(r, 50));
  stop();
  assert.ok(asked.length >= 3, `asked ${asked.length}`);
  for (const [, from, to] of asked) assert.ok(from <= to, `range ${from}..${to}`);
  for (let i = 1; i < asked.length; i++) assert.equal(asked[i]![1], asked[i - 1]![2] + 1);
  assert.equal(asked[0]![0], "archive");
  assert.equal(asked[0]![2] - asked[0]![1], 999);
  assert.equal(asked[asked.length - 1]![0], "live");
  assert.equal(asked[asked.length - 1]![2], head);
  assert.equal(feed.cursor, head);
  assert.equal(feed.backfilled, true);
});

test("the risk score sits inside the verdict's band and grows with the reasons; wallet tags read the tape and the long memory", async () => {
  const { scoreOf, WEIGHT } = await import("../src/chain/check.ts");
  const { tagsOf } = await import("../src/chain/tags.ts");
  assert.equal(scoreOf("unknown", []), null);
  assert.equal(scoreOf("pass", []), 0);
  assert.equal(scoreOf("pass", [], { early: true }), 10);
  const one = scoreOf("caution", [WEIGHT.top5])!;
  const two = scoreOf("caution", [WEIGHT.top5, WEIGHT.ring, WEIGHT.wash])!;
  assert.ok(one >= 25 && one < two && two <= 59, `${one} ${two}`);
  assert.equal(scoreOf("caution", [99, 99]), 59);
  const sold = scoreOf("avoid", [WEIGHT.creatorSold])!;
  const soldCrew = scoreOf("avoid", [WEIGHT.creatorSold, WEIGHT.crew, WEIGHT.launchBundle])!;
  assert.ok(sold >= 60 && sold < soldCrew && soldCrew <= 100, `${sold} ${soldCrew}`);
  assert.equal(scoreOf("avoid", [99, 99, 99]), 100);
  // The check itself carries it, in the band of its verdict.
  const t0 = Date.now() - 20 * 60_000;
  const tape = new PumpTape("BNB");
  const feed = new BscFeed(tape, { quoteOf: async () => null });
  feed.onLog(createLog(1, Math.floor(t0 / 1000), "0xc1"));
  feed.onLog(tradeLog(true, CREATOR, 50_000_000, 0.5, 1, Math.floor(t0 / 1000), "0xc1", 5));
  await new Promise((r) => setTimeout(r, 10));
  feed.onLog(tradeLog(false, CREATOR, 50_000_000, 0.6, 400, Math.floor(t0 / 1000) + 300, "0xc3"));
  const found = tape.token(TOKEN)!;
  const c = checkToken(TOKEN, { symbol: found.symbol, facts: found.facts, creatorRecord: found.creatorRecord });
  assert.equal(c.verdict, "avoid");
  assert.ok(c.score! >= 60 && c.score! <= 100);
  assert.equal(checkToken(TOKEN, null).score, null);
  // Tags.
  const none = { launches: 0, dumped: 0, snipes: 0, crewHits: 0, bundleHits: 0, serial: false };
  assert.deepEqual(tagsOf({ wallet: SNIPER, bought: 0.001 }, null), ["new"]);
  assert.deepEqual(tagsOf({ wallet: SNIPER, bought: 0.001, snipes48h: 4 }, null), []);
  assert.deepEqual(tagsOf({ wallet: SNIPER, bought: 0.03, crew: true, bundle: true }, none), ["crew", "bundle", "whale"]);
  assert.deepEqual(tagsOf({ wallet: SNIPER, bought: 0.001 }, { ...none, launches: 4, dumped: 3 }), ["rugger"]);
  assert.deepEqual(tagsOf({ wallet: SNIPER, bought: 0.001 }, { ...none, launches: 2, dumped: 0, snipes: 12 }), ["serial", "dev"]);
  assert.deepEqual(tagsOf({ wallet: SNIPER, share: 0.05, ring: true }, { ...none, bundleHits: 3 }), ["ring", "bundle", "whale"]);
});
