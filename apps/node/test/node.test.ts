import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createEvent, Enclosure, FeedLedger, Identity, PeerDirectory, signEvent, verifyChain } from "@aiagentzoo/sdk";
import { buildSections, nightOf, nightWatch, type Observation, renderBrief } from "../src/agents/nightWatch.ts";
import { createNodeServer } from "../src/server.ts";

const MINT = "6ReKEafCz73AxMeR2EYs9bKjQi8Lt4TgFfTVBZ6Lpump";

const obs = (over: Partial<Observation> = {}): Observation => ({
  mint: MINT,
  symbol: "SILK",
  name: "silk road",
  source: "pump",
  createdAt: 1,
  creator: "c",
  hasSocials: false,
  complete: false,
  marketCapUsd: 5000,
  market: { priceUsd: 0.001, liquidityUsd: 50, volume24hUsd: 9000, priceChange24h: -95, buys24h: 10, sells24h: 40, dex: "pumpswap", url: null },
  seenAt: 1,
  scout: "raven",
  ...over,
});

test("nightOf rolls over at the brief time", () => {
  assert.equal(nightOf(Date.UTC(2026, 9, 6, 6, 59), "07:00"), "2026-10-06");
  assert.equal(nightOf(Date.UTC(2026, 9, 6, 7, 0), "07:00"), "2026-10-07");
  assert.equal(nightOf(Date.UTC(2026, 9, 6, 23, 0), "07:00"), "2026-10-07");
});

test("sections flag rugs and suspicious tokens", () => {
  const s = buildSections("2026-10-06", [obs()], 0);
  assert.equal(s.wentToZero.length, 1);
  assert.deepEqual(s.suspicious[0]?.reasons, ["no socials", "sells outnumber buys 3:1", "volume 50x liquidity"]);
  const md = renderBrief(s, "Quiet night.");
  assert.match(md, /# Morning Brief — 2026-10-06/);
  assert.match(md, /SILK/);
  assert.match(md, /-95\.0%/);
});

test("a signed signal over HTTP becomes a published brief", async () => {
  const canyon = { id: "canyon.zoo", identity: Identity.generate(), operator: "op" };
  const north = Identity.generate();
  const ledger = new FeedLedger();
  ledger.deposit("keeper", 1000);
  const briefs: string[] = [];
  const enclosure = new Enclosure({
    node: canyon,
    keeper: "keeper",
    ledger,
    peers: new PeerDirectory([{ id: "north.zoo", url: "http://unused", publicKey: north.publicKey }]),
    agents: nightWatch({
      role: "canyon",
      nodes: { north: "north.zoo", marsh: "marsh.zoo", canyon: canyon.id },
      briefAt: "07:00",
      scanEveryMs: 60_000,
      onBrief: (_id, md) => void briefs.push(md),
    }),
  });
  await enclosure.lockStake();
  const server = createNodeServer({ enclosure, adminToken: "t" });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    const signal = signEvent(
      createEvent({ kind: "signal", type: "observations", from: { node: "north.zoo", agent: "hedgehog" }, to: { node: canyon.id, agent: "beaver" }, payload: { items: [obs({ seenAt: Date.now() })] } }),
      north,
    );
    const delivered = await (await fetch(`${base}/v1/events`, { method: "POST", body: JSON.stringify(signal) })).json();
    assert.deepEqual(delivered, { accepted: true });

    const forged = { ...signal, payload: { items: [obs({ symbol: "EVIL" })] } };
    const rejected = await (await fetch(`${base}/v1/events`, { method: "POST", body: JSON.stringify(forged) })).json();
    assert.equal(rejected.accepted, false);

    assert.equal((await fetch(`${base}/v1/agents/tortoise/wake`, { method: "POST" })).status, 401);
    await (await fetch(`${base}/v1/agents/beaver/wake`, { method: "POST", headers: { authorization: "Bearer t" } })).json();
    await enclosure.wake("tortoise");

    const latest = await (await fetch(`${base}/v1/artifacts/latest`)).json();
    assert.match(latest.event.payload.id, /^morning-brief-/);
    assert.equal(briefs.length, 1);

    const log = await (await fetch(`${base}/v1/log?limit=1000`)).json();
    assert.equal(verifyChain(log), null);
  } finally {
    server.close();
  }
});
