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

import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { base58Decode, sessionMessage, verifyGuardian } from "../src/guardian.ts";
import { PassportIndex } from "../src/passport.ts";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** A Solana-style wallet: base58 ed25519 address that signs raw message bytes. */
function wallet() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const address = base58Encode(raw);
  const session = (issued = new Date(), ttl = 3_600_000) => {
    const message = sessionMessage(address, issued.toISOString(), new Date(issued.getTime() + ttl).toISOString());
    return { publicKey: address, message, signature: edSign(null, Buffer.from(message), privateKey).toString("base64") };
  };
  return { address, raw, session };
}

test("base58 round-trips a Solana address", () => {
  const w = wallet();
  assert.deepEqual(Buffer.from(base58Decode(w.address)), w.raw);
});

test("guardian sessions verify, and forgeries do not", () => {
  const w = wallet();
  const good = w.session();
  assert.deepEqual(verifyGuardian(good), { ok: true, address: w.address });
  assert.equal(verifyGuardian({ ...good, publicKey: wallet().address }).ok, false);
  assert.equal(verifyGuardian({ ...good, message: good.message.replace("costs nothing", "costs 1 SOL") }).ok, false);
  assert.equal(verifyGuardian(w.session(new Date(Date.now() - 2 * 86_400_000))).ok, false);
  assert.equal(verifyGuardian(w.session(new Date(), 3 * 86_400_000)).ok, false);
});

test("visitors and guardians wake sentinels within limits; passports count it", async () => {
  const node = { id: "north.zoo", identity: Identity.generate(), operator: "op" };
  const ledger = new FeedLedger();
  ledger.deposit("keeper", 1000);
  const { defineAgent, species } = await import("@aiagentzoo/sdk");
  const enclosure = new Enclosure({
    node,
    keeper: "keeper",
    ledger,
    agents: [
      defineAgent({ name: "raven", species: species.sentinel, async onWake(ctx) { await ctx.trace("scan", { fresh: 0 }); } }),
      defineAgent({ name: "hedgehog", species: species.gatherer, async onWake() {} }),
    ],
  });
  await enclosure.lockStake();
  const passports = await PassportIndex.build(enclosure);
  const server = createNodeServer({
    enclosure,
    passports,
    visitor: { agents: ["raven"], agentCooldownMs: 0, visitorCooldownMs: 60_000, guardianCooldownMs: 60_000 },
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const wake = (agent: string, body: unknown = {}) =>
    fetch(`${base}/v1/visitor/wake/${agent}`, { method: "POST", body: JSON.stringify(body) });

  try {
    assert.equal((await wake("hedgehog")).status, 403);
    assert.equal((await wake("raven")).status, 202);
    const limited = await wake("raven");
    assert.equal(limited.status, 429);
    assert.ok((await limited.json()).retryAfterMs > 0);

    const w = wallet();
    const signed = await wake("raven", { guardian: w.session() });
    assert.deepEqual(await signed.json(), { woke: "raven", by: `guardian:${w.address}` });
    assert.equal((await wake("raven", { guardian: { ...w.session(), signature: Buffer.alloc(64).toString("base64") } })).status, 401);

    await (enclosure as any).agents.get("raven").queue;
    const passport = await (await fetch(`${base}/v1/agents/raven`)).json();
    assert.equal(passport.wakes, 2);
    assert.deepEqual(passport.wokenBy, { schedule: 0, signal: 0, visitor: 1, guardian: 1, warden: 0 });
    assert.equal(passport.cycles, 2);
    assert.match(passport.lastSteps[0].summary, /scan|woke/);
    assert.equal((await fetch(`${base}/v1/agents/nobody`)).status, 404);
  } finally {
    server.close();
  }
});
